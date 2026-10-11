import { EventEmitter } from "node:events";

const env = process.env;

// The one event bus: every SSE event name is emitted here with its payload.
export const bus = new EventEmitter();
bus.setMaxListeners(100);

function num(name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  return n;
}

// ams measured fastest from where this was built; "global" routes to the nearest node.
const REGIONS = ["nyc", "fra", "ams", "global"];
const region = (env.SOLAMI_REGION || "ams").toLowerCase();
if (!REGIONS.includes(region)) throw new Error(`SOLAMI_REGION must be one of nyc, fra, ams, global; got "${region}"`);
const host = (service: string) => `${region === "global" ? "" : `${region}.`}${service}.solami.dev`;

export const config = {
  apiKey: env.SOLAMI_API_KEY ?? "",
  region,
  rpcUrl: `https://${host("rpc")}/sol`,
  apiUrl: `https://${host("api")}`,
  grpcUrl: `https://${host("grpc")}`,
  wsUrl: `wss://${host("ws")}`,
  databaseUrl: env.DATABASE_URL ?? "postgres://tipwise:tipwise@localhost:5432/tipwise",
  port: num("PORT", 8080),
  probeSecret: env.PROBE_SECRET ?? "",
  probeIntervalSec: num("PROBE_INTERVAL_SEC", 60),
  probeBudgetSol: num("PROBE_BUDGET_SOL", 0.05),
  // Max probes one process sends; 0 means until calibrated or out of budget.
  probeLimit: num("PROBE_LIMIT", 0),
  tipCeilingLamports: num("TIP_CEILING_LAMPORTS", 1_000_000),
  auditMaxBlocks: num("AUDIT_MAX_BLOCKS", 40),
  webhookPublicUrl: env.WEBHOOK_PUBLIC_URL ?? "",
  adminToken: env.ADMIN_TOKEN ?? "",
  demoDailyMax: num("DEMO_DAILY_MAX", 40),
  allowedOrigins: (env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim().replace(/\/$/, "")).filter(Boolean),
};

export function requireApiKey(): string {
  if (!config.apiKey) throw new Error("SOLAMI_API_KEY is not set. Get one at https://solami.dev/signup?ref=st-earn-sep-26");
  return config.apiKey;
}

export const LAMPORTS_PER_SOL = 1_000_000_000;
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const PROBE_MEMO = "tipwise-probe";
export const DEMO_MEMO = "tipwise-demo";

// Solami resources created before the rename; deleted at startup.
export const LEGACY_LABELS = { mirage: "photon-slots", webhook: "photon-audit" };
export const MIRAGE_LABEL = "tipwise-slots";
export const WEBHOOK_LABEL = "tipwise-audit";

export const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

// Beam rejects transactions whose tip is below this floor (tip_too_low).
export const BEAM_MIN_TIP = 100_000;
export const BASE_FEE_PER_SIGNATURE = 5_000;
// A blockhash stays valid for 150 blocks after the block that produced it.
export const BLOCKHASH_VALID_BLOCKS = 150;

export const TIP_WINDOW_SLOTS = 600;
export const BEAM_MIN_SAMPLES = 200;

export const HEAT_WEIGHTS: Record<string, number> = {
  swap: 1,
  token_create: 3,
  pool_create: 5,
  surge: 5,
  graduation: 10,
};
export const LAG_WINDOW_SLOTS = 900;
export const LAG_MAX_K = 20;
export const LAG_INTERVAL_MS = 30_000;
export const LAG_MIN_R = 0.2;
export const HEAT_MULT_MIN = 0.8;
export const HEAT_MULT_MAX = 2.0;

export const BUCKETS = [
  { lo: 0, hi: 25, prior: 0.5 },
  { lo: 25, hi: 50, prior: 0.65 },
  { lo: 50, hi: 75, prior: 0.8 },
  { lo: 75, hi: 90, prior: 0.9 },
  { lo: 90, hi: 100, prior: 0.95 },
];
export const MIN_BUCKET_PROBES = 10;
export const PRIORITY_FEE_TTL_MS = 10_000;
export const PROBE_COMPUTE_UNIT_PRICE = 1_000;
export const PROBE_COMPUTE_UNIT_LIMIT = 20_000;

export const SLOT_MS = 400;
export type FareId = "saver" | "standard" | "express";
export const FARES: { id: FareId; label: string; deadlineSlots: number; confidence: number }[] = [
  { id: "saver", label: "Saver", deadlineSlots: 10, confidence: 0.8 },
  { id: "standard", label: "Standard", deadlineSlots: 6, confidence: 0.9 },
  { id: "express", label: "Express", deadlineSlots: 3, confidence: 0.95 },
];
// Fares price the live window without the per-slot trend: per-slot p50 and p90
// swing by 10x between slots, so any projection made the board jump by 2 to 4x.
export const FARE_FORECAST_SLOTS = 0;
export const FARES_EVERY_MS = 2_000;
export const PRODUCTS_EVERY_MS = 5_000;
export const SOL_PRICE_EVERY_MS = 60_000;

export const MOOD_RECENT_SLOTS = 50;
export const MOOD_QUIET_BELOW = 0.8;
export const MOOD_RUSH_ABOVE = 1.5;

export const PAYER_WINDOW_MS = 10 * 60_000;
export const EXAMPLE_WALLETS = 3;

export const DEMO_COOLDOWN_MS = 20_000;
export const DEMO_IP_COOLDOWN_MS = 3 * 60_000;
export const AUDIT_PER_MINUTE = 6;
export const WATCH_PER_MINUTE = 3;
export const AUDIT_REUSE_MS = 60_000;
// Live watching ends by itself so busy wallets do not pile up on the webhook.
export const WATCH_TTL_MS = 15 * 60_000;

// Wallet checkup stamps: share of tips above the going rate, share too low.
export const STAMP_OVERPAID_SHARE = 0.3;
export const STAMP_TOO_LOW_SHARE = 0.25;

export const LEADER_COUNT = 20;
export const LEADER_REFRESH_SLOTS = 40;
export const LEADER_SKIP_SLOTS = 4;

export const AUDIT_DEFAULT_LIMIT = 100;
export const AUDIT_MAX_LIMIT = 300;
export const AUDIT_CONCURRENCY = 8;

export const STREAM_STALE_MS = 15_000;
export const BACKOFF_MAX_MS = 15_000;
