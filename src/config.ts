const env = process.env;

function num(name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  return n;
}

const REGIONS = ["", "nyc", "fra", "ams"];
const region = (env.SOLAMI_REGION ?? "").toLowerCase();
if (!REGIONS.includes(region)) throw new Error(`SOLAMI_REGION must be one of nyc, fra, ams (or empty), got "${region}"`);
const host = (service: string) => `${region ? `${region}.` : ""}${service}.solami.dev`;

export const config = {
  apiKey: env.SOLAMI_API_KEY ?? "",
  region: region || "global",
  rpcUrl: `https://${host("rpc")}/sol`,
  apiUrl: `https://${host("api")}`,
  grpcUrl: `https://${host("grpc")}`,
  wsUrl: `wss://${host("ws")}`,
  databaseUrl: env.DATABASE_URL ?? "postgres://photon:photon@localhost:5432/photon",
  port: num("PORT", 8080),
  probeSecret: env.PROBE_SECRET ?? "",
  probeIntervalSec: num("PROBE_INTERVAL_SEC", 60),
  probeBudgetSol: num("PROBE_BUDGET_SOL", 0.05),
  tipCeilingLamports: num("TIP_CEILING_LAMPORTS", 5_000_000),
  auditMaxBlocks: num("AUDIT_MAX_BLOCKS", 40),
  webhookPublicUrl: env.WEBHOOK_PUBLIC_URL ?? "",
};

export function requireApiKey(): string {
  if (!config.apiKey) throw new Error("SOLAMI_API_KEY is not set. Get one at https://solami.dev/signup?ref=st-earn-sep-26");
  return config.apiKey;
}

export const LAMPORTS_PER_SOL = 1_000_000_000;
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const PROBE_MEMO = "photon-probe";

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

export const LEADER_COUNT = 20;
export const LEADER_REFRESH_SLOTS = 40;
export const LEADER_SKIP_SLOTS = 4;

export const AUDIT_DEFAULT_LIMIT = 100;
export const AUDIT_MAX_LIMIT = 300;
export const AUDIT_CONCURRENCY = 8;

export const STREAM_STALE_MS = 15_000;
export const BACKOFF_MAX_MS = 15_000;
