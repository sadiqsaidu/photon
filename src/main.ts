import { PublicKey } from "@solana/web3.js";
import { onWebhookPost, resumeWebhook, runAudit, watchWallet, webhookHealth } from "./audit.js";
import { blurCounts, startBlur } from "./blur.js";
import { AUDIT_DEFAULT_LIMIT, AUDIT_MAX_LIMIT, bus, JITO_TIP_ACCOUNTS, LAG_INTERVAL_MS, requireApiKey } from "./config.js";
import { checkDb, loadAudit, markLanded, probeRows, receiptBySignature, saveReceipt, saveSlot, type ProbeFields } from "./db.js";
import { demo } from "./demo.js";
import { doctor } from "./doctor.js";
import { startGrpc } from "./grpc.js";
import { leaderOf, onFinalized, refreshLeaders, upcomingLeaders } from "./leaders.js";
import * as lifecycle from "./lifecycle.js";
import { raceSlot, raceStats, startMirage } from "./mirage.js";
import { budgetState, loadProbes, probeOutcomes, probeRecords, probeSettled, startProbes } from "./probe.js";
import { calibration, quote } from "./quote.js";
import { HttpError, startServer } from "./server.js";
import { beamTipAddresses, leaderNow } from "./solami.js";
import { addHeat, addTip, confirmedRow, onConfirmed, refreshLag, tipState, useLeaders } from "./tips.js";

const RECENT_RECEIPTS = 20;
const STATUS_EVERY_MS = 60_000;

