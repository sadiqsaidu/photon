export const API = (process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080").replace(/\/$/, "");

export const solscanTx = (sig: string) => `https://solscan.io/tx/${sig}`;
export const solscanAccount = (addr: string) => `https://solscan.io/account/${addr}`;
export const beamRecordUrl = (sig: string) => `https://api.solami.dev/swqos/tx/${sig}`;

export function lamports(v: number | null | undefined): string {
  if (v === null || v === undefined) return "-";
  return Math.round(v).toLocaleString("en-US");
}

export function compact(v: number): string {
  if (v >= 1e9) return `${+(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${+(v / 1e3).toFixed(1)}k`;
  return `${Math.round(v)}`;
}

export function sol(lamportsValue: number, digits = 6): string {
  return (lamportsValue / 1e9).toFixed(digits);
}

export function short(s: string, head = 6, tail = 4): string {
  return s.length > head + tail + 1 ? `${s.slice(0, head)}...${s.slice(-tail)}` : s;
}

export function pct(v: number | null | undefined, digits = 0): string {
  return v === null || v === undefined ? "-" : `${(v * 100).toFixed(digits)}%`;
}

export async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}
