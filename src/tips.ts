import {
  BEAM_MIN_SAMPLES,
  BEAM_MIN_TIP,
  bus,
  HEAT_MULT_MAX,
  HEAT_MULT_MIN,
  LAG_MAX_K,
  LAG_MIN_R,
  LAG_WINDOW_SLOTS,
  TIP_WINDOW_SLOTS,
} from "./config.js";
import type { Tip, TipSource } from "./grpc.js";

export interface SlotStats {
  slot: number;
  leader: string | null;
  count: number;
  beamCount: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  max: number;
  heat: number;
}

export interface Lag {
  k: number;
  r: number;
  n: number;
  qualifies: boolean;
  beta: number;
  computedAt: number;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i] as number;
}

const firstIndex = (sorted: number[], value: number, inclusive: boolean) => {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const v = sorted[mid] as number;
    if (v < value || (inclusive && v === value)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

// Mid-rank percentile: ties share the middle of their run, so a common exact
// amount (100,000 lamports is one) does not collapse to the bottom.
export function rankOf(sorted: number[], value: number): number {
  if (sorted.length === 0) return 50;
  const below = firstIndex(sorted, value, false);
  const atOrBelow = firstIndex(sorted, value, true);
  return ((below + atOrBelow) / 2 / sorted.length) * 100;
}

export function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] as number) - mx, dy = (ys[i] as number) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
}

// Correlates heat at slot t with tip p75 at slot t+k for every k, and fits
// beta: the relative p75 move per standard deviation of heat at the best k.
export function computeLag(rows: { slot: number; p75: number; heat: number }[], now = Date.now()): Lag {
  const bySlot = new Map(rows.map((r) => [r.slot, r]));
  let best = { k: 0, r: 0, n: 0, xs: [] as number[], ys: [] as number[] };
  for (let k = 0; k <= LAG_MAX_K; k++) {
    const xs: number[] = [], ys: number[] = [];
    for (const r of rows) {
      const later = bySlot.get(r.slot + k);
      if (later && later.p75 > 0) {
        xs.push(r.heat);
        ys.push(later.p75);
      }
    }
    const r = pearson(xs, ys);
    if (r > best.r || best.n === 0) best = { k, r, n: xs.length, xs, ys };
  }
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  const mx = mean(best.xs), my = mean(best.ys);
  const sd = Math.sqrt(mean(best.xs.map((x) => (x - mx) ** 2)));
  let sxy = 0, sxx = 0;
  best.xs.forEach((x, i) => {
    const z = sd > 0 ? (x - mx) / sd : 0;
    sxy += z * ((best.ys[i] as number) / (my || 1) - 1);
    sxx += z * z;
  });
  const r = Math.round(best.r * 1000) / 1000;
  return { k: best.k, r, n: best.n, qualifies: r >= LAG_MIN_R && best.k >= 1, beta: sxx > 0 ? sxy / sxx : 0, computedAt: now };
}

// Holt double exponential smoothing; forecast(h) is the level h steps ahead.
export function holt(alpha = 0.3, beta = 0.1) {
  let level: number | null = null;
  let trend = 0;
  return {
    observe(v: number) {
      if (level === null) {
        level = v;
        return;
      }
      const prev = level;
      level = alpha * v + (1 - alpha) * (prev + trend);
      trend = beta * (level - prev) + (1 - beta) * trend;
    },
    // Growth factor h steps ahead, clamped to [0.25, 4].
    growth(h: number): number {
      if (level === null || level <= 0) return 1;
      return Math.min(4, Math.max(0.25, (level + trend * h) / level));
    },
    level: () => level,
  };
}

const pending = new Map<number, Map<string, Tip>>();
const heat = new Map<number, number>();
const samples = new Map<number, { lamports: number; source: TipSource }[]>();
const recent: SlotStats[] = [];
const f50 = holt();
const f90 = holt();
let lag: Lag = { k: 0, r: 0, n: 0, qualifies: false, beta: 0, computedAt: 0 };
let lastConfirmed = 0;
let sorted: { all: number[]; beam: number[]; eligible: number[] } = { all: [], beam: [], eligible: [] };
let leaderOf: (slot: number) => string | null = () => null;

export function useLeaders(fn: (slot: number) => string | null): void {
  leaderOf = fn;
}

export function addTip(tip: Tip): void {
  if (tip.slot <= lastConfirmed - TIP_WINDOW_SLOTS) return;
  let slot = pending.get(tip.slot);
  if (!slot) pending.set(tip.slot, (slot = new Map()));
  slot.set(tip.signature, tip);
}

export function addHeat(slot: number, weight: number): void {
  if (lastConfirmed && slot <= lastConfirmed - LAG_WINDOW_SLOTS) return;
  heat.set(slot, (heat.get(slot) ?? 0) + weight);
}

