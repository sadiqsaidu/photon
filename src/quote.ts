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
import { percentile, rankOf } from "./stats.js";
import { distribution, floorPercentile, forecastAt, heatMultiplier } from "./tips.js";

// Calibration scores every probe against this deadline.
export const CALIBRATION_DEADLINE = 2;
// The top bucket is priced at p99, not the window maximum (one outlier).
const TOP_PERCENTILE = 99;

export interface ProbeOutcome {
  bucket: number;
  slotsToLand: number | null;
}

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

export function landingModel(outcomes: ProbeOutcome[], deadline: number, reachable = ALL_REACHABLE) {
  const buckets = BUCKETS.map((b, i) => {
    const mine = outcomes.filter((o) => o.bucket === i);
    const landed = mine.filter((o) => o.slotsToLand !== null && o.slotsToLand <= deadline).length;
    return { ...b, n: mine.length, landed, p: (landed + 1) / (mine.length + 2), reachable: reachable[i] as boolean };
  });
  let floor = 0;
  for (const b of buckets) floor = b.p = Math.max(floor, b.p);
  // Calibrated means every bucket a quote can price has enough probes.
  return { buckets, calibrated: buckets.every((b) => !b.reachable || b.n >= MIN_BUCKET_PROBES) };
}

export function probabilities(outcomes: ProbeOutcome[], deadline: number, reachable = ALL_REACHABLE): { p: number[]; calibrated: boolean } {
  const model = landingModel(outcomes, deadline, reachable);
  return model.calibrated ? { p: model.buckets.map((b) => b.p), calibrated: true } : { p: BUCKETS.map((b) => b.prior), calibrated: false };
}

export function pickBucket(p: number[], confidence: number, reachable = ALL_REACHABLE): { index: number; meetsConfidence: boolean } {
  const open = p.map((v, i) => ({ v, i })).filter((b) => reachable[b.i]);
  const hit = open.find((b) => b.v >= confidence);
  if (hit) return { index: hit.i, meetsConfidence: true };
  return { index: open.at(-1)?.i ?? p.length - 1, meetsConfidence: false };
}

function bucketPrice(index: number, horizon: number): number {
  const b = BUCKETS[index] as (typeof BUCKETS)[number];
  const pct = b.hi >= 100 ? TOP_PERCENTILE : b.hi;
  return Math.min(config.tipCeilingLamports, Math.max(BEAM_MIN_TIP, forecastAt(pct, horizon)));
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

// A slower fare never costs more than a faster one.
export function capByFaster<T extends { tipLamports: number }>(slowestFirst: T[]): T[] {
  const out = slowestFirst.map((f) => ({ ...f }));
  for (let i = out.length - 2; i >= 0; i--) {
    const faster = out[i + 1] as T;
    if ((out[i] as T).tipLamports > faster.tipLamports) (out[i] as T).tipLamports = faster.tipLamports;
  }
  return out;
}

export async function fares(outcomes: ProbeOutcome[], solPriceUsd: number | null) {
  const quotes = await Promise.all(FARES.map((f) => quote(f.deadlineSlots, f.confidence, outcomes, FARE_FORECAST_SLOTS)));
  const priced = capByFaster(FARES.map((f, i) => ({ fare: f, q: quotes[i] as Awaited<ReturnType<typeof quote>>, tipLamports: (quotes[i] as { tipLamports: number }).tipLamports })));
  const dist = distribution();
  return {
    fares: priced.map(({ fare, q, tipLamports }) => ({
      id: fare.id,
      label: fare.label,
      deadlineSlots: fare.deadlineSlots,
      deadlineMs: fare.deadlineSlots * SLOT_MS,
      confidence: fare.confidence,
      tipLamports,
      tipSol: tipLamports / LAMPORTS_PER_SOL,
      tipUsd: solPriceUsd === null ? null : Math.round((tipLamports / LAMPORTS_PER_SOL) * solPriceUsd * 10_000) / 10_000,
      priorityFeeMicroLamports: q.priorityFeeMicroLamports,
      probability: q.probability,
      meetsConfidence: q.meetsConfidence,
    })),
    calibrated: quotes[0]?.calibrated ?? false,
    progress: progress(outcomes, reachableBuckets(dist.sorted)),
    samples: dist.sorted.length,
    solPriceUsd,
  };
}

export async function quote(deadline: number, confidence: number, outcomes: ProbeOutcome[], horizon = deadline) {
  const dist = distribution();
  const reachable = reachableBuckets(dist.sorted);
  const { p, calibrated } = probabilities(outcomes, deadline, reachable);
  const { index, meetsConfidence } = pickBucket(p, confidence, reachable);
  const tipLamports = bucketPrice(index, horizon);
  return {
    deadlineSlots: deadline,
    confidence,
    tipLamports,
    tipSol: tipLamports / LAMPORTS_PER_SOL,
    priorityFeeMicroLamports: await priorityFee(),
    probability: Math.round((p[index] as number) * 1000) / 1000,
    meetsConfidence,
    calibrated,
    bucket: { lo: BUCKETS[index]?.lo, hi: BUCKETS[index]?.hi },
    buckets: BUCKETS.map((b, i) => ({ lo: b.lo, hi: b.hi, p: p[i], status: reachable[i] ? "reachable" : "above tip ceiling" })),
    tipCeilingLamports: config.tipCeilingLamports,
    distribution: { source: dist.source, samples: dist.sorted.length, beamFloorPercentile: floorPercentile() },
    heatMultiplier: heatMultiplier(),
  };
}
