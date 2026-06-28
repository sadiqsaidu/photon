import type { Commitment } from "../shared/types.js";
import type { RpcGateway } from "../shared/ports.js";

async function call<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`rpc ${method}: ${body.error.message}`);
  return body.result as T;
}

export class SolanaRpc implements RpcGateway {
  constructor(private readonly url: string) {}

  async latestBlockhash(commitment: Commitment) {
    const r = await call<{ value: { blockhash: string; lastValidBlockHeight: number } }>(
      this.url,
      "getLatestBlockhash",
      [{ commitment }],
    );
    return r.value;
  }

  blockHeight(): Promise<number> {
    return call<number>(this.url, "getBlockHeight", [{ commitment: "confirmed" }]);
  }
}
