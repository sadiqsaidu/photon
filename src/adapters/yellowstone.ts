import { createRequire } from "node:module";
import bs58 from "bs58";
import type { RawStreamProvider, StreamSource } from "../shared/ports.js";
import { toSlot, type Commitment, type StreamEvent, type TaggedStreamEvent } from "../shared/types.js";
import { warn } from "../shared/log.js";
import { JITO_TIP_ACCOUNTS } from "../core/constants.js";

type Pkg = typeof import("@triton-one/yellowstone-grpc");
type SubscribeRequest = import("@triton-one/yellowstone-grpc").SubscribeRequest;
type SubscribeUpdate = import("@triton-one/yellowstone-grpc").SubscribeUpdate;
type Client = InstanceType<Pkg["default"]>;

const grpc = createRequire(import.meta.url)("@triton-one/yellowstone-grpc") as Pkg;
const Client = grpc.default;
const { CommitmentLevel } = grpc;

const QUEUE_CAP = 4096;

function toCommitment(status: number): Commitment | null {
  if (status === CommitmentLevel.PROCESSED) return "processed";
  if (status === CommitmentLevel.CONFIRMED) return "confirmed";
  if (status === CommitmentLevel.FINALIZED) return "finalized";
  return null;
}

// Bounded FIFO shared by every stream stage. Under backpressure it sheds
// items matching `shedFirst` (slot ticks are replaceable; txs are not).
export class EventQueue<T> {
  private items: T[] = [];
  private wake: (() => void) | null = null;
  private closed = false;
  dropped = 0;

  constructor(
    private readonly cap: number,
    private readonly shedFirst: (item: T) => boolean,
  ) {}

  push(e: T): void {
    if (this.closed) return;
    if (this.items.length >= this.cap) {
      const i = this.items.findIndex(this.shedFirst);
      this.items.splice(i >= 0 ? i : 0, 1);
      this.dropped++;
    }
    this.items.push(e);
    this.wake?.();
    this.wake = null;
  }

  close(): void {
    this.closed = true;
    this.wake?.();
    this.wake = null;
  }

  async *drain(): AsyncIterable<T> {
    for (;;) {
      while (this.items.length) yield this.items.shift() as T;
      if (this.closed) return;
      await new Promise<void>((r) => (this.wake = r));
    }
  }
}

function request(accounts: string[]): SubscribeRequest {
  return {
    accounts: {},
    slots: { client: { filterByCommitment: false } },
    transactions: {
      client: {
        vote: false,
        failed: true,
        accountInclude: accounts,
        accountExclude: [],
        accountRequired: [],
      },
    },
    transactionsStatus: {},
    blocks: {},
    blocksMeta: { client: {} },
    entry: {},
    accountsDataSlice: [],
    commitment: CommitmentLevel.PROCESSED,
  };
}

// One Yellowstone gRPC connection with its own reconnect loop. Usable directly
// as a StreamSource, or as one leg of a MultiStream via the tagged raw() feed.
export class Yellowstone implements StreamSource, RawStreamProvider {
  private readonly client: Client;
  private readonly queue = new EventQueue<TaggedStreamEvent>(QUEUE_CAP, (t) => t.event.kind === "slot");
  private readonly tipSet: Set<string>;
  private closed = false;
  private active: { cancel(): void } | null = null;
  reconnects = 0;
  connected = false;

  constructor(
    readonly name: string,
    url: string,
    token: string | undefined,
    private readonly accounts: string[],
    tipAccounts: readonly string[] = JITO_TIP_ACCOUNTS,
  ) {
    this.tipSet = new Set(tipAccounts);
    this.client = new Client(url, token, {
      "grpc.max_receive_message_length": 64 * 1024 * 1024,
    });
    void this.run();
  }

  raw(): AsyncIterable<TaggedStreamEvent> {
    return this.queue.drain();
  }

  async *events(): AsyncIterable<StreamEvent> {
    for await (const t of this.queue.drain()) yield t.event;
  }

  // Half-open gRPC streams stay "connected" and deliver nothing; the watchdog
  // calls this to force the reconnect loop around.
  forceReconnect(): void {
    try {
      this.active?.cancel();
    } catch {
      // already torn down
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.forceReconnect();
    this.queue.close();
  }

  private map(u: SubscribeUpdate): void {
    const recvAt = Date.now();
    if (u.slot) {
      const commitment = toCommitment(u.slot.status);
      if (commitment) {
        this.push(
          {
            kind: "slot",
            slot: toSlot(u.slot.slot),
            parent: u.slot.parent !== undefined ? toSlot(u.slot.parent) : null,
            commitment,
          },
          recvAt,
        );
      }
    }
    const sig = u.transaction?.transaction?.signature;
    if (sig && u.transaction) {
      const signature = bs58.encode(sig);
      const slot = toSlot(u.transaction.slot);
      this.push(
        {
          kind: "tx",
          signature,
          slot,
          err: u.transaction.transaction?.meta?.err ?? null,
        },
        recvAt,
      );
      this.mapTip(u.transaction.transaction, signature, slot, recvAt);
    }
    const height = u.blockMeta?.blockHeight?.blockHeight;
    if (u.blockMeta && height !== undefined) {
      this.push(
        {
          kind: "block",
          slot: toSlot(u.blockMeta.slot),
          blockhash: u.blockMeta.blockhash,
          blockHeight: toSlot(height),
          parentBlockhash: u.blockMeta.parentBlockhash,
        },
        recvAt,
      );
    }
  }

  // If the tx moved lamports into a tip account, emit the amount as a tip
  // observation (post - pre balance at the tip account's key index). Skips
  // silently when the provider payload lacks meta or account keys.
  private mapTip(
    tx: import("@triton-one/yellowstone-grpc").SubscribeUpdateTransactionInfo | undefined,
    signature: string,
    slot: number,
    recvAt: number,
  ): void {
    const meta = tx?.meta;
    const keys = tx?.transaction?.message?.accountKeys;
    if (!meta || !keys || meta.preBalances.length === 0 || meta.postBalances.length === 0) return;
    const n = Math.min(keys.length, meta.preBalances.length, meta.postBalances.length);
    for (let i = 0; i < n; i++) {
      if (!this.tipSet.has(bs58.encode(keys[i] as Uint8Array))) continue;
      const lamports = Number(meta.postBalances[i]) - Number(meta.preBalances[i]);
      if (lamports > 0) {
        this.push({ kind: "tip", slot, lamports, signature }, recvAt);
        return;
      }
    }
  }

  private push(event: StreamEvent, recvAt: number): void {
    this.queue.push({ event, provider: this.name, recvAt });
  }

  private async run(): Promise<void> {
    let backoff = 500;
    while (!this.closed) {
      try {
        const stream = await this.client.subscribe();
        this.active = stream;
        await new Promise<void>((resolve, reject) => {
          stream.on("data", (u: SubscribeUpdate) => this.map(u));
          stream.on("error", reject);
          stream.on("end", resolve);
          stream.write(request(this.accounts), (err: unknown) => {
            if (err) reject(err);
            else this.connected = true;
          });
        });
        backoff = 500;
      } catch (e) {
        if (this.closed) return;
        this.reconnects++;
        this.connected = false;
        warn("stream", "disconnected, reconnecting", { provider: this.name, backoff, error: String(e) });
        if (this.queue.dropped > 0) {
          warn("stream", "shed events under backpressure", { provider: this.name, dropped: this.queue.dropped });
        }
        await new Promise((r) => setTimeout(r, backoff + Math.random() * 250));
        backoff = Math.min(backoff * 2, 15_000);
      } finally {
        this.active = null;
      }
    }
  }
}
