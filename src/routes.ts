import { PublicKey } from "@solana/web3.js";
import { runAudit } from "./audit.js";
import { blurCounts } from "./blur.js";
import { AUDIT_DEFAULT_LIMIT, AUDIT_MAX_LIMIT, JITO_TIP_ACCOUNTS } from "./config.js";
import { loadAudit, receiptBySignature, type ReceiptRow } from "./db.js";
import { upcomingLeaders } from "./leaders.js";
import * as lifecycle from "./lifecycle.js";
import { raceStats } from "./mirage.js";
import { budgetState, probeOutcomes } from "./probe.js";
import { calibration, quote, reachableBuckets } from "./quote.js";
import { HttpError, type Handler } from "./server.js";
import type { StreamHealth } from "./stream.js";
import { distribution, tipState } from "./tips.js";
import { auditRefreshed, onWebhookPost, watchWallet } from "./watch.js";

export interface Context {
  startedAt: number;
  beamTips: string[];
  probeWallet: string | null;
  recent: lifecycle.Receipt[];
  slot(): number;
  chainTip(): number;
  behind(): number;
  maxBehind(): number;
  streams(): StreamHealth[];
  degraded(): { feature: string; error: string }[];
}

export function asReceipt(row: ReceiptRow): lifecycle.Receipt {
  const stages = row.stages as lifecycle.Receipt["stages"];
  return {
    signature: row.signature,
    kind: row.kind as lifecycle.Receipt["kind"],
    sentSlot: row.sentSlot,
    lastValidBlockHeight: null,
    tip: row.tip,
    stages,
    landedSlot: row.landedSlot,
    failure: row.failure as lifecycle.FailureClass | null,
    error: row.error,
    beam: row.beam as lifecycle.Receipt["beam"],
    settled: row.failure !== null || row.landedSlot !== null || Boolean(stages.finalized),
    sentAt: row.createdAt.getTime(),
  };
}

function validAddress(value: unknown): string {
  try {
    return new PublicKey(String(value)).toBase58();
  } catch {
    throw new HttpError(400, "address must be a base58 Solana address");
  }
}

function num(q: URLSearchParams, name: string, fallback: number, lo: number, hi: number): number {
  const v = Number(q.get(name) ?? fallback);
  if (!Number.isFinite(v) || v < lo || v > hi) throw new HttpError(400, `${name} must be between ${lo} and ${hi}`);
  return v;
}

function calibrationNow() {
  return calibration(probeOutcomes(), reachableBuckets(distribution().sorted));
}

export function routes(ctx: Context): Record<string, Handler> {
  const beamSet = new Set(ctx.beamTips);
  const sendSlot = () => Math.max(ctx.slot(), ctx.chainTip());
  return {
    "GET /health": () => ({
      ok: ctx.streams().every((s) => s.connected),
      slot: ctx.slot(),
      behind: ctx.behind(),
      maxBehind: ctx.maxBehind(),
      degraded: ctx.degraded(),
      streams: ctx.streams(),
    }),
    "GET /stats": () => ({
      slot: ctx.slot(),
      chainTip: ctx.chainTip(),
      behind: ctx.behind(),
      maxBehind: ctx.maxBehind(),
      degraded: ctx.degraded(),
      streams: ctx.streams(),
      race: raceStats(),
      blur: { counts: blurCounts, since: ctx.startedAt },
      tips: tipState(),
      calibration: calibrationNow(),
      probe: { wallet: ctx.probeWallet, ...budgetState() },
      receipts: ctx.recent,
    }),
    "GET /quote": ({ query }) => quote(Math.round(num(query, "deadline", 2, 1, 32)), num(query, "confidence", 0.9, 0.01, 0.999), probeOutcomes()),
    "GET /tips/addresses": () => ({ beam: ctx.beamTips, jito: JITO_TIP_ACCOUNTS }),
    "POST /send": async ({ body }) => {
      const tx = (body as { tx?: unknown } | undefined)?.tx;
      if (typeof tx !== "string") throw new HttpError(400, "body must be { tx: base64 signed transaction }");
      try {
        return { signature: (await lifecycle.submitSigned(tx, sendSlot(), beamSet)).signature };
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
    },
    "GET /receipt/:signature": async ({ params: [signature] }) => {
      const live = ctx.recent.find((r) => r.signature === signature) ?? lifecycle.activeReceipts().find((r) => r.signature === signature);
      if (live) return live;
      const row = await receiptBySignature(signature as string);
      if (!row) throw new HttpError(404, "unknown signature");
      return asReceipt(row);
    },
    "GET /calibration": calibrationNow,
    "GET /leaders": () => upcomingLeaders(sendSlot()),
    "POST /audit": async ({ body }) => {
      const { address, limit } = (body ?? {}) as { address?: unknown; limit?: unknown };
      const n = limit === undefined ? AUDIT_DEFAULT_LIMIT : Number(limit);
      if (!Number.isInteger(n) || n < 1 || n > AUDIT_MAX_LIMIT) throw new HttpError(400, `limit must be an integer from 1 to ${AUDIT_MAX_LIMIT}`);
      const audit = await runAudit(validAddress(address), n);
      auditRefreshed(audit);
      return audit;
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
  };
}
