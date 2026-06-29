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

  slot(): Promise<number> {
    return call<number>(this.url, "getSlot", [{ commitment: "confirmed" }]);
  }

  slotLeaders(start: number, limit: number): Promise<string[]> {
    return call<string[]>(this.url, "getSlotLeaders", [start, limit]);
  }

  epochInfo(): Promise<{ epoch: number; slotIndex: number; slotsInEpoch: number; absoluteSlot: number }> {
    return call(this.url, "getEpochInfo", [{ commitment: "confirmed" }]);
  }

  async tps(): Promise<number> {
    const samples = await call<{ numTransactions: number; samplePeriodSecs: number }[]>(
      this.url,
      "getRecentPerformanceSamples",
      [1],
    );
    const s = samples[0];
    return s && s.samplePeriodSecs > 0 ? Math.round(s.numTransactions / s.samplePeriodSecs) : 0;
  }

  async voteAccounts(): Promise<{ nodePubkey: string; votePubkey: string }[]> {
    const r = await call<{ current: { nodePubkey: string; votePubkey: string }[] }>(
      this.url,
      "getVoteAccounts",
      [{ commitment: "confirmed" }],
    );
    return r.current;
  }
}
