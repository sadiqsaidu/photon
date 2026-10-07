import https from "node:https";
import { config, requireApiKey, SOL_MINT } from "./config.js";

export class SolamiError extends Error {
  constructor(
    readonly product: string,
    message: string,
    readonly status?: number,
  ) {
    super(`${product}: ${message}`);
  }
}

const TIMEOUT_MS = 15_000;

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { message?: string; error?: string };
    return `${res.status} ${body.message ?? body.error ?? text}`;
  } catch {
    return `${res.status} ${text.slice(0, 200)}`;
  }
}

// The RPC key travels in the query string (header auth answers 401), so the
// URL must never be logged.
export async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const url = `${config.rpcUrl}?api_key=${requireApiKey()}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new SolamiError("rpc", `${method} network error: ${(e as Error).message}`);
  }
  if (!res.ok) throw new SolamiError("rpc", `${method} ${await readError(res)}`, res.status);
  const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
  if (body.error) throw new SolamiError("rpc", `${method} ${body.error.code} ${body.error.message}`);
  return body.result as T;
}

type ApiAuth = "none" | "key" | "bearer";

export async function api<T>(path: string, opts: { auth?: ApiAuth; body?: unknown; product?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.auth === "key") headers["x-api-key"] = requireApiKey();
  if (opts.auth === "bearer") headers.authorization = `Bearer ${requireApiKey()}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const product = opts.product ?? path.split("/")[1] ?? "api";
  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}${path}`, {
      method: opts.body === undefined ? "GET" : "POST",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new SolamiError(product, `${path} network error: ${(e as Error).message}`);
  }
  if (!res.ok) throw new SolamiError(product, `${path} ${await readError(res)}`, res.status);
  return (await res.json()) as T;
}

// Honors HTTPS_PROXY/NO_PROXY on Node versions that support proxyEnv; a plain
// agent everywhere else.
export const wsAgent = new https.Agent({ proxyEnv: process.env } as https.AgentOptions);

export function wsUrl(path: string, query: Record<string, string> = {}): string {
  const q = new URLSearchParams({ ...query, api_key: requireApiKey() });
  return `${config.wsUrl}${path}?${q}`;
}

// Beam: a plain sendTransaction to Solami RPC that carries a transfer to one of
// these addresses is routed through Beam (the RPC path of swQoS).
let tipCache: { at: number; addresses: string[] } | null = null;
export async function beamTipAddresses(): Promise<string[]> {
  if (tipCache && Date.now() - tipCache.at < 600_000) return tipCache.addresses;
  const addresses = await api<string[]>("/onchain/tip-addresses", { product: "beam" });
  if (!Array.isArray(addresses) || addresses.length === 0) throw new SolamiError("beam", "tip-addresses returned no addresses");
  tipCache = { at: Date.now(), addresses };
  return addresses;
}

export function beamSend(base64Tx: string): Promise<string> {
  return rpc<string>("sendTransaction", [base64Tx, { encoding: "base64", skipPreflight: true, maxRetries: 0 }]);
}

export interface BeamRecord {
  signature: string;
  is_landed: boolean;
  landed_via_jito: boolean;
  rebroadcasted: boolean;
  region: string;
  tip_lamports: number;
  tip_address: string;
  bundle_uuid: string | null;
  first_seen_ms: number;
  forwarded_ms: number;
  timestamp: number;
}

export async function beamRecord(signature: string): Promise<BeamRecord | null> {
  try {
    return await api<BeamRecord>(`/swqos/tx/${signature}`, { product: "beam" });
  } catch (e) {
    if (e instanceof SolamiError && e.status === 404) return null;
    throw e;
  }
}

export interface LeaderNow {
  slot: number;
  identity: string;
}

export function leaderNow(): Promise<LeaderNow> {
  return api<LeaderNow>("/leader-tracking/current", { product: "leader-tracking" });
}

export async function solPriceUsd(): Promise<number | null> {
  const rows = await api<{ mint: string; price_usd: string }[]>(`/data/token/price?chain=solana&address=${SOL_MINT}`, {
    auth: "key",
    product: "data",
  });
  const price = Number(rows.find((r) => r.mint === SOL_MINT)?.price_usd);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export interface Webhook {
  id: string;
  label: string;
  url: string;
  stream: boolean;
  addresses: string[];
  event_types: string[];
  payload_kind: "enriched" | "raw";
  region: string;
  enabled: boolean;
  secret?: string;
}

// One frame of a stream (or one POST body) for an `enriched` transfer webhook.
export interface WebhookEvent {
  webhook_id: string;
  signature: string;
  slot: number;
  status: "succeeded" | "failed";
  type: string;
  transfers?: { native: boolean; amount: string; from_owner: string; to_owner: string }[];
}

// Stream-only webhooks must name a region and are served from that region's host.
export const webhookRegion = config.region === "global" ? "nyc" : config.region;

export function webhookStreamUrl(id: string): string {
  return `wss://${webhookRegion}.ws.solami.dev/webhooks/stream/${id}?api_key=${requireApiKey()}`;
}

export function webhookList(): Promise<Webhook[]> {
  return api<Webhook[]>("/webhooks/list", { auth: "bearer", body: {} });
}

export function webhookCreate(body: Record<string, unknown>): Promise<Webhook> {
  return api<Webhook>("/webhooks/create", { auth: "bearer", body });
}

export function webhookUpdate(body: Record<string, unknown>): Promise<Webhook> {
  return api<Webhook>("/webhooks/update", { auth: "bearer", body });
}

export interface MirageSubscription {
  id: string;
  label: string;
}

function mirageList(): Promise<MirageSubscription[]> {
  return api<MirageSubscription[]>("/mirage/list", { auth: "bearer", body: {} });
}

function mirageCreate(label: string, filter: Record<string, unknown>): Promise<MirageSubscription> {
  return api<MirageSubscription>("/mirage/create", { auth: "bearer", body: { label, filter } });
}

export async function mirageSlotSubscription(): Promise<string> {
  const existing = (await mirageList()).find((s) => s.label === "photon-slots");
  if (existing) return existing.id;
  return (await mirageCreate("photon-slots", { slots: true, commitment: "processed" })).id;
}
