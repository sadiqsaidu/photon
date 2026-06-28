export function sol(lamports: number): string {
  return (lamports / 1e9).toFixed(6);
}

export function shortSig(sig: string): string {
  return sig.length > 12 ? `${sig.slice(0, 6)}…${sig.slice(-4)}` : sig;
}

export function ms(value: number | null): string {
  if (value === null) return "—";
  return `${value}ms`;
}

export function ago(at: number): string {
  const d = Math.max(0, Date.now() - at);
  if (d < 1000) return "now";
  if (d < 60_000) return `${Math.floor(d / 1000)}s`;
  return `${Math.floor(d / 60_000)}m`;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