export function heatAt(slot: number): number {
  return heat.get(slot) ?? 0;
}

function prune(): void {
  for (const s of pending.keys()) if (s < lastConfirmed - 150) pending.delete(s);
  for (const s of samples.keys()) if (s <= lastConfirmed - TIP_WINDOW_SLOTS) samples.delete(s);
  for (const s of heat.keys()) if (s <= lastConfirmed - LAG_WINDOW_SLOTS - LAG_MAX_K) heat.delete(s);
  while (recent.length && (recent[0] as SlotStats).slot <= lastConfirmed - LAG_WINDOW_SLOTS) recent.shift();
}

export function onConfirmed(slot: number): SlotStats | null {
  const tips = [...(pending.get(slot)?.values() ?? [])];
  pending.delete(slot);
  if (slot > lastConfirmed) lastConfirmed = slot;
  const values = tips.map((t) => t.lamports).sort((a, b) => a - b);
  const stats: SlotStats = {
    slot,
    leader: leaderOf(slot),
    count: values.length,
    beamCount: tips.filter((t) => t.source === "beam").length,
    p25: percentile(values, 25),
    p50: percentile(values, 50),
    p75: percentile(values, 75),
    p90: percentile(values, 90),
    max: values.at(-1) ?? 0,
    heat: heatAt(slot),
  };
  samples.set(slot, tips.map((t) => ({ lamports: t.lamports, source: t.source })));
  recent.push(stats);
  if (stats.count > 0) {
    f50.observe(stats.p50);
    f90.observe(stats.p90);
  }
  prune();
  const all: number[] = [], beam: number[] = [];
  for (const list of samples.values()) for (const t of list) (t.source === "beam" ? beam : all).push(t.lamports);
  const combined = all.concat(beam).sort((a, b) => a - b);
  sorted = { all: combined, beam: beam.sort((a, b) => a - b), eligible: combined.filter((v) => v >= BEAM_MIN_TIP) };
  bus.emit("tips", stats);
  return stats;
}

// A confirmed slot's row with the heat known now: Blur events can arrive
// after gRPC has confirmed the slot.
export function confirmedRow(slot: number): SlotStats | null {
  const row = recent.find((r) => r.slot === slot);
  return row ? { ...row, heat: heatAt(slot) } : null;
}

export function refreshLag(): Lag {
  lag = computeLag(recent.filter((r) => r.count > 0).map((r) => ({ slot: r.slot, p75: r.p75, heat: heatAt(r.slot) })));
  bus.emit("lag", lag);
  return lag;
}

// Quotes price inside the tips a Beam send could actually pay: landed tips at
// or above the Beam floor, from Beam itself once it has enough samples.
export function distribution(): { source: "beam" | "combined"; sorted: number[] } {
  return sorted.beam.length >= BEAM_MIN_SAMPLES ? { source: "beam", sorted: sorted.beam } : { source: "combined", sorted: sorted.eligible };
}

// Where the Beam floor sits among all landed tips (percentile, 0 to 100).
export function floorPercentile(): number {
  return Math.round(rankOf(sorted.all, BEAM_MIN_TIP) * 10) / 10;
}

export function heatMultiplier(): number {
  if (!lag.qualifies) return 1;
  const hs = recent.map((r) => heatAt(r.slot));
  const mean = hs.reduce((a, b) => a + b, 0) / (hs.length || 1);
  const sd = Math.sqrt(hs.reduce((a, b) => a + (b - mean) ** 2, 0) / (hs.length || 1));
  // Two slots behind the confirmed tip, so late Blur events are already counted.
  const z = sd > 0 ? (heatAt(lastConfirmed - 2) - mean) / sd : 0;
  return Math.min(HEAT_MULT_MAX, Math.max(HEAT_MULT_MIN, 1 + lag.beta * z));
}

// Tip at percentile `pct` of the live distribution, projected h slots ahead by
// the Holt trend of per-slot p50 (below p50) blending into p90 (above p90).
export function forecastAt(pct: number, h: number): number {
  const base = percentile(distribution().sorted, pct);
  const w = Math.min(1, Math.max(0, (pct - 50) / 40));
  const growth = (1 - w) * f50.growth(h) + w * f90.growth(h);
  return Math.round(base * growth * heatMultiplier());
}

export function tipState() {
  const d = distribution();
  return {
    lastConfirmed,
    window: recent.slice(-150),
    lag,
    heatMultiplier: heatMultiplier(),
    source: d.source,
    samples: d.sorted.length,
    allSamples: sorted.all.length,
    beamSamples: sorted.beam.length,
    floorPercentile: floorPercentile(),
    forecast: Array.from({ length: 10 }, (_, i) => ({ h: i + 1, p50: forecastAt(50, i + 1), p90: forecastAt(90, i + 1) })),
  };
}
