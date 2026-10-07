import { describe, expect, it } from "vitest";
import { BUCKETS } from "../src/config.js";
import { brier, calibration, landingModel, pickBucket, probabilities, reachableBuckets } from "../src/quote.js";

const probes = (bucket: number, landed: number, missed: number, slots = 1) => [
  ...Array.from({ length: landed }, () => ({ bucket, slotsToLand: slots })),
  ...Array.from({ length: missed }, () => ({ bucket, slotsToLand: null })),
];

describe("landing model", () => {
  it("applies the (landed + 1) / (n + 2) estimate per bucket", () => {
    const m = landingModel(probes(0, 8, 2), 2);
    expect(m.buckets[0]!.p).toBeCloseTo(9 / 12);
    expect(m.calibrated).toBe(false);
  });

  it("counts only landings within the deadline", () => {
    const m = landingModel(probes(0, 10, 0, 5), 2);
    expect(m.buckets[0]!.p).toBeCloseTo(1 / 12);
  });

  it("is monotone non-decreasing across buckets", () => {
    const m = landingModel([...probes(0, 9, 1), ...probes(1, 2, 8)], 2);
    const p = m.buckets.map((b) => b.p);
    for (let i = 1; i < p.length; i++) expect(p[i]!).toBeGreaterThanOrEqual(p[i - 1]!);
  });

  it("uses priors until every bucket has 10 probes", () => {
    const thin = probabilities(probes(0, 50, 0), 2);
    expect(thin.calibrated).toBe(false);
    expect(thin.p).toEqual(BUCKETS.map((b) => b.prior));
    const full = probabilities(BUCKETS.flatMap((_, i) => probes(i, 10, 0)), 2);
    expect(full.calibrated).toBe(true);
    expect(full.p[0]).toBeCloseTo(11 / 12);
  });
});

describe("pickBucket", () => {
  const p = [0.5, 0.65, 0.8, 0.9, 0.95];
  it("returns the cheapest bucket meeting the confidence", () => {
    expect(pickBucket(p, 0.8)).toEqual({ index: 2, meetsConfidence: true });
    expect(pickBucket(p, 0.5)).toEqual({ index: 0, meetsConfidence: true });
  });
  it("falls back to the top bucket when none qualifies", () => {
    expect(pickBucket(p, 0.99)).toEqual({ index: 4, meetsConfidence: false });
  });
});

describe("calibration", () => {
  it("scores predictions with the Brier score", () => {
    expect(brier([{ predicted: 1, landed: true }, { predicted: 0, landed: false }])).toBe(0);
    expect(brier([{ predicted: 0.5, landed: true }])).toBe(0.25);
    expect(brier([])).toBeNull();
  });
  it("reports predicted vs actual per bucket", () => {
    const c = calibration([
      { bucket: 0, predicted: 0.5, slotsToLand: 1 },
      { bucket: 0, predicted: 0.5, slotsToLand: null },
    ]);
    expect(c.buckets[0]).toMatchObject({ n: 2, predicted: 0.5, actual: 0.5 });
    expect(c.brier).toBe(0.25);
  });
});

describe("tipForBucket", async () => {
  const { tipForBucket, bucketOf } = await import("../src/quote.js");
  const { rankOf } = await import("../src/stats.js");
  // 40% of eligible tips sit exactly at the Beam floor, the rest spread above.
  const sorted = [...Array(40).fill(100_000), ...Array.from({ length: 60 }, (_, i) => 110_000 + i * 10_000)];

  it("returns a tip whose mid-rank falls inside the requested bucket", () => {
    for (let b = 0; b < 5; b++) {
      const t = tipForBucket(sorted, b);
      expect(t).not.toBeNull();
      expect(bucketOf(rankOf(sorted, t!.tip))).toBe(b);
    }
  });

  it("uses the tie value itself for the bucket the tie covers", () => {
    expect(tipForBucket(sorted, 0)!.tip).toBe(100_000);
  });
});

describe("buckets above the tip ceiling", () => {
  const reachable = [true, true, true, false, false];

  it("calibrates once every reachable bucket has 10 probes", () => {
    const outcomes = [0, 1, 2].flatMap((i) => probes(i, 10, 0));
    expect(landingModel(outcomes, 2).calibrated).toBe(false);
    expect(landingModel(outcomes, 2, reachable).calibrated).toBe(true);
    expect(calibration(outcomes.map((o) => ({ ...o, predicted: 0.5 })), reachable).buckets[3]?.status).toBe("above tip ceiling");
  });

  it("never quotes an unreachable bucket", () => {
    expect(pickBucket([0.5, 0.65, 0.8, 0.9, 0.95], 0.9, reachable)).toEqual({ index: 2, meetsConfidence: false });
    expect(pickBucket([0.5, 0.65, 0.8, 0.9, 0.95], 0.6, reachable)).toEqual({ index: 1, meetsConfidence: true });
  });

  it("marks buckets whose cheapest tip exceeds the ceiling", () => {
    // Half the tips sit far above any ceiling used in practice.
    const sorted = [...Array.from({ length: 50 }, (_, i) => 100_000 + i * 1_000), ...Array(50).fill(1e12)];
    // A tip at the ceiling outranks every cheaper tip, landing at p50.
    expect(reachableBuckets(sorted)).toEqual([true, true, true, false, false]);
    expect(reachableBuckets([])).toEqual([true, true, true, true, true]);
  });
});
