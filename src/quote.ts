import {
  BEAM_MIN_TIP,
  BUCKETS,
  config,
  FARE_FORECAST_SLOTS,
  FARES,
  LAMPORTS_PER_SOL,
  MIN_BUCKET_PROBES,
  PRIORITY_FEE_TTL_MS,
  SLOT_MS,
} from "./config.js";
import { rpc } from "./solami.js";
import { isotonic, percentile, rankOf } from "./stats.js";
import { distribution, floorPercentile, forecastAt, heatMultiplier } from "./tips.js";

// Calibration scores every probe against this deadline.
export const CALIBRATION_DEADLINE = 2;
// The top bucket is priced at p99, not the window maximum (one outlier).
const TOP_PERCENTILE = 99;

export interface ProbeOutcome {
  bucket: number;
  slotsToLand: number | null;
  sentSlot?: number;
}

// Where a bucket's estimate comes from: its own probes, the measured bucket
// below it (too few probes of its own), or the starting prior (nothing measured).
export type Basis = "measured" | "inherited" | "prior";

const ALL_REACHABLE = BUCKETS.map(() => true);

export function bucketOf(pct: number): number {
  const i = BUCKETS.findIndex((b) => pct >= b.lo && pct < b.hi);
  return i === -1 ? BUCKETS.length - 1 : i;
}

// The tip whose mid-rank sits inside bucket `index`, closest to its middle,
// at or below the tip ceiling. Ties (many tips are exactly 100,000) can push a
// bucket's midpoint value into a neighbour, so values just above each
// candidate are tried too. Null means the bucket is above the tip ceiling.
export function tipForBucket(sorted: number[], index: number): { tip: number; pct: number } | null {
  const b = BUCKETS[index] as (typeof BUCKETS)[number];
  const mid = (b.lo + b.hi) / 2;
  let best: { tip: number; pct: number } | null = null;
  for (let p = b.lo; p < b.hi; p += 0.5) {
    const v = percentile(sorted, p);
    for (const candidate of [v, v + 1]) {
      const tip = Math.min(config.tipCeilingLamports, Math.max(BEAM_MIN_TIP, candidate));
      const pct = rankOf(sorted, tip);
      if (bucketOf(pct) !== index) continue;
      if (!best || Math.abs(pct - mid) < Math.abs(best.pct - mid)) best = { tip, pct };
    }
  }
  return best;
}

// Buckets a tip at or below the ceiling can reach. Before the distribution
// has samples every bucket counts as reachable.
export function reachableBuckets(sorted: number[]): boolean[] {
  return sorted.length ? BUCKETS.map((_, i) => tipForBucket(sorted, i) !== null) : ALL_REACHABLE;
}

// Per bucket: Laplace-smoothed rate (landed + 1) / (n + 2) from buckets with at
// least MIN_BUCKET_PROBES probes, made non-decreasing by a weighted isotonic fit
// (a bigger tip is assumed not to lower the chance; contradictions are pooled,
// not copied upward). Thinner buckets inherit from the measured bucket below,
// or keep their prior when no measured bucket sits below them.
export function landingModel(outcomes: ProbeOutcome[], deadline: number, reachable = ALL_REACHABLE) {
  const raw = BUCKETS.map((b, i) => {
    const mine = outcomes.filter((o) => o.bucket === i);
    const landed = mine.filter((o) => o.slotsToLand !== null && o.slotsToLand <= deadline).length;
    const slots = mine.map((o) => o.sentSlot).filter((x): x is number => typeof x === "number");
    return { ...b, n: mine.length, landed, newestSlot: slots.length ? Math.max(...slots) : null, reachable: reachable[i] as boolean };
  });
  const measured = raw.map((b) => b.n >= MIN_BUCKET_PROBES);
  const fitted = isotonic(
    raw.filter((_, i) => measured[i]).map((b) => (b.landed + 1) / (b.n + 2)),
    raw.filter((_, i) => measured[i]).map((b) => b.n + 2),
  );
  let k = 0;
  const own = raw.map((_, i) => (measured[i] ? (fitted[k++] as number) : null));
  const buckets = raw.map((b, i) => {
    if (own[i] !== null) return { ...b, p: own[i] as number, basis: "measured" as Basis };
    const below = own.slice(0, i).filter((v): v is number => v !== null).at(-1);
    if (below !== undefined) return { ...b, p: below, basis: "inherited" as Basis };
    const above = own.slice(i + 1).find((v): v is number => v !== null);
    return { ...b, p: above === undefined ? b.prior : Math.min(b.prior, above), basis: "prior" as Basis };
  });
  // Calibrated means every bucket a quote can price has enough probes.
  return { buckets, calibrated: buckets.every((b) => !b.reachable || b.n >= MIN_BUCKET_PROBES) };
}

