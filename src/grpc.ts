import { createRequire } from "node:module";
import bs58 from "bs58";
import { config, JITO_TIP_ACCOUNTS, requireApiKey } from "./config.js";
import { streamError, supervise, type StreamHealth } from "./stream.js";

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
  onTx(signature: string, slot: number, failed: boolean): void;
}

const hex = (k: Uint8Array) => Buffer.from(k).toString("hex");
const BYTE_SAMPLE_EVERY = 32;
const QUEUE_CAPACITY = 50_000;
const WORK_SLICE_MS = 8;
const WARN_EVERY_MS = 30_000;
// Solami replays at most 3,500 slots; past that a resume would be refused.
const REPLAY_WINDOW_MS = 15 * 60_000;

// Every transaction Photon sends carries a Beam tip, so the tip filters also
// drive lifecycle tracking. Successful transactions arrive in full (balances
// give the tip); failed ones are needed only for Photon's own sends, so they
// come as status-only updates and only for Beam tip addresses. In Yellowstone
// `failed: true` means failed transactions only.
function request(tipAccounts: string[], beamTips: string[], fromSlot: number): SubscribeRequest {
  return {
    slots: { slots: { filterByCommitment: false, interslotUpdates: false } },
    blocksMeta: { blocks: {} },
    transactions: { tips: { vote: false, failed: false, accountInclude: tipAccounts, accountExclude: [], accountRequired: [] } },
    transactionsStatus: { beamFailed: { vote: false, failed: true, accountInclude: beamTips, accountExclude: [], accountRequired: [] } },
    accounts: {},
    blocks: {},
    entry: {},
    accountsDataSlice: [],
    commitment: yellowstone.CommitmentLevel.PROCESSED,
    ...(fromSlot ? { fromSlot: String(fromSlot) } : {}),
  };
}

