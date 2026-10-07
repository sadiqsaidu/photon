import { LAG_MAX_K, LAG_MIN_R } from "./config.js";

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
