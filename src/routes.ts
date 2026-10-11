import { PublicKey } from "@solana/web3.js";
import { runAudit } from "./audit.js";
import { blurCounts } from "./blur.js";
import {
  AUDIT_DEFAULT_LIMIT,
  AUDIT_MAX_LIMIT,
  AUDIT_PER_MINUTE,
  AUDIT_REUSE_MS,
  config,
  DEMO_COOLDOWN_MS,
  DEMO_IP_COOLDOWN_MS,
  EXAMPLE_WALLETS,
  FARES,
  JITO_TIP_ACCOUNTS,
  WATCH_PER_MINUTE,
  type FareId,
} from "./config.js";
import { latestReceipts, loadAudit, receiptBySignature, type ProbeFields, type ReceiptRow } from "./db.js";
import { upcomingLeaders } from "./leaders.js";
import * as lifecycle from "./lifecycle.js";
import { raceStats } from "./mirage.js";
import { budgetState, demoRefusal, probeKeypair, probeOutcomes, probeSummary, sendDemo } from "./probe.js";
import type { products } from "./products.js";
import { calibration, quote, reachableBuckets, trackRecord, type fares } from "./quote.js";
import { HttpError, limiter, type Handler } from "./server.js";
import { solPrice, rpc } from "./solami.js";
import type { StreamHealth } from "./stream.js";
import { distribution, mood, tipState, topPayers } from "./tips.js";
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
  fares(): Promise<Awaited<ReturnType<typeof fares>>>;
  products(): ReturnType<typeof products>;
  onDemoSent(r: lifecycle.Receipt, fields: Partial<ProbeFields>): void;
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
    fare: row.fare as FareId | null,
    quotedProbability: row.quotedProbability,
    deadlineSlots: row.deadlineSlots,
  };
}

const STANDARD = FARES.find((f) => f.id === "standard") ?? (FARES[0] as (typeof FARES)[number]);

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

function trackRecordNow() {
  return trackRecord(probeOutcomes(), STANDARD.deadlineSlots, reachableBuckets(distribution().sorted));
}

function fareId(value: unknown): FareId {
  const f = FARES.find((x) => x.id === value);
  if (!f) throw new HttpError(400, `fare must be one of ${FARES.map((x) => x.id).join(", ")}`);
  return f.id;
}

const tooMany = (reason: string, retryAfterSec: number | null, error: string) => new HttpError(429, error, { retryAfterSec, reason });

