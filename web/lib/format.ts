export const LAMPORTS_PER_SOL = 1_000_000_000;
export const SLOT_MS = 400;
// Matches AUDIT_PROJECTION_MIN_SEC on the API; older servers projected from less.
export const PROJECTION_MIN_SEC = 10 * 60;

export function showsProjection(s: { monthlyOverpayLamports: number | null; overpayLamports: number; periodFrom: number | null; periodTo: number | null }): boolean {
  if (s.monthlyOverpayLamports === null || s.overpayLamports <= 0 || s.periodFrom === null || s.periodTo === null) return false;
  return s.periodTo - s.periodFrom >= PROJECTION_MIN_SEC;
}

const group = (n: number) => n.toLocaleString("en-US");

export function usd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  if (value === 0) return "$0";
  const abs = Math.abs(value);
  if (abs < 0.001) return "under $0.001";
  if (abs < 1) return `$${value.toFixed(3)}`;
  if (abs < 1_000) return `$${value.toFixed(2)}`;
  return `$${group(Math.round(value))}`;
}

export function lamportsToUsd(lamports: number, price: number | null | undefined): number | null {
  return price ? (lamports / LAMPORTS_PER_SOL) * price : null;
}

// SOL with three significant digits for small amounts, four decimals above 0.1.
export function sol(lamports: number, unit = true): string {
  const v = lamports / LAMPORTS_PER_SOL;
  let s: string;
  if (v === 0) s = "0";
  else if (v >= 0.1) s = v.toFixed(4);
  else s = v.toPrecision(3).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  if (s.includes("e")) s = v.toFixed(9).replace(/0+$/, "");
  return unit ? `${s} SOL` : s;
}

// Dollars first, SOL second, as one phrase.
export function money(lamports: number, price: number | null | undefined): string {
  const d = lamportsToUsd(lamports, price);
  return d === null ? sol(lamports) : `${usd(d)} (${sol(lamports)})`;
}

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}\u00a0s`;
export const blocksToSeconds = (blocks: number) => seconds(blocks * SLOT_MS);
export const blocks = (n: number) => `${group(n)} ${n === 1 ? "block" : "blocks"}`;
export const pct = (p: number) => `${Math.round(p * 100)}%`;
export const number = group;

export function shortAddress(a: string, n = 4): string {
  return a.length > n * 2 + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a;
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export function duration(sec: number): string {
  if (sec < 90) return `${Math.max(1, Math.round(sec))} seconds`;
  const m = Math.round(sec / 60);
  if (m < 90) return `${m} minutes`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} hours` : `${Math.round(h / 24)} days`;
}

export const solscan = (signature: string) => `https://solscan.io/tx/${signature}`;
export const solscanAccount = (address: string) => `https://solscan.io/account/${address}`;

export function isAddress(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.trim());
}