// A tip is the balance increase of a tip account inside a successful
// transaction; v0 transactions can load the tip account through a lookup table.
function tipOf(tx: TxInfo, slot: number, jito: Set<string>, beam: Set<string>, prefixes: Set<number>): Tip | null {
  const meta = tx.meta;
  const message = tx.transaction?.message;
  if (!meta || !message) return null;
  const keys = [...message.accountKeys, ...meta.loadedWritableAddresses, ...meta.loadedReadonlyAddresses];
  let lamports = 0;
  let source: TipSource | null = null;
  keys.forEach((key, i) => {
    // Most keys are not tip accounts; a 4-byte prefix check skips them cheaply.
    if (!prefixes.has(Buffer.from(key.buffer, key.byteOffset, 4).readUInt32LE(0))) return;
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

export function startGrpc(beamTips: string[], h: GrpcHandlers): StreamHealth {
  const toHex = (a: string) => hex(bs58.decode(a));
  const jito = new Set(JITO_TIP_ACCOUNTS.map(toHex));
  const beam = new Set(beamTips.map(toHex));
  const tipAccounts = [...JITO_TIP_ACCOUNTS, ...beamTips];
  const prefixes = new Set(tipAccounts.map((a) => Buffer.from(bs58.decode(a)).readUInt32LE(0)));
  let lastSlot = 0;
  let lastSlotAt = 0;
  let seen = 0;

  // The receive callback only enqueues, so grpc-js keeps draining the socket
  // and Solami's server-side buffer never fills; this worker does the rest in
  // short slices that yield to I/O. When full, transaction updates are shed
  // (and counted); slot and block-meta updates are always kept.
  const queue: SubscribeUpdate[] = [];
  let head = 0;
  let scheduled = false;
  let warnedAt = 0;
  const q = { depth: 0, maxDepth: 0, capacity: QUEUE_CAPACITY, dropped: 0 };

  const handle = (u: SubscribeUpdate, health: StreamHealth) => {
    if (++seen % BYTE_SAMPLE_EVERY === 0) health.bytes += yellowstone.SubscribeUpdate.encode(u).finish().length * BYTE_SAMPLE_EVERY;
    if (u.slot) {
      const status = SLOT_STATUS[u.slot.status];
      const slot = Number(u.slot.slot);
      if (status === "processed" && slot > lastSlot) {
        lastSlot = slot;
        lastSlotAt = Date.now();
      }
      if (status) h.onSlot(slot, status);
    }
    if (u.blockMeta?.blockHeight) {
      h.onBlock(Number(u.blockMeta.slot), u.blockMeta.blockhash, Number(u.blockMeta.blockHeight.blockHeight));
    }
    const tx = u.transaction?.transaction;
    if (tx && u.transaction) {
      const slot = Number(u.transaction.slot);
      h.onTx(bs58.encode(tx.signature), slot, false);
      const tip = tipOf(tx, slot, jito, beam, prefixes);
      if (tip) h.onTip(tip);
    }
    if (u.transactionStatus) h.onTx(bs58.encode(u.transactionStatus.signature), Number(u.transactionStatus.slot), true);
  };

  const work = (health: StreamHealth) => {
    scheduled = false;
    const until = Date.now() + WORK_SLICE_MS;
    while (head < queue.length && Date.now() < until) handle(queue[head++] as SubscribeUpdate, health);
    if (head > 4_096) {
      queue.splice(0, head);
      head = 0;
    }
    q.depth = queue.length - head;
    if (q.depth) schedule(health);
  };
  const schedule = (health: StreamHealth) => {
    if (scheduled) return;
    scheduled = true;
    setImmediate(() => work(health));
  };
  const enqueue = (u: SubscribeUpdate, health: StreamHealth) => {
    q.depth = queue.length - head;
    if (q.depth >= QUEUE_CAPACITY && (u.transaction || u.transactionStatus)) {
      q.dropped++;
      return;
    }
    queue.push(u);
    q.depth++;
    if (q.depth > q.maxDepth) q.maxDepth = q.depth;
    if (q.depth > QUEUE_CAPACITY / 2 && Date.now() - warnedAt > WARN_EVERY_MS) {
      warnedAt = Date.now();
      console.warn(`[grpc] queue ${q.depth} of ${QUEUE_CAPACITY} (over 50%); ${q.dropped} transaction updates shed so far`);
    }
    schedule(health);
  };

  const health = supervise("grpc", async (health, signal) => {
    const client = new yellowstone.default(config.grpcUrl, requireApiKey(), {
      "grpc.max_receive_message_length": 64 * 1024 * 1024,
      // The 64 KB HTTP/2 default caps a long-haul stream below the tip feed's ~1 MB/s.
      "grpc-node.flow_control_window": 16 * 1024 * 1024,
    });
    const stream = await client.subscribe();
    const resumeFrom = lastSlot && Date.now() - lastSlotAt < REPLAY_WINDOW_MS ? lastSlot - 1 : 0;
    await new Promise<void>((resolve, reject) => {
      signal.addEventListener("abort", () => {
        stream.cancel();
        reject(signal.reason as Error);
      });
      stream.on("data", (u: SubscribeUpdate) => {
        health.lastEventAt = Date.now();
        enqueue(u, health);
      });
      stream.on("error", (e: Error & { code?: number }) => {
        // gRPC 7 PERMISSION_DENIED and 16 UNAUTHENTICATED are refusals; 8
        // RESOURCE_EXHAUSTED is Solami closing a stream that read too slowly
        // (or an empty balance, which is also a refusal).
        const billing = /balance|bandwidth|plan|payment/i.test(e.message);
        const backpressure = e.code === 8 && !billing ? true : /backpressure|slow consumer|lagging|buffer full/i.test(e.message);
        reject(streamError(e.message, { blocked: e.code === 7 || e.code === 16 || (e.code === 8 && billing), backpressure }));
      });
      stream.on("end", resolve);
      // Resume one slot early after a reconnect; tips are deduplicated by
      // signature and replayed slots update their rows in place.
      stream.write(request(tipAccounts, beamTips, resumeFrom), (err: Error | null | undefined) => {
        if (err) reject(err);
        else {
          health.connected = true;
          health.blocked = null;
          if (resumeFrom) console.log(`[grpc] resumed from slot ${resumeFrom}`);
        }
      });
    });
  });
  health.queue = q;
  return health;
}
