import {
  BEAM_MIN_TIP,
  BUCKETS,
  config,
  LAMPORTS_PER_SOL,
  MIN_BUCKET_PROBES,
  PRIORITY_FEE_TTL_MS,
} from "./config.js";
import { rpc } from "./solami.js";
import { distribution, floorPercentile, forecastAt, heatMultiplier, percentile } from "./tips.js";

// Calibration scores every probe against this deadline.
export const CALIBRATION_DEADLINE = 2;
// The top bucket is priced at p99, not the window maximum (one outlier).
const TOP_PERCENTILE = 99;

export interface ProbeOutcome {
  bucket: number;
  slotsToLand: number | null;
}

export function landingModel(outcomes: ProbeOutcome[], deadline: number) {
  const buckets = BUCKETS.map((b, i) => {
    const mine = outcomes.filter((o) => o.bucket === i);
    const landed = mine.filter((o) => o.slotsToLand !== null && o.slotsToLand <= deadline).length;
    return { ...b, n: mine.length, landed, p: (landed + 1) / (mine.length + 2) };
  });
  let floor = 0;
  for (const b of buckets) floor = b.p = Math.max(floor, b.p);
  return { buckets, calibrated: buckets.every((b) => b.n >= MIN_BUCKET_PROBES) };
}

export function probabilities(outcomes: ProbeOutcome[], deadline: number): { p: number[]; calibrated: boolean } {
  const model = landingModel(outcomes, deadline);
  return model.calibrated ? { p: model.buckets.map((b) => b.p), calibrated: true } : { p: BUCKETS.map((b) => b.prior), calibrated: false };
}

export function pickBucket(p: number[], confidence: number): { index: number; meetsConfidence: boolean } {
  const index = p.findIndex((v) => v >= confidence);
  return index >= 0 ? { index, meetsConfidence: true } : { index: p.length - 1, meetsConfidence: false };
}

export function bucketPrice(index: number, deadline: number): number {
  const b = BUCKETS[index] as (typeof BUCKETS)[number];
  const pct = b.hi >= 100 ? TOP_PERCENTILE : b.hi;
  return Math.min(config.tipCeilingLamports, Math.max(BEAM_MIN_TIP, forecastAt(pct, deadline)));
}

let feeCache: { at: number; value: number } | null = null;
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

export function calibration(probes: { bucket: number; predicted: number; slotsToLand: number | null }[]) {
  const landed = (p: { slotsToLand: number | null }) => p.slotsToLand !== null && p.slotsToLand <= CALIBRATION_DEADLINE;
  const model = landingModel(probes, CALIBRATION_DEADLINE);
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
      };
    }),
  };
}

export async function quote(deadline: number, confidence: number, outcomes: ProbeOutcome[]) {
  const { p, calibrated } = probabilities(outcomes, deadline);
  const { index, meetsConfidence } = pickBucket(p, confidence);
  const tipLamports = bucketPrice(index, deadline);
  const dist = distribution();
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
    distribution: { source: dist.source, samples: dist.sorted.length, beamFloorPercentile: floorPercentile() },
    heatMultiplier: heatMultiplier(),
  };
}
