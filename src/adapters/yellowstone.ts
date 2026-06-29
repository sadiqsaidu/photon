import { createRequire } from "node:module";
import bs58 from "bs58";
import type { StreamSource } from "../shared/ports.js";
import type { Commitment, StreamEvent } from "../shared/types.js";
import { warn } from "../shared/log.js";
import { bus } from "../shared/bus.js";

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

class EventQueue {
  private items: StreamEvent[] = [];
  private wake: (() => void) | null = null;
  dropped = 0;

  push(e: StreamEvent): void {
    if (this.items.length >= QUEUE_CAP) {
      const i = this.items.findIndex((x) => x.kind === "slot");
      this.items.splice(i >= 0 ? i : 0, 1);
      this.dropped++;
    }
    this.items.push(e);
    this.wake?.();
    this.wake = null;
  }

  async *drain(): AsyncIterable<StreamEvent> {
    for (;;) {
      while (this.items.length) yield this.items.shift() as StreamEvent;
      await new Promise<void>((r) => (this.wake = r));
    }
  }
}

function request(account: string): SubscribeRequest {
  return {
    accounts: {},
    slots: { client: { filterByCommitment: false } },
    transactions: {
      client: {
        vote: false,
        failed: true,
        accountInclude: [account],
        accountExclude: [],
        accountRequired: [],
      },
    },
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    entry: {},
    accountsDataSlice: [],
    commitment: CommitmentLevel.PROCESSED,
  };
}

export class Yellowstone implements StreamSource {
  private readonly client: Client;
  private readonly queue = new EventQueue();
  private closed = false;
  private reconnects = 0;
  private connected = false;

  constructor(url: string, token: string | undefined, private readonly account: string) {
    this.client = new Client(url, token, {
      "grpc.max_receive_message_length": 64 * 1024 * 1024,
    });
    void this.run();
    // Re-emit health so a dashboard that connects later still sees the live state.
    setInterval(() => this.health(this.connected), 10_000);
  }

  events(): AsyncIterable<StreamEvent> {
    return this.queue.drain();
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private map(u: SubscribeUpdate): void {
    if (u.slot) {
      const commitment = toCommitment(u.slot.status);
      if (commitment) {
        this.queue.push({
          kind: "slot",
          slot: Number(u.slot.slot),
          parent: u.slot.parent !== undefined ? Number(u.slot.parent) : null,
          commitment,
        });
      }
    }
    const sig = u.transaction?.transaction?.signature;
    if (sig && u.transaction) {
      this.queue.push({
        kind: "tx",
        signature: bs58.encode(sig),
        slot: Number(u.transaction.slot),
        err: u.transaction.transaction?.meta?.err ?? null,
      });
    }
  }

  private health(connected: boolean): void {
    this.connected = connected;
    bus.publish({ type: "stream", connected, dropped: this.queue.dropped, reconnects: this.reconnects });
  }

  private async run(): Promise<void> {
    let backoff = 500;
    while (!this.closed) {
      try {
        const stream = await this.client.subscribe();
        await new Promise<void>((resolve, reject) => {
          stream.on("data", (u: SubscribeUpdate) => this.map(u));
          stream.on("error", reject);
          stream.on("end", resolve);
          stream.write(request(this.account), (err: unknown) => {
            if (err) reject(err);
            else this.health(true);
          });
        });
        backoff = 500;
      } catch (e) {
        if (this.closed) return;
        this.reconnects++;
        this.health(false);
        warn("stream", "disconnected, reconnecting", { backoff, error: String(e) });
        if (this.queue.dropped > 0) warn("stream", "shed events under backpressure", { dropped: this.queue.dropped });
        await new Promise((r) => setTimeout(r, backoff + Math.random() * 250));
        backoff = Math.min(backoff * 2, 15_000);
      }
    }
  }
}
