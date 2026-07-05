import type { RawStreamProvider, StreamSource } from "../shared/ports.js";
import type { StreamEvent } from "../shared/types.js";
import { EventQueue } from "./yellowstone.js";
import { bus } from "../shared/bus.js";
import { warn } from "../shared/log.js";

export interface ProviderConfig {
  name: string;
  url: string;
  token?: string;
}

const QUEUE_CAP = 8192;
const SLOT_LRU = 2048;
const TX_LRU = 8192;
const DELTA_SAMPLES = 512;
const WATCHDOG_MS = 2000;
const STALE_MS = 5000;
const TELEMETRY_MS = 5000;

interface Seen {
  firstAt: number;
  winner: string;
}

// Fixed-size key ring + map: O(1) get/set, oldest key evicted when full.
// Never unbounded — this process runs for hours.
class LruMap<V> {
  private readonly map = new Map<string, V>();
  private readonly ring: (string | undefined)[];
  private head = 0;

  constructor(cap: number) {
    this.ring = new Array<string | undefined>(cap);
  }

  get(key: string): V | undefined {
    return this.map.get(key);
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) {
      this.map.set(key, value);
      return;
    }
    const evict = this.ring[this.head];
    if (evict !== undefined) this.map.delete(evict);
    this.ring[this.head] = key;
    this.head = (this.head + 1) % this.ring.length;
    this.map.set(key, value);
  }
}

class Ring {
  private readonly buf: number[] = [];
  private next = 0;

  constructor(private readonly cap: number) {}

  push(v: number): void {
    if (this.buf.length < this.cap) this.buf.push(v);
    else this.buf[this.next] = v;
    this.next = (this.next + 1) % this.cap;
  }

  percentile(p: number): number {
    if (this.buf.length === 0) return 0;
    const sorted = [...this.buf].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] as number;
  }
}

interface Stats {
  wins: number;
  losses: number;
  lastEventAt: number;
  lastKickAt: number;
  deltas: Ring;
}

// Races N gRPC providers: first provider to deliver an event wins it; the
// duplicate from the slower provider is counted and dropped. A provider being
// down (or half-open) never affects the others.
export class MultiStream implements StreamSource {
  private readonly queue = new EventQueue<StreamEvent>(QUEUE_CAP, (e) => e.kind === "slot");
  private readonly slots = new LruMap<Seen>(SLOT_LRU);
  private readonly txs = new LruMap<Seen>(TX_LRU);
  private readonly stats = new Map<string, Stats>();
  private readonly timers: NodeJS.Timeout[] = [];
  private lastPublishedDropped = 0;
  private closed = false;

  constructor(private readonly providers: RawStreamProvider[]) {
    const now = Date.now();
    for (const p of providers) {
      this.stats.set(p.name, { wins: 0, losses: 0, lastEventAt: now, lastKickAt: 0, deltas: new Ring(DELTA_SAMPLES) });
      void this.consume(p);
    }
    this.timers.push(setInterval(() => this.watchdog(), WATCHDOG_MS));
    this.timers.push(setInterval(() => this.publish(), TELEMETRY_MS));
  }

  events(): AsyncIterable<StreamEvent> {
    return this.queue.drain();
  }

  get dropped(): number {
    return this.queue.dropped;
  }

  raceSnapshot(): Record<string, { wins: number; losses: number }> {
    const out: Record<string, { wins: number; losses: number }> = {};
    for (const [name, s] of this.stats) out[name] = { wins: s.wins, losses: s.losses };
    return out;
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const t of this.timers) clearInterval(t);
    await Promise.all(this.providers.map((p) => p.close()));
    this.queue.close();
  }

  private dedup(e: StreamEvent): { lru: LruMap<Seen>; key: string } {
    if (e.kind === "slot") return { lru: this.slots, key: `s:${e.slot}:${e.commitment}` };
    if (e.kind === "block") return { lru: this.slots, key: `b:${e.slot}` };
    if (e.kind === "tip") return { lru: this.txs, key: `p:${e.signature}` };
    return { lru: this.txs, key: `t:${e.signature}` };
  }

  private async consume(p: RawStreamProvider): Promise<void> {
    const st = this.stats.get(p.name) as Stats;
    for await (const t of p.raw()) {
      st.lastEventAt = t.recvAt;
      const { lru, key } = this.dedup(t.event);
      const seen = lru.get(key);
      if (seen) {
        st.losses++;
        this.stats.get(seen.winner)?.deltas.push(t.recvAt - seen.firstAt);
        continue;
      }
      lru.set(key, { firstAt: t.recvAt, winner: p.name });
      st.wins++;
      this.queue.push(t.event);
    }
  }

  // A stream can stay "connected" and deliver nothing (half-open gRPC is the
  // #1 silent failure). If one provider is flowing and another has been silent
  // for 5 s, force-destroy the silent one to trigger its reconnect loop.
  private watchdog(): void {
    if (this.closed || this.providers.length < 2) return;
    const now = Date.now();
    const flowing = this.providers.some((p) => {
      const s = this.stats.get(p.name);
      return s !== undefined && now - s.lastEventAt < STALE_MS;
    });
    if (!flowing) return;
    for (const p of this.providers) {
      const s = this.stats.get(p.name) as Stats;
      if (now - s.lastEventAt >= STALE_MS && now - s.lastKickAt >= STALE_MS) {
        s.lastKickAt = now;
        warn("stream", "provider stale, forcing reconnect", { provider: p.name, silentMs: now - s.lastEventAt });
        p.forceReconnect();
      }
    }
  }

  private publish(): void {
    if (this.closed) return;
    const now = Date.now();
    const providers = this.providers.map((p) => {
      const s = this.stats.get(p.name) as Stats;
      return {
        name: p.name,
        wins: s.wins,
        losses: s.losses,
        p50DeltaMs: s.deltas.percentile(50),
        p99DeltaMs: s.deltas.percentile(99),
        reconnects: p.reconnects,
        connected: p.connected,
        lastEventAgoMs: now - s.lastEventAt,
      };
    });
    const dropped = this.queue.dropped;
    bus.publish({ type: "stream_race", providers, dropped, droppedDelta: dropped - this.lastPublishedDropped });
    this.lastPublishedDropped = dropped;
    // Legacy aggregate event so the existing dashboard keeps working.
    bus.publish({
      type: "stream",
      connected: this.providers.some((p) => p.connected),
      dropped,
      reconnects: this.providers.reduce((n, p) => n + p.reconnects, 0),
    });
  }
}
