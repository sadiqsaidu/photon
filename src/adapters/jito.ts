import type { BundleGateway, BundleStatus } from "../shared/ports.js";
import type { Slot } from "../shared/types.js";

export class JitoHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(url: string, method: string, params: unknown[], signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal,
  });
  const text = await res.text();
  if (!res.ok) throw new JitoHttpError(`jito ${method}: HTTP ${res.status}`, res.status);
  const body = (text ? JSON.parse(text) : {}) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`jito ${method}: ${body.error.message}`);
  return body.result as T;
}

export class JitoEngine implements BundleGateway {
  readonly engine: string;
  private readonly bundles: string;

  constructor(engine: string) {
    this.engine = engine;
    this.bundles = `${engine}/api/v1/bundles`;
  }

  async tipAccounts(signal?: AbortSignal): Promise<string[]> {
    return call<string[]>(this.bundles, "getTipAccounts", [], signal);
  }

  async nextLeader(signal?: AbortSignal): Promise<{ currentSlot: Slot; nextLeaderSlot: Slot }> {
    // getNextScheduledLeader lives on its own path, not /api/v1/bundles.
    const r = await call<{ current_slot: number; next_leader_slot: number }>(
      `${this.engine}/api/v1/getNextScheduledLeader`,
      "getNextScheduledLeader",
      [],
      signal,
    );
    return { currentSlot: r.current_slot, nextLeaderSlot: r.next_leader_slot };
  }

  async sendBundle(base64Txs: string[], signal?: AbortSignal): Promise<string> {
    return call<string>(this.bundles, "sendBundle", [base64Txs, { encoding: "base64" }], signal);
  }

  async bundleStatus(id: string, signal?: AbortSignal): Promise<BundleStatus> {
    const r = await call<{
      value: { bundle_id: string; slot: number; confirmation_status: string; err: unknown }[];
    }>(this.bundles, "getBundleStatuses", [[id]], signal);
    const v = r.value[0];
    if (!v) return { landed: false, slot: null, err: null };
    return { landed: v.confirmation_status !== null, slot: v.slot ?? null, err: v.err ?? null };
  }
}
