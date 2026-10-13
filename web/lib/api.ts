import type { Audit, Fares, Leader, Receipt, Stats, TrackRecord } from "./types";

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { cache: "no-store", ...init });
  } catch {
    throw new ApiError(0, "Tipwise could not be reached. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(body.error ?? `request failed (${res.status})`), body);
  return body as T;
}

// One automatic retry for a network failure or a server error, after a short
// pause; client errors and rate limits are returned as they are.
export async function retryOnce<T>(fn: () => Promise<T>, delayMs = 1_500): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof ApiError) || (e.status !== 0 && e.status < 500)) throw e;
    await new Promise((r) => setTimeout(r, delayMs));
    return fn();
  }
}

const post = <T>(path: string, body: unknown) =>
  call<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  stats: () => call<Stats>("/stats"),
  fares: () => call<Fares>("/fares"),
  examples: () => call<{ address: string; tips: number; lastSlot: number }[]>("/audit/examples"),
  audit: (address: string) => retryOnce(() => post<Audit>("/audit", { address })),
  storedAudit: (address: string) => call<Audit>(`/audit/${address}`),
  watch: (address: string) => post<{ address: string }>(`/audit/${address}/watch`, {}),
  receipt: (signature: string) => call<Receipt>(`/receipt/${signature}`),
  demo: (fare: string) => post<{ signature: string; fare: string; quotedProbability: number; deadlineSlots: number }>("/demo/send", { fare }),
  send: (tx: string, fare: string) => post<{ signature: string }>("/send", { tx, fare }),
  blockhash: () => call<{ blockhash: string; lastValidBlockHeight: number }>("/blockhash"),
  tipAddresses: () => call<{ beam: string[]; jito: string[] }>("/tips/addresses"),
  trackRecord: () => call<TrackRecord & { testTrips: Stats["testTrips"]; recent: Receipt[] }>("/track-record"),
  leaders: () => call<Leader[]>("/leaders"),
  raw: (path: string) => call<unknown>(path),
};