export function probabilities(outcomes: ProbeOutcome[], deadline: number, reachable = ALL_REACHABLE): { p: number[]; calibrated: boolean } {
  const model = landingModel(outcomes, deadline, reachable);
  return { p: model.buckets.map((b) => b.p), calibrated: model.calibrated };
}

export function pickBucket(p: number[], confidence: number, reachable = ALL_REACHABLE): { index: number; meetsConfidence: boolean } {
  const open = p.map((v, i) => ({ v, i })).filter((b) => reachable[b.i]);
  const hit = open.find((b) => b.v >= confidence);
  if (hit) return { index: hit.i, meetsConfidence: true };
  // Best effort: the cheapest bucket with the highest probability, so a
  // pricier bucket is never quoted for the same promise.
  const best = Math.max(...open.map((b) => b.v));
  return { index: open.find((b) => b.v >= best - 1e-9)?.i ?? p.length - 1, meetsConfidence: false };
}

// The bucket's upper edge, forecast `horizon` slots ahead, floored at the Beam
// minimum; the caller applies the tip ceiling.
function rawPrice(index: number, horizon: number): number {
  const b = BUCKETS[index] as (typeof BUCKETS)[number];
  const pct = b.hi >= 100 ? TOP_PERCENTILE : b.hi;
  return Math.max(BEAM_MIN_TIP, forecastAt(pct, horizon));
}

let feeCache: { at: number; value: number } | null = null;
export const priorityFeeAge = () => (feeCache ? Date.now() - feeCache.at : null);
export async function priorityFee(): Promise<number> {
  if (feeCache && Date.now() - feeCache.at < PRIORITY_FEE_TTL_MS) return feeCache.value;
  const fees = await rpc<{ prioritizationFee: number }[]>("getRecentPrioritizationFees");
  const value = percentile(fees.map((f) => f.prioritizationFee).sort((a, b) => a - b), 75);
  feeCache = { at: Date.now(), value };
  return value;
}

export function brier(rows: { predicted: number; landed: boolean }[]): number | null {
  if (rows.length === 0) return null;
  return rows.reduce((a, r) => a + (r.predicted - (r.landed ? 1 : 0)) ** 2, 0) / rows.length;
}

export function calibration(probes: { bucket: number; predicted: number; slotsToLand: number | null }[], reachable = ALL_REACHABLE) {
  const landed = (p: { slotsToLand: number | null }) => p.slotsToLand !== null && p.slotsToLand <= CALIBRATION_DEADLINE;
  const model = landingModel(probes, CALIBRATION_DEADLINE, reachable);
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return {
    deadlineSlots: CALIBRATION_DEADLINE,
    probes: probes.length,
    calibrated: model.calibrated,
    brier: brier(probes.map((p) => ({ predicted: p.predicted, landed: landed(p) }))),
    buckets: model.buckets.map((b, i) => {
      const mine = probes.filter((p) => p.bucket === i);
      return {
        lo: b.lo,
        hi: b.hi,
        n: mine.length,
        predicted: mean(mine.map((p) => p.predicted)),
        actual: mine.length ? mine.filter(landed).length / mine.length : null,
        model: Math.round(b.p * 1000) / 1000,
        status: b.reachable ? "reachable" : "above tip ceiling",
      };
    }),
  };
}

// Out of sample: each probe is scored against what the model would have said
// at `deadline` from the probes sent before it (priors until calibrated).
export function trackRecord(probes: (ProbeOutcome & { sentSlot: number })[], deadline: number, reachable = ALL_REACHABLE) {
  const ordered = [...probes].sort((a, b) => a.sentSlot - b.sentSlot);
  const scored = ordered.map((o, i) => ({
    bucket: o.bucket,
    promised: probabilities(ordered.slice(0, i), deadline, reachable).p[o.bucket] as number,
    onTime: o.slotsToLand !== null && o.slotsToLand <= deadline,
  }));
  const rows = BUCKETS.map((b, i) => {
    const mine = scored.filter((s) => s.bucket === i);
    const n = mine.length;
    return {
      lo: b.lo,
      hi: b.hi,
      n,
      promised: n ? Math.round((mine.reduce((a, s) => a + s.promised, 0) / n) * 1000) / 1000 : null,
      delivered: n ? Math.round((mine.filter((s) => s.onTime).length / n) * 1000) / 1000 : null,
      reachable: reachable[i] as boolean,
    };
  });
  const used = rows.filter((r) => r.n > 0);
  const total = used.reduce((a, r) => a + r.n, 0);
  const gap = total ? used.reduce((a, r) => a + r.n * Math.abs((r.promised as number) - (r.delivered as number)), 0) / total : null;
  return { deadlineSlots: deadline, trips: total, averageGapPoints: gap === null ? null : Math.round(gap * 1000) / 10, rows };
}

