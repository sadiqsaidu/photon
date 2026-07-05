import type { Lamports } from "../shared/types.js";

// Holt double exponential smoothing over the per-slot p50 series.
const LEVEL_ALPHA = 0.3;
const TREND_ALPHA = 0.1;
const VOL_WINDOW = 32;
// Forecasts are clamped to [0.25x, 4x] of the current p50.
const CLAMP_LO = 0.25;
const CLAMP_HI = 4;

export interface TipForecast {
  p50: Lamports;
  trendPctPer10Slots: number;
  volatility: number;
}

// Pure local forecaster — no LLM, no HTTP. Fed one p50 per completed slot.
export class TipForecaster {
  private level: number | null = null;
  private trend = 0;
  private readonly recent: number[] = [];

  observe(p50: number): void {
    if (this.level === null) {
      this.level = p50;
      this.trend = 0;
    } else {
      const prev = this.level;
      this.level = LEVEL_ALPHA * p50 + (1 - LEVEL_ALPHA) * (prev + this.trend);
      this.trend = TREND_ALPHA * (this.level - prev) + (1 - TREND_ALPHA) * this.trend;
    }
    this.recent.push(p50);
    if (this.recent.length > VOL_WINDOW) this.recent.shift();
  }

  forecast(slotsAhead: number): TipForecast {
    if (this.level === null) return { p50: 0, trendPctPer10Slots: 0, volatility: 0 };
    const current = this.recent[this.recent.length - 1] ?? this.level;
    const raw = this.level + this.trend * slotsAhead;
    const p50 = Math.round(Math.max(CLAMP_LO * current, Math.min(raw, CLAMP_HI * current)));
    const trendPctPer10Slots = this.level > 0 ? ((this.trend * 10) / this.level) * 100 : 0;
    return { p50, trendPctPer10Slots, volatility: this.volatility() };
  }

  // Coefficient of variation of the recent per-slot p50s.
  private volatility(): number {
    if (this.recent.length < 2) return 0;
    const mean = this.recent.reduce((a, b) => a + b, 0) / this.recent.length;
    if (mean === 0) return 0;
    const variance = this.recent.reduce((a, b) => a + (b - mean) ** 2, 0) / this.recent.length;
    return Math.sqrt(variance) / mean;
  }
}