async function serve(): Promise<void> {
  requireApiKey();
  await checkDb();
  const beamTips = await beamTipAddresses();
  const beamSet = new Set(beamTips);
  await loadProbes(await probeRows(), markLanded);
  const startedAt = Date.now();
  let processed = 0;
  let chainTip = 0;
  let behind = 0;
  const probeFields = new Map<string, ProbeFields>();
  const recent: lifecycle.Receipt[] = [];
  useLeaders(leaderOf);

  const grpc = startGrpc(beamTips, {
    onSlot(slot, status) {
      lifecycle.onSlot(slot, status);
      if (status === "processed") {
        raceSlot("grpc", slot);
        if (slot > processed) {
          processed = slot;
          bus.emit("slot", { slot, chainTip, behind });
          refreshLeaders(slot).catch((e: Error) => console.warn(`[leaders] ${e.message}`));
        }
      }
      if (status === "confirmed") onConfirmed(slot);
      if (status === "finalized") {
        onFinalized(slot);
        const row = confirmedRow(slot);
        if (row) saveSlot(row).catch((e: Error) => console.error(`[db] slot ${slot}: ${e.message}`));
      }
    },
    onBlock: lifecycle.onBlock,
    onTip: addTip,
    onTx: lifecycle.onTx,
  });
  const mirage = startMirage();
  const blur = startBlur(() => processed, addHeat);
  await resumeWebhook();
  const streams = () => [grpc, mirage, blur, webhookHealth()].filter((s) => s !== null).map((s) => ({ ...s }));

  bus.on("lifecycle", (r: lifecycle.Receipt) => {
    const i = recent.findIndex((x) => x.signature === r.signature);
    if (i >= 0) recent.splice(i, 1);
    recent.unshift(r);
    recent.length = Math.min(recent.length, RECENT_RECEIPTS);
  });
  lifecycle.onReceiptSettled((r) => {
    if (r.kind === "probe") probeSettled(r);
    saveReceipt(r, probeFields.get(r.signature)).catch((e: Error) => console.error(`[db] receipt ${r.signature}: ${e.message}`));
    const link = `https://solscan.io/tx/${r.signature}`;
    const landed = r.landedSlot === null ? "not landed" : `landed slot ${r.landedSlot} (+${r.landedSlot - r.sentSlot})`;
    console.log(`[${r.kind}] ${r.failure ?? "finalized"} tip ${r.tip} ${landed} beam ${r.beam ? `${r.beam.region} landed=${r.beam.is_landed}` : "no record"} ${link}`);
  });

  // The chain tip guards slots-to-land against a lagging stream.
  const probeWallet = await startProbes(
    () => Math.max(processed, chainTip),
    (r, fields) => {
      probeFields.set(r.signature, fields);
      saveReceipt(r, fields).catch((e: Error) => console.error(`[db] receipt ${r.signature}: ${e.message}`));
    },
  );

  setInterval(refreshLag, LAG_INTERVAL_MS);
  setInterval(() => {
    leaderNow().then(
      (l) => {
        chainTip = l.slot;
        behind = Math.max(0, l.slot - processed);
      },
      (e: Error) => console.warn(`[leader-tracking] ${e.message}`),
    );
  }, 2_000);
  setInterval(() => {
    if (tipState().samples) quote(2, 0.9, probeOutcomes()).then((q) => bus.emit("quote", q), () => undefined);
  }, 5_000);
  setInterval(() => {
    const t = tipState();
    const race = raceStats();
    console.log(
      `[status] slot ${processed} behind ${behind} | ${streams().map((s) => `${s.name} ${s.connected ? "up" : "down"}`).join(", ")} | ` +
        `quote samples ${t.samples}, beam floor at p${t.floorPercentile} | race grpc ${race.wins.grpc} mirage ${race.wins.mirage} | ` +
        `lag k=${t.lag.k} r=${t.lag.r} | probe budget left ${budgetState().leftLamports}`,
    );
  }, STATUS_EVERY_MS);

  const num = (q: URLSearchParams, name: string, fallback: number, lo: number, hi: number) => {
    const v = Number(q.get(name) ?? fallback);
    if (!Number.isFinite(v) || v < lo || v > hi) throw new HttpError(400, `${name} must be between ${lo} and ${hi}`);
    return v;
  };
  const calibrationNow = () =>
    calibration(probeRecords().filter((p) => p.settled && p.calibrate && p.failure !== "send_rejected").map((p) => ({
      bucket: p.bucket,
      predicted: p.predicted,
      slotsToLand: p.landedSlot === null ? null : p.landedSlot - p.sentSlot,
    })));

  startServer({
    "GET /health": () => ({ ok: streams().every((s) => s.connected), slot: processed, behind, streams: streams() }),
    "GET /stats": () => ({
      slot: processed,
      chainTip,
      behind,
      streams: streams(),
      race: raceStats(),
      blur: { counts: blurCounts, since: startedAt },
      tips: tipState(),
      calibration: calibrationNow(),
      probe: { wallet: probeWallet, ...budgetState() },
      receipts: recent,
    }),
    "GET /quote": ({ query }) => quote(Math.round(num(query, "deadline", 2, 1, 32)), num(query, "confidence", 0.9, 0.01, 0.999), probeOutcomes()),
    "GET /tips/addresses": () => ({ beam: beamTips, jito: JITO_TIP_ACCOUNTS }),
    "POST /send": async ({ body }) => {
      const tx = (body as { tx?: unknown } | undefined)?.tx;
      if (typeof tx !== "string") throw new HttpError(400, "body must be { tx: base64 signed transaction }");
      try {
        const r = await lifecycle.submitSigned(tx, Math.max(processed, chainTip), beamSet);
        return { signature: r.signature };
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
    },
    "GET /receipt/:signature": async ({ params: [signature] }) => {
      const live = recent.find((r) => r.signature === signature) ?? lifecycle.activeReceipts().find((r) => r.signature === signature);
      if (live) return live;
      const row = await receiptBySignature(signature as string);
      if (!row) throw new HttpError(404, "unknown signature");
      return { ...row, settled: row.failure !== null || Boolean((row.stages as lifecycle.Receipt["stages"]).finalized) };
    },
    "GET /calibration": calibrationNow,
    "GET /leaders": () => upcomingLeaders(Math.max(processed, chainTip)),
    "POST /audit": ({ body }) => {
      const { address, limit } = (body ?? {}) as { address?: unknown; limit?: unknown };
      const n = limit === undefined ? AUDIT_DEFAULT_LIMIT : Number(limit);
      if (!Number.isInteger(n) || n < 1 || n > AUDIT_MAX_LIMIT) throw new HttpError(400, `limit must be an integer from 1 to ${AUDIT_MAX_LIMIT}`);
      return runAudit(validAddress(address), n);
    },
    "GET /audit/:address": async ({ params: [address] }) => {
      const audit = await loadAudit(validAddress(address));
      if (!audit) throw new HttpError(404, "no audit for this address yet; POST /audit first");
      return audit;
    },
    "POST /audit/:address/watch": async ({ params: [address] }) => {
      try {
        return await watchWallet(validAddress(address));
      } catch (e) {
        throw e instanceof HttpError ? e : new HttpError(400, (e as Error).message);
      }
    },
    "POST /webhooks/solami": async ({ raw, headers }) => {
      try {
        await onWebhookPost(raw, headers["x-webhook-signature"] as string | undefined);
      } catch (e) {
        throw new HttpError(401, (e as Error).message);
      }
      return { ok: true };
    },
  });
  console.log(`[photon] region streams up; ${beamTips.length} Beam tip addresses; probes ${probeWallet ? "on" : "off (PROBE_SECRET not set)"}`);
}

function validAddress(value: unknown): string {
  try {
    return new PublicKey(String(value)).toBase58();
  } catch {
    throw new HttpError(400, "address must be a base58 Solana address");
  }
}

const mode = process.argv[2];

async function main(): Promise<void> {
  if (mode === "doctor") process.exit((await doctor()) ? 0 : 1);
  if (mode === "serve") return serve();
  if (mode === "demo") return demo();
  throw new Error(`unknown mode "${mode ?? ""}". Use: serve | doctor | demo`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
