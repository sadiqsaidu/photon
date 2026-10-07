import { startBlur } from "./blur.js";
import { bus, LAG_INTERVAL_MS, requireApiKey } from "./config.js";
import { latestReceipts, markLanded, migrateDb, probeRows, prune, saveReceipt, saveSlots, storedSlots, type ProbeFields } from "./db.js";
import { demo } from "./demo.js";
import { doctor } from "./doctor.js";
import { startGrpc } from "./grpc.js";
import { leaderOf, onFinalized, refreshLeaders } from "./leaders.js";
import * as lifecycle from "./lifecycle.js";
import { raceSlot, raceStats, startMirage } from "./mirage.js";
import { budgetState, loadProbes, probeOutcomes, probeSettled, startProbes } from "./probe.js";
import { quote } from "./quote.js";
import { asReceipt, routes } from "./routes.js";
import { startServer } from "./server.js";
import { beamTipAddresses, leaderNow } from "./solami.js";
import { addHeat, addTip, confirmedRow, onConfirmed, recentHeat, refreshLag, seedWindow, tipState, useLeaders, type SlotStats } from "./tips.js";
import { resumeWebhook, webhookHealth } from "./watch.js";

const RECENT_RECEIPTS = 20;
const STATUS_EVERY_MS = 60_000;
const PRUNE_EVERY_MS = 3_600_000;

// A Solami refusal (missing permission, plan or balance) degrades one feature;
// the server keeps running and serving stored data instead of crash-looping.
const degraded = new Map<string, string>();
async function optional<T>(feature: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    degraded.set(feature, (e as Error).message);
    console.warn(`[${feature}] unavailable: ${(e as Error).message}`);
    return fallback;
  }
}

async function serve(): Promise<void> {
  requireApiKey();
  await migrateDb();
  seedWindow((await storedSlots(150)).reverse());
  const beamTips = await optional("beam", beamTipAddresses, []);
  await loadProbes(await probeRows(), markLanded);
  const startedAt = Date.now();
  let processed = 0;
  let chainTip = 0;
  let behind = 0;
  let maxBehind = 0;
  const finalizedRows: SlotStats[] = [];
  const probeFields = new Map<string, ProbeFields>();
  const recent: lifecycle.Receipt[] = (await latestReceipts(RECENT_RECEIPTS)).map(asReceipt);
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
        if (row) finalizedRows.push(row);
      }
    },
    onBlock: lifecycle.onBlock,
    onTip: addTip,
    onTx: lifecycle.onTx,
  });
  const mirage = startMirage();
  const blur = startBlur(() => processed, addHeat);
  await optional("webhooks", resumeWebhook, undefined);
  const streams = () => [grpc, mirage, ...blur, webhookHealth()].filter((s) => s !== null).map((s) => ({ ...s }));
  const degradedNow = () => [
    ...[...degraded].map(([feature, error]) => ({ feature, error })),
    ...streams()
      .filter((s) => s.blocked)
      .map((s) => ({ feature: s.name, error: s.blocked as string })),
  ];

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
  const probeWallet = await optional(
    "probes",
    () =>
      startProbes(
        () => Math.max(processed, chainTip),
        (r, fields) => {
          probeFields.set(r.signature, fields);
          saveReceipt(r, fields).catch((e: Error) => console.error(`[db] receipt ${r.signature}: ${e.message}`));
        },
      ),
    null,
  );
  setInterval(() => prune().catch((e: Error) => console.error(`[db] prune: ${e.message}`)), PRUNE_EVERY_MS).unref();
  setTimeout(() => prune().catch((e: Error) => console.error(`[db] prune: ${e.message}`)), 60_000).unref();

  setInterval(refreshLag, LAG_INTERVAL_MS);
  // Slot rows are written in one batched insert every couple of seconds.
  setInterval(() => {
    const rows = finalizedRows.splice(0);
    saveSlots(rows).catch((e: Error) => console.error(`[db] ${rows.length} slot rows: ${e.message}`));
  }, 2_000);
  // Blur events can land after a slot confirms, so recent heat is re-sent.
  setInterval(() => bus.emit("heat", recentHeat(40)), 2_000);
  setInterval(() => {
    leaderNow().then(
      (l) => {
        chainTip = l.slot;
        behind = Math.max(0, l.slot - processed);
        if (processed && behind > maxBehind) maxBehind = behind;
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
      `[status] slot ${processed} behind ${behind} (max ${maxBehind}) | grpc queue ${grpc.queue?.depth} (max ${grpc.queue?.maxDepth}, shed ${grpc.queue?.dropped}) | ` +
        `${streams().map((s) => `${s.name} ${s.connected ? "up" : "down"} r${s.reconnects} bp${s.backpressureClosures}`).join(", ")} | ` +
        `quote samples ${t.samples}, beam floor at p${t.floorPercentile} | race grpc ${race.wins.grpc} mirage ${race.wins.mirage} | ` +
        `lag k=${t.lag.k} r=${t.lag.r} | probe budget left ${budgetState().leftLamports}`,
    );
  }, STATUS_EVERY_MS);

  startServer(
    routes({
      startedAt,
      beamTips,
      probeWallet,
      recent,
      slot: () => processed,
      chainTip: () => chainTip,
      behind: () => behind,
      maxBehind: () => maxBehind,
      streams,
      degraded: degradedNow,
    }),
  );
  console.log(`[photon] region streams up; ${beamTips.length} Beam tip addresses; probes ${probeWallet ? "on" : "off (PROBE_SECRET not set)"}`);
}

// Hosts stop instances with SIGTERM; exit cleanly so exit hooks run.
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));

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
