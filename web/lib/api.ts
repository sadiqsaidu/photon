export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080";

export interface UnsignedBundle {
  messageBase64: string;
  tipAccount: string;
  tip: number;
  blockhash: string;
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

export type Payload = { kind: "sol_transfer"; to: string; lamports: number } | { kind: "memo" };

export function prepareBundle(payer: string, tip: number, payload: Payload): Promise<UnsignedBundle> {
  return post<UnsignedBundle>("/bundle/prepare", { payer, tip, payload });
}

export function submitBundle(signedTxs: string[], signature: string, tip: number): Promise<{ bundleId: string | null }> {
  return post("/bundle/submit", { signedTxs, signature, tip });
}

export function injectFault(): Promise<{ signature: string }> {
  return post("/fault", {});
}
