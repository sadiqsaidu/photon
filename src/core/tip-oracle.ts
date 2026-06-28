import type { TipFloor } from "../shared/types.js";

const FLOOR_URL = "https://bundles.jito.wtf/api/v1/bundles/tip_floor";
const SOL = 1_000_000_000;

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
  private landed = 0;
  private total = 0;

  async refresh(): Promise<TipFloor> {
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
    return this.cache;
  }

  floor(): TipFloor {
    return this.cache;
  }

  observe(landed: boolean): void {
    this.total++;
    if (landed) this.landed++;
  }

  landRate(): number {
    return this.total === 0 ? 1 : this.landed / this.total;
  }
}
