import { createRequire } from "node:module";
import bs58 from "bs58";
import { config, JITO_TIP_ACCOUNTS, requireApiKey } from "./config.js";
import { supervise, type StreamHealth } from "./stream.js";

type Yellowstone = typeof import("@triton-one/yellowstone-grpc");
type SubscribeUpdate = import("@triton-one/yellowstone-grpc").SubscribeUpdate;
type SubscribeRequest = import("@triton-one/yellowstone-grpc").SubscribeRequest;
type TxInfo = import("@triton-one/yellowstone-grpc").SubscribeUpdateTransactionInfo;

// The ESM build's default export is not typed as a class, so load the CJS build.
export const yellowstone = createRequire(import.meta.url)("@triton-one/yellowstone-grpc") as Yellowstone;

export type SlotStatus = "processed" | "confirmed" | "finalized" | "dead";
const SLOT_STATUS: Record<number, SlotStatus> = { 0: "processed", 1: "confirmed", 2: "finalized", 6: "dead" };

export type TipSource = "jito" | "beam";

export interface Tip {
  slot: number;
  signature: string;
  lamports: number;
  source: TipSource;
  payer: string;
}

export interface GrpcHandlers {
  onSlot(slot: number, status: SlotStatus): void;
  onBlock(slot: number, blockhash: string, blockHeight: number): void;
  onTip(tip: Tip): void;
  onWatchedTx(signature: string, slot: number, failed: boolean): void;
}

const hex = (k: Uint8Array) => Buffer.from(k).toString("hex");
const BYTE_SAMPLE_EVERY = 16;

function request(tipAccounts: string[], watch: string[], fromSlot: number): SubscribeRequest {
  const transactions: SubscribeRequest["transactions"] = {
    tips: { vote: false, failed: false, accountInclude: tipAccounts, accountExclude: [], accountRequired: [] },
  };
  if (watch.length) {
    transactions.watch = { vote: false, failed: true, accountInclude: watch, accountExclude: [], accountRequired: [] };
  }
  return {
    slots: { slots: { filterByCommitment: false } },
    blocksMeta: { blocks: {} },
    transactions,
    accounts: {},
    transactionsStatus: {},
    blocks: {},
    entry: {},
    accountsDataSlice: [],
    commitment: yellowstone.CommitmentLevel.PROCESSED,
    ...(fromSlot ? { fromSlot: String(fromSlot) } : {}),
  };
}

// A tip is the balance increase of a tip account inside a successful
// transaction; v0 transactions can load the tip account through a lookup table.
function tipOf(tx: TxInfo, slot: number, jito: Set<string>, beam: Set<string>): Tip | null {
  const meta = tx.meta;
  const message = tx.transaction?.message;
  if (!meta || !message) return null;
  const keys = [...message.accountKeys, ...meta.loadedWritableAddresses, ...meta.loadedReadonlyAddresses];
  let lamports = 0;
  let source: TipSource | null = null;
  keys.forEach((key, i) => {
    const h = hex(key);
    const isJito = jito.has(h);
    if (!isJito && !beam.has(h)) return;
    const delta = Number(meta.postBalances[i] ?? 0) - Number(meta.preBalances[i] ?? 0);
    if (delta <= 0) return;
    lamports += delta;
    source = source === "beam" || !isJito ? "beam" : "jito";
  });
  if (!source || lamports === 0) return null;
  return { slot, signature: bs58.encode(tx.signature), lamports, source, payer: bs58.encode(message.accountKeys[0] ?? new Uint8Array()) };
}

export function startGrpc(beamTips: string[], watch: string[], h: GrpcHandlers): StreamHealth {
  const toHex = (a: string) => hex(bs58.decode(a));
  const jito = new Set(JITO_TIP_ACCOUNTS.map(toHex));
  const beam = new Set(beamTips.map(toHex));
  const tipAccounts = [...JITO_TIP_ACCOUNTS, ...beamTips];
  let lastSlot = 0;
  let seen = 0;

  const handle = (u: SubscribeUpdate, health: StreamHealth) => {
    if (++seen % BYTE_SAMPLE_EVERY === 0) health.bytes += yellowstone.SubscribeUpdate.encode(u).finish().length * BYTE_SAMPLE_EVERY;
    if (u.slot) {
      const status = SLOT_STATUS[u.slot.status];
      const slot = Number(u.slot.slot);
      if (status === "processed" && slot > lastSlot) lastSlot = slot;
      if (status) h.onSlot(slot, status);
    }
    if (u.blockMeta?.blockHeight) {
      h.onBlock(Number(u.blockMeta.slot), u.blockMeta.blockhash, Number(u.blockMeta.blockHeight.blockHeight));
    }
    const tx = u.transaction?.transaction;
    if (tx && u.transaction) {
      const slot = Number(u.transaction.slot);
      if (u.filters.includes("watch")) h.onWatchedTx(bs58.encode(tx.signature), slot, Boolean(tx.meta?.err));
      if (u.filters.includes("tips")) {
        const tip = tipOf(tx, slot, jito, beam);
        if (tip) h.onTip(tip);
      }
    }
  };

  return supervise("grpc", async (health, signal) => {
    const client = new yellowstone.default(config.grpcUrl, requireApiKey(), {
      "grpc.max_receive_message_length": 64 * 1024 * 1024,
    });
    const stream = await client.subscribe();
    await new Promise<void>((resolve, reject) => {
      signal.addEventListener("abort", () => {
        stream.cancel();
        reject(signal.reason as Error);
      });
      stream.on("data", (u: SubscribeUpdate) => {
        health.lastEventAt = Date.now();
        handle(u, health);
      });
      stream.on("error", reject);
      stream.on("end", resolve);
      // Resume one slot early after a reconnect; tips are deduplicated by signature.
      stream.write(request(tipAccounts, watch, lastSlot ? lastSlot - 1 : 0), (err: Error | null | undefined) => {
        if (err) reject(err);
        else health.connected = true;
      });
    });
  });
}