export function routes(ctx: Context): Record<string, Handler> {
  const beamSet = new Set(ctx.beamTips);
  const sendSlot = () => Math.max(ctx.slot(), ctx.chainTip());
  const audits = limiter(AUDIT_PER_MINUTE, 60_000);
  const watches = limiter(WATCH_PER_MINUTE, 60_000);
  const demoGlobal = limiter(1, DEMO_COOLDOWN_MS);
  const demoIp = limiter(1, DEMO_IP_COOLDOWN_MS);
  const live = (signature: string) => ctx.recent.find((r) => r.signature === signature) ?? lifecycle.activeReceipts().find((r) => r.signature === signature);
  const promiseFor = async (fare: FareId): Promise<lifecycle.FarePromise> => {
    const f = (await ctx.fares()).fares.find((x) => x.id === fare);
    if (!f) throw new HttpError(503, "fares are not ready yet");
    return { fare, quotedProbability: f.probability, deadlineSlots: f.deadlineSlots };
  };
  return {
    "GET /health": () => ({
      ok: ctx.streams().every((s) => s.connected),
      slot: ctx.slot(),
      behind: ctx.behind(),
      maxBehind: ctx.maxBehind(),
      degraded: ctx.degraded(),
      streams: ctx.streams(),
    }),
    "GET /stats": async () => ({
      slot: ctx.slot(),
      chainTip: ctx.chainTip(),
      behind: ctx.behind(),
      maxBehind: ctx.maxBehind(),
      degraded: ctx.degraded(),
      streams: ctx.streams(),
      race: raceStats(),
      blur: { counts: blurCounts, since: ctx.startedAt },
      tips: tipState(),
      mood: mood(),
      fares: await ctx.fares(),
      solPrice: solPrice(),
      products: await ctx.products(),
      calibration: calibrationNow(),
      trackRecord: trackRecordNow(),
      testTrips: probeSummary(),
      receipts: ctx.recent.map(lifecycle.withExplanation),
    }),
    "GET /fares": async () => ({ ...(await ctx.fares()), mood: mood(), updatedAt: Date.now() }),
    "GET /track-record": async () => ({
      ...trackRecordNow(),
      testTrips: probeSummary(),
      recent: (await latestReceipts(30, "probe")).map(asReceipt).map(lifecycle.withExplanation),
    }),
    "GET /audit/examples": () => topPayers(new Set(ctx.probeWallet ? [ctx.probeWallet] : []), EXAMPLE_WALLETS),
    "GET /blockhash": async () => {
      const streamed = lifecycle.confirmedBlockhash();
      if (streamed) return streamed;
      const { value } = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
      return { blockhash: value.blockhash, lastValidBlockHeight: value.lastValidBlockHeight };
    },
    "POST /demo/send": async ({ body, ip }) => {
      const fare = fareId((body as { fare?: unknown } | undefined)?.fare ?? "standard");
      if (!probeKeypair()) throw new HttpError(503, "free test sends are not set up on this server", { reason: "disabled" });
      const global = demoGlobal.wait("all");
      if (global) throw tooMany("cooldown", global, "someone just sent a test");
      const mine = demoIp.wait(ip);
      if (mine) throw tooMany("ip", mine, "you sent a test a moment ago");
      const f = (await ctx.fares()).fares.find((x) => x.id === fare);
      if (!f) throw new HttpError(503, "fares are not ready yet", { reason: "warming" });
      const refusal = demoRefusal(f);
      if (refusal) throw tooMany(refusal.reason, refusal.retryAfterSec, refusal.error);
      demoGlobal.hit("all");
      demoIp.hit(ip);
      const signature = await sendDemo(f, sendSlot(), ctx.onDemoSent);
      return { signature, fare, quotedProbability: f.probability, deadlineSlots: f.deadlineSlots };
    },
    "GET /admin/probe": ({ headers }) => {
      if (!config.adminToken || headers.authorization !== `Bearer ${config.adminToken}`) throw new HttpError(404, "not found");
      return { wallet: ctx.probeWallet, ...budgetState() };
    },
    "GET /quote": ({ query }) => quote(Math.round(num(query, "deadline", 2, 1, 32)), num(query, "confidence", 0.9, 0.01, 0.999), probeOutcomes()),
    "GET /tips/addresses": () => ({ beam: ctx.beamTips, jito: JITO_TIP_ACCOUNTS }),
    "POST /send": async ({ body }) => {
      const { tx, fare } = (body ?? {}) as { tx?: unknown; fare?: unknown };
      if (typeof tx !== "string") throw new HttpError(400, "body must be { tx: base64 signed transaction, fare? }");
      const promise = fare === undefined ? undefined : await promiseFor(fareId(fare));
      try {
        return { signature: (await lifecycle.submitSigned(tx, sendSlot(), beamSet, promise)).signature };
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
    },
    "GET /receipt/:signature": async ({ params: [signature] }) => {
      const found = live(signature as string);
      if (found) return lifecycle.withExplanation(found);
      const row = await receiptBySignature(signature as string);
      if (!row) throw new HttpError(404, "unknown signature");
      return lifecycle.withExplanation(asReceipt(row));
    },
    "GET /calibration": calibrationNow,
    "GET /leaders": () => upcomingLeaders(sendSlot()),
    "POST /audit": async ({ body, ip }) => {
      const { address, limit } = (body ?? {}) as { address?: unknown; limit?: unknown };
      const n = limit === undefined ? AUDIT_DEFAULT_LIMIT : Number(limit);
      if (!Number.isInteger(n) || n < 1 || n > AUDIT_MAX_LIMIT) throw new HttpError(400, `limit must be an integer from 1 to ${AUDIT_MAX_LIMIT}`);
      const wallet = validAddress(address);
      const stored = (await loadAudit(wallet)) as { updatedAt?: number } | null;
      if (stored?.updatedAt && Date.now() - stored.updatedAt < AUDIT_REUSE_MS) return stored;
      const wait = audits.wait(ip);
      if (wait) throw tooMany("ip", wait, "too many checkups from this address; try again shortly");
      audits.hit(ip);
      const audit = await runAudit(wallet, n);
      auditRefreshed(audit);
      return audit;
    },
    "GET /audit/:address": async ({ params: [address] }) => {
      const audit = await loadAudit(validAddress(address));
      if (!audit) throw new HttpError(404, "no audit for this address yet; POST /audit first");
      return audit;
    },
    "POST /audit/:address/watch": async ({ params: [address], ip }) => {
      const wait = watches.wait(ip);
      if (wait) throw tooMany("ip", wait, "too many watch requests; try again shortly");
      watches.hit(ip);
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
