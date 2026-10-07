import { createRequire } from "node:module";
import WebSocket from "ws";
import { config, JITO_TIP_ACCOUNTS, requireApiKey } from "./config.js";
import * as solami from "./solami.js";

interface Row {
  product: string;
  check: string;
  ok: boolean;
  detail: string;
}

type Yellowstone = typeof import("@triton-one/yellowstone-grpc");
type SubscribeUpdate = import("@triton-one/yellowstone-grpc").SubscribeUpdate;
const yellowstone = createRequire(import.meta.url)("@triton-one/yellowstone-grpc") as Yellowstone;
const { CommitmentLevel } = yellowstone;

const TIMEOUT_MS = 12_000;

function timeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`no response in ${ms} ms`)), ms))]);
}

async function check(rows: Row[], product: string, name: string, fn: () => Promise<string>): Promise<void> {
  const t0 = Date.now();
  try {
    const detail = await timeout(fn());
    rows.push({ product, check: name, ok: true, detail: `${detail} (${Date.now() - t0} ms)` });
  } catch (e) {
    rows.push({ product, check: name, ok: false, detail: (e as Error).message });
  }
}

function grpcFirstSlot(): Promise<string> {
  const client = new yellowstone.default(config.grpcUrl, requireApiKey(), undefined);
  return new Promise((resolve, reject) => {
    client
      .subscribe()
      .then((stream) => {
        const done = (fn: () => void) => {
          stream.removeAllListeners();
          stream.on("error", () => undefined);
          stream.cancel();
          fn();
        };
        stream.on("data", (u: SubscribeUpdate) => {
          if (u.slot) done(() => resolve(`slot ${u.slot?.slot}`));
        });
        stream.on("error", (e: Error) => done(() => reject(e)));
        stream.write({
          slots: { photon: { filterByCommitment: false } },
          accounts: {},
          transactions: {},
          transactionsStatus: {},
          blocks: {},
          blocksMeta: {},
          entry: {},
          accountsDataSlice: [],
          commitment: CommitmentLevel.PROCESSED,
        });
      })
      .catch(reject);
  });
}

function wsFirstMessage(url: string, accept: (data: WebSocket.RawData, binary: boolean) => string | null): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const finish = (fn: () => void) => {
      ws.removeAllListeners();
      ws.on("error", () => undefined);
      ws.terminate();
      fn();
    };
    ws.on("message", (data, binary) => {
      const hit = accept(data, binary);
      if (hit) finish(() => resolve(hit));
    });
    ws.on("unexpected-response", (_req, res) => finish(() => reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage ?? ""}`.trim()))));
    ws.on("close", (code, reason) => finish(() => reject(new Error(`closed ${code} ${reason.toString()}`.trim()))));
    ws.on("error", (e) => finish(() => reject(e)));
  });
}

export async function doctor(): Promise<boolean> {
  requireApiKey();
  const rows: Row[] = [];
  const probe = JITO_TIP_ACCOUNTS[0] as string;

  await Promise.all([
    check(rows, "RPC", "getSlot", async () => `slot ${await solami.rpc<number>("getSlot", [{ commitment: "processed" }])}`),
    check(rows, "RPC", "getLatestBlockhash", async () => {
      const r = await solami.rpc<{ value: { lastValidBlockHeight: number } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
      return `valid until height ${r.value.lastValidBlockHeight}`;
    }),
    check(rows, "RPC", "getRecentPrioritizationFees", async () => `${(await solami.rpc<unknown[]>("getRecentPrioritizationFees")).length} slots`),
    check(rows, "RPC", "getSlotLeaders", async () => {
      const slot = await solami.rpc<number>("getSlot", [{ commitment: "processed" }]);
      return `${(await solami.rpc<string[]>("getSlotLeaders", [slot, 4])).length} leaders`;
    }),
    check(rows, "RPC", "getTransactionsForAddress", async () => {
      const r = await solami.rpc<{ data: unknown[] }>("getTransactionsForAddress", [probe, { transactionDetails: "signatures", limit: 1 }]);
      return `${r.data.length} row`;
    }),
    check(rows, "gRPC", "subscribe slots", grpcFirstSlot),
    check(rows, "Mirage", "subscription + stream", async () => {
      const id = await solami.mirageSlotSubscription();
      return wsFirstMessage(solami.wsUrl(`/mirage/stream/${id}`), (data, binary) => {
        if (!binary) return null;
        const u = yellowstone.SubscribeUpdate.decode(new Uint8Array(data as Buffer));
        return u.slot ? `slot ${u.slot.slot}` : null;
      });
    }),
    check(rows, "Blur", "stream first event", () =>
      wsFirstMessage(solami.wsUrl("/data/subscribe", { chain: "solana", type: "swap" }), (data) => {
        const ev = JSON.parse(data.toString()) as { type?: string; slot?: number };
        return ev.type ? `${ev.type} at slot ${ev.slot ?? "?"}` : null;
      }),
    ),
    check(rows, "Data API", "SOL price", async () => {
      const price = await solami.solPriceUsd();
      if (price === null) throw new Error("price missing from response");
      return `$${price.toFixed(2)}`;
    }),
    check(rows, "Beam", "tip addresses", async () => `${(await solami.beamTipAddresses()).length} addresses`),
    check(rows, "Beam", "landing record lookup", async () => {
      const r = await solami.beamRecord("1111111111111111111111111111111111111111111111111111111111111111");
      return r ? "record found" : "reachable (unknown signature returns 404)";
    }),
    check(rows, "Leader tracking", "current", async () => {
      const l = await solami.leaderNow();
      return `slot ${l.slot} leader ${l.identity.slice(0, 8)}`;
    }),
    check(rows, "Webhooks", "list", async () => `${(await solami.webhookList()).length} webhooks`),
  ]);

  const order = ["RPC", "gRPC", "Mirage", "Blur", "Data API", "Beam", "Leader tracking", "Webhooks"];
  rows.sort((a, b) => order.indexOf(a.product) - order.indexOf(b.product));
  const w = [16, 30, 13];
  console.log(`\nSolami doctor (region: ${config.region})\n`);
  console.log(`${"product".padEnd(w[0]!)}${"check".padEnd(w[1]!)}${"status".padEnd(w[2]!)}detail`);
  for (const r of rows) {
    console.log(`${r.product.padEnd(w[0]!)}${r.check.padEnd(w[1]!)}${(r.ok ? "reachable" : "UNREACHABLE").padEnd(w[2]!)}${r.detail}`);
  }
  const failed = rows.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} check(s) failed.` : "\nAll Solami products reachable.");
  return failed === 0;
}