// Calibration progress in test trips: probes counted toward full buckets.
export function progress(outcomes: ProbeOutcome[], reachable = ALL_REACHABLE): { done: number; needed: number } {
  let done = 0, needed = 0;
  BUCKETS.forEach((_, i) => {
    if (!reachable[i]) return;
    needed += MIN_BUCKET_PROBES;
    done += Math.min(MIN_BUCKET_PROBES, outcomes.filter((o) => o.bucket === i).length);
  });
  return { done, needed };
}

// Every fare is quoted on its own with the same forecast horizon, so prices
// only differ by bucket. A slower deadline never lowers a bucket's estimate
// (landing within 10 slots includes landing within 4), so a slower fare that
// meets its target never needs a pricier bucket than a faster fare that meets
// its own. A faster fare that misses its target can still be cheaper: it is a
// best effort at a different target, and its estimate says so.
export async function fares(outcomes: ProbeOutcome[], solPriceUsd: number | null) {
  const quotes = await Promise.all(FARES.map((f) => quote(f.deadlineSlots, f.confidence, outcomes, FARE_FORECAST_SLOTS)));
  const dist = distribution();
  return {
    fares: FARES.map((fare, i) => {
      const q = quotes[i] as Awaited<ReturnType<typeof quote>>;
      return {
        id: fare.id,
        label: fare.label,
        deadlineSlots: fare.deadlineSlots,
        deadlineMs: fare.deadlineSlots * SLOT_MS,
        confidence: fare.confidence,
        tipLamports: q.tipLamports,
        tipSol: q.tipSol,
        tipUsd: solPriceUsd === null ? null : Math.round((q.tipLamports / LAMPORTS_PER_SOL) * solPriceUsd * 10_000) / 10_000,
        priorityFeeMicroLamports: q.priorityFeeMicroLamports,
        probability: q.probability,
        meetsConfidence: q.meetsConfidence,
        bucket: q.bucket,
        estimate: q.estimate,
        ceilingLimited: q.ceilingLimited,
      };
    }),
    calibrated: quotes[0]?.calibrated ?? false,
    progress: progress(outcomes, reachableBuckets(dist.sorted)),
    samples: dist.sorted.length,
    solPriceUsd,
    forecastHorizonSlots: FARE_FORECAST_SLOTS,
    tipCeilingLamports: config.tipCeilingLamports,
    slotMs: SLOT_MS,
  };
}

export async function quote(deadline: number, confidence: number, outcomes: ProbeOutcome[], horizon = deadline) {
  const dist = distribution();
  const reachable = reachableBuckets(dist.sorted);
  const model = landingModel(outcomes, deadline, reachable);
  const p = model.buckets.map((b) => b.p);
  const picked = pickBucket(p, confidence, reachable);
  const raw = rawPrice(picked.index, horizon);
  const tipLamports = Math.min(config.tipCeilingLamports, raw);
  // A tip clamped down by the ceiling can sit in a cheaper bucket than the one
  // picked; the estimate must describe the tip actually quoted.
  const index = raw > config.tipCeilingLamports && dist.sorted.length ? Math.min(picked.index, bucketOf(rankOf(dist.sorted, tipLamports))) : picked.index;
  const chosen = model.buckets[index] as (typeof model.buckets)[number];
  const probability = Math.round(chosen.p * 1000) / 1000;
  const meetsConfidence = chosen.p >= confidence;
  return {
    deadlineSlots: deadline,
    confidence,
    tipLamports,
    tipSol: tipLamports / LAMPORTS_PER_SOL,
    priorityFeeMicroLamports: await priorityFee(),
    probability,
    meetsConfidence,
    calibrated: model.calibrated,
    bucket: { lo: chosen.lo, hi: chosen.hi },
    estimate: { basis: chosen.basis, samples: chosen.n, landed: chosen.landed, newestSlot: chosen.newestSlot },
    // A better estimate may exist above the tip ceiling, where Tipwise never quotes or probes.
    ceilingLimited: !meetsConfidence && (raw > config.tipCeilingLamports || reachable.slice(index + 1).some((r) => !r)),
    buckets: model.buckets.map((b) => ({ lo: b.lo, hi: b.hi, p: Math.round(b.p * 1000) / 1000, n: b.n, basis: b.basis, status: b.reachable ? "reachable" : "above tip ceiling" })),
    tipCeilingLamports: config.tipCeilingLamports,
    forecastHorizonSlots: horizon,
    distribution: { source: dist.source, samples: dist.sorted.length, beamFloorPercentile: floorPercentile() },
    heatMultiplier: heatMultiplier(),
  };
}
