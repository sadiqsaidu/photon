import type { Lamports, Slot, TipFloor } from "../shared/types.js";

// ~2 minutes of chain time.
const WINDOW_SLOTS = 300;
const MAX_SAMPLES = 20_000;
const EMA_ALPHA = 0.2;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] as number;
}

// Live local tip observations from the stream (we already watch all 8 tip
// accounts). Rolling window of the last 300 slots, bounded to 20k samples.
export class TipStream {
  private readonly buckets = new Map<Slot, number[]>();
  private total = 0;
  private maxSlot: Slot = 0;
  private ema = 0;
  // Fired once per completed slot with that slot's p50 (feeds the forecaster).
  onSlotP50?: (slot: Slot, p50: number) => void;

  observe(slot: Slot, lamports: Lamports): void {
    if (slot > this.maxSlot) {
      if (this.maxSlot > 0) this.completeSlot(this.maxSlot);
      this.maxSlot = slot;
    }
    let bucket = this.buckets.get(slot);
    if (!bucket) {
      bucket = [];
      this.buckets.set(slot, bucket);
    }
    bucket.push(lamports);
    this.total++;
    this.evict();
  }

  sampleCount(): number {
    return this.total;
  }

  percentiles(): TipFloor {
    const all: number[] = [];
    for (const b of this.buckets.values()) all.push(...b);
    all.sort((a, b) => a - b);
    return {
      p25: percentile(all, 25),
      p50: percentile(all, 50),
      p75: percentile(all, 75),
      p95: percentile(all, 95),
      p99: percentile(all, 99),
      ema: this.ema > 0 ? Math.round(this.ema) : percentile(all, 50),
    };
  }

  private completeSlot(slot: Slot): void {
    const bucket = this.buckets.get(slot);
    if (!bucket || bucket.length === 0) return;
    const sorted = [...bucket].sort((a, b) => a - b);
    const p50 = percentile(sorted, 50);
    this.ema = this.ema === 0 ? p50 : EMA_ALPHA * p50 + (1 - EMA_ALPHA) * this.ema;
    this.onSlotP50?.(slot, p50);
  }

  private evict(): void {
    // Insertion order tracks slot order closely enough to evict oldest-first.
    for (const [slot, bucket] of this.buckets) {
      const tooOld = slot < this.maxSlot - WINDOW_SLOTS;
      if (!tooOld && this.total <= MAX_SAMPLES) break;
      this.buckets.delete(slot);
      this.total -= bucket.length;
    }
  }
}
