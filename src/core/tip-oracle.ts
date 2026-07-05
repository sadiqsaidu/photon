import type { TipFloor } from "../shared/types.js";
import type { TipStream } from "./tip-stream.js";
import { warn } from "../shared/log.js";

const FLOOR_URL = "https://bundles.jito.wtf/api/v1/bundles/tip_floor";
const SOL = 1_000_000_000;
// The REST floor is only the cold-start / sanity anchor now.
const REST_REFRESH_MS = 60_000;
// Below this many local samples the local window is too thin to trust.
const LOCAL_MIN_SAMPLES = 200;
// Land-rate EWMA over the most recent settlements.
const LAND_RATE_ALPHA = 0.3;
const LAND_RATE_WINDOW = 20;

export interface TipFloorSnapshot extends TipFloor {
  source: "local" | "rest";
}

interface FloorRow {
  landed_tips_25th_percentile: number;
  landed_tips_50th_percentile: number;
  landed_tips_75th_percentile: number;
  landed_tips_95th_percentile: number;
  landed_tips_99th_percentile: number;
  ema_landed_tips_50th_percentile: number;
}

export class TipOracle {
  private cache: TipFloor = { p25: 1000, p50: 1000, p75: 1000, p95: 1000, p99: 1000, ema: 1000 };
  private lastFetch = 0;
  private readonly outcomes: boolean[] = [];

  constructor(private readonly tipStream?: TipStream) {}

  async refresh(): Promise<TipFloorSnapshot> {
    if (Date.now() - this.lastFetch >= REST_REFRESH_MS) {
      this.lastFetch = Date.now();
      try {
        const res = await fetch(FLOOR_URL);
        const rows = (await res.json()) as FloorRow[];
        const r = rows[0];
        if (r) {
          this.cache = {
            p25: Math.round(r.landed_tips_25th_percentile * SOL),
            p50: Math.round(r.landed_tips_50th_percentile * SOL),
            p75: Math.round(r.landed_tips_75th_percentile * SOL),
            p95: Math.round(r.landed_tips_95th_percentile * SOL),
            p99: Math.round(r.landed_tips_99th_percentile * SOL),
            ema: Math.round(r.ema_landed_tips_50th_percentile * SOL),
          };
        }
      } catch (e) {
        warn("oracle", "REST tip floor unavailable, keeping cache", String(e));
      }
    }
    return this.floor();
  }

  floor(): TipFloorSnapshot {
    if (this.tipStream && this.tipStream.sampleCount() >= LOCAL_MIN_SAMPLES) {
      return { ...this.tipStream.percentiles(), source: "local" };
    }
    return { ...this.cache, source: "rest" };
  }

  observe(landed: boolean): void {
    this.outcomes.push(landed);
    if (this.outcomes.length > LAND_RATE_WINDOW) this.outcomes.shift();
  }

  // EWMA (alpha 0.3) over the last 20 settlements — recent form, not lifetime.
  landRate(): number {
    if (this.outcomes.length === 0) return 1;
    let rate = this.outcomes[0] ? 1 : 0;
    for (let i = 1; i < this.outcomes.length; i++) {
      rate = LAND_RATE_ALPHA * (this.outcomes[i] ? 1 : 0) + (1 - LAND_RATE_ALPHA) * rate;
    }
    return rate;
  }
}
