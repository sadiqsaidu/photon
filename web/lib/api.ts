export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080";

export interface UnsignedBundle {
  messageBase64: string;
  tipAccount: string;
  tip: number;
  blockhash: string;
  lastValidBlockHeight: number | null;
  blockhashSource: "stream" | "rpc" | "injected";
}

export interface ValidatorInfo {
  votePubkey: string;
  activatedStake: number;
  commission: number;
  mevCommissionBps: number | null;
  runningJito: boolean;
}

export interface JitoWindowRow {
  start: number;
  end: number;
  identity: string;
  slotsAway: number;
  etaMs: number;
  validator: ValidatorInfo | null;
}

export interface LeadersPayload {
  currentSlot: number;
  windowOpen: boolean;
  slotsToLeader: number;
  slotMs: number;
  windows: JitoWindowRow[];
}

export interface EngineHealth {
  engine: string;
  region: string;
  rttMs: number | null;
  ok: boolean;
  coolingDown: boolean;
  at: number;
}

export interface SimResult {
  err: unknown;
  logs: string[];
  unitsConsumed: number | null;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path}: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

export type Payload = { kind: "sol_transfer"; to: string; lamports: number } | { kind: "memo" };

export function prepareBundle(payer: string, tip: number, payload: Payload, turbo: boolean): Promise<UnsignedBundle> {
  return post<UnsignedBundle>("/bundle/prepare", { payer, tip, payload, turbo });
}

export function simulateTx(signedTx: string): Promise<SimResult> {
  return post<SimResult>("/bundle/simulate", { signedTx });
}

export function submitBundle(signedTxs: string[], signature: string, tip: number): Promise<{ bundleId: string | null }> {
  return post("/bundle/submit", { signedTxs, signature, tip });
}

export function fetchLeaders(): Promise<LeadersPayload> {
  return get<LeadersPayload>("/leaders");
}

export function fetchEngines(): Promise<EngineHealth[]> {
  return get<EngineHealth[]>("/engines");
}

export function injectFault(): Promise<{ signature: string }> {
  return post("/fault", {});
}
