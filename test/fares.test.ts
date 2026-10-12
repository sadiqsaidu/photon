import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/solami.js", () => ({
  rpc: vi.fn(async () => [{ prioritizationFee: 1_000 }, { prioritizationFee: 2_000 }]),
  beamRecord: vi.fn(async () => null),
  beamSend: vi.fn(async () => "sig"),
}));

const { BUCKETS, FARES, config } = await import("../src/config.js");
const { bucketOf, farePrices, fares, landingModel, quote, resetFareHistory } = await import("../src/quote.js");
const { rankOf } = await import("../src/stats.js");
const { addTip, onConfirmed } = await import("../src/tips.js");

// 200 landed tips from 100,000 to 1,493,000 lamports: p50 is 793,000, p75
// 1,143,000 and p90 1,353,000, so the top quarter sits above the default
// 1,000,000 lamport ceiling and buckets p75 and up are unreachable.
for (let i = 0; i < 200; i++) addTip({ slot: 1_000 + Math.floor(i / 20), signature: `t${i}`, lamports: 100_000 + i * 7_000, source: "jito", payer: "p" });
for (let s = 1_000; s < 1_010; s++) onConfirmed(s);

type Outcome = { bucket: number; slotsToLand: number | null; sentSlot: number };
const trips = (bucket: number, slots: (number | null)[]): Outcome[] => slots.map((s, i) => ({ bucket, slotsToLand: s, sentSlot: 900 + bucket * 20 + i }));
const repeat = (v: number | null, n: number) => Array.from({ length: n }, () => v);
const bucketIndex = (lo: number) => BUCKETS.findIndex((b) => b.lo === lo);
const sorted = Array.from({ length: 200 }, (_, i) => 100_000 + i * 7_000);
const ceiling = config.tipCeilingLamports;
beforeEach(() => resetFareHistory());
afterEach(() => {
  config.tipCeilingLamports = ceiling;
});

describe("fares price from where landed tips sit today", () => {
  it("prices Saver, Standard and Express at p50, p75 and p90 of eligible landed tips", async () => {
    config.tipCeilingLamports = 2_000_000;
    const out = await fares([], 100);
    expect(out.pricing).toBe("market-percentile");
    expect(out.fares.map((f) => f.tipPercentile)).toEqual([50, 75, 90]);
    expect(out.fares.map((f) => f.tipLamports)).toEqual([790_000, 1_100_000, 1_400_000]);
    expect(out.fares.map((f) => f.stepApplied)).toEqual([false, false, false]);
    expect(out.fares.some((f) => f.ceilingLimited)).toBe(false);
    expect(new Set(out.fares.map((f) => f.priorityFeeMicroLamports)).size).toBe(1);
  });

  it("separates fares that collide at the Beam minimum by the minimum step", () => {
    const prices = farePrices(Array.from({ length: 300 }, () => 100_000));
    expect(prices.map((p) => p.tipLamports)).toEqual([100_000, 130_000, 170_000]);
    expect(prices.map((p) => p.stepApplied)).toEqual([false, true, true]);
    for (let i = 1; i < prices.length; i++) expect(prices[i]!.tipLamports).toBeGreaterThanOrEqual(prices[i - 1]!.tipLamports * 1.25);
  });

  it("caps at the tip ceiling and keeps the order non-decreasing when the ceiling forbids a strict one", async () => {
    const out = await fares([], 100);
    const [saver, standard, express] = out.fares;
    expect(saver!.tipLamports).toBe(790_000);
    expect(standard!.tipLamports).toBe(1_000_000);
    expect(express!.tipLamports).toBe(1_000_000);
    expect([saver!.ceilingLimited, standard!.ceilingLimited, express!.ceilingLimited]).toEqual([false, true, true]);
  });

  it("caps a stepped fare at the ceiling and says so", () => {
    config.tipCeilingLamports = 120_000;
    const prices = farePrices(Array.from({ length: 300 }, () => 100_000));
    expect(prices.map((p) => p.tipLamports)).toEqual([100_000, 120_000, 120_000]);
    expect(prices.map((p) => p.ceilingLimited)).toEqual([false, true, true]);
  });

  it("smooths each fare over its last five ticks, so a noisy window does not flicker", () => {
    config.tipCeilingLamports = 5_000_000;
    const at = (p50: number) => [...Array.from({ length: 50 }, () => 100_000), ...Array.from({ length: 50 }, () => p50), ...Array.from({ length: 50 }, () => p50 * 3)];
    const shown: number[] = [];
    const noisy = [300_000, 318_000, 285_000, 302_000, 900_000, 296_000, 311_000, 120_000, 305_000, 290_000, 980_000, 299_000, 303_000];
    for (const v of noisy) shown.push(farePrices(at(v))[0]!.tipLamports);
    const changes = (a: number[]) => a.slice(1).filter((v, i) => v !== a[i]).length;
    expect(new Set(shown.slice(2))).toEqual(new Set([300_000]));
    expect(changes(shown.slice(2))).toBe(0);
    expect(changes(noisy)).toBe(noisy.length - 1);
    for (const v of [600_000, 600_000, 600_000]) shown.push(farePrices(at(v))[0]!.tipLamports);
    expect(shown.at(-1)).toBe(600_000);
  });

  it("states the estimate for the bucket the final tip falls in, at each fare's own deadline", async () => {
    config.tipCeilingLamports = 2_000_000;
    const outcomes = [
      ...trips(1, [...repeat(1, 9), 12]),
      ...trips(2, [...repeat(1, 6), ...repeat(2, 4)]),
      ...trips(4, repeat(1, 10)),
    ];
    const out = await fares(outcomes, 100);
    for (const f of out.fares) {
      const b = landingModel(outcomes, f.deadlineSlots).buckets[bucketOf(rankOf(sorted, f.tipLamports))]!;
      expect(f.bucket.lo).toBe(b.lo);
      expect(f.probability).toBeCloseTo(b.p, 3);
      expect(f.meetsConfidence).toBe(b.p >= f.confidence);
      expect(f.estimate.basis).toBe(b.basis);
      expect(f.estimate.samples).toBe(b.n);
    }
    const [saver, standard, express] = out.fares;
    expect(saver!.bucket.lo).toBe(25);
    expect(standard!.bucket.lo).toBe(50);
    expect(express!.bucket.lo).toBe(90);
    expect(saver!.probabilityAtCheaperTip).toBeNull();
    expect(express!.probability).toBeGreaterThan(express!.probabilityAtCheaperTip!);
    expect(express!.meetsConfidence).toBe(true);
  });

  it("keeps quote on cheapest-tip-meeting-target pricing", async () => {
    const outcomes = [0, 1, 2].flatMap((b) => trips(b, repeat(1, 10)));
    const q = await quote(4, 0.9, outcomes, 0);
    expect(q.bucket.lo).toBe(0);
    expect(q.meetsConfidence).toBe(true);
    const out = await fares(outcomes, 100);
    expect(out.fares[0]!.tipLamports).toBeGreaterThan(q.tipLamports);
  });

  it("labels an unmet target honestly and flags the tip ceiling", async () => {
    const outcomes = [0, 1, 2].flatMap((b) => trips(b, [...repeat(1, 6), ...repeat(2, 4)]));
    const q = await quote(1, 0.9, outcomes, 0);
    expect(q.meetsConfidence).toBe(false);
    expect(q.bucket.lo).toBe(0);
    expect(q.probability).toBeCloseTo(7 / 12, 3);
    expect(q.ceilingLimited).toBe(true);
    expect(q.buckets.filter((b) => b.status === "above tip ceiling").length).toBeGreaterThan(0);
  });

  it("keeps measured buckets while another is thin, and marks inherited and prior estimates", async () => {
    const outcomes = [...trips(1, repeat(1, 10)), ...trips(2, repeat(1, 3))];
    const m = landingModel(outcomes, 4);
    expect(m.buckets.map((b) => b.basis)).toEqual(["prior", "measured", "inherited", "inherited", "inherited"]);
    expect(m.buckets[0]!.p).toBeCloseTo(BUCKETS[0]!.prior);
    expect(m.buckets[2]!.p).toBeCloseTo(11 / 12);
    expect(m.calibrated).toBe(false);
    expect(landingModel([], 4).buckets.every((b) => b.basis === "prior")).toBe(true);
  });

  it("pools contradictory buckets instead of copying the cheaper one's best result upward", () => {
    const outcomes = [...trips(0, [...repeat(1, 8), ...repeat(2, 2)]), ...trips(1, [...repeat(1, 5), ...repeat(2, 5)])];
    const m = landingModel(outcomes, 1);
    expect(m.buckets[0]!.p).toBeCloseTo(15 / 24, 6);
    expect(m.buckets[1]!.p).toBeCloseTo(15 / 24, 6);
    expect(m.buckets[0]!.newestSlot).toBe(909);
  });

  it("keeps the configured fares within what 10 probes per bucket can show", () => {
    for (const f of FARES) expect(f.confidence).toBeLessThanOrEqual(11 / 12);
  });
});

describe("server-paid demo sends", () => {
  it("check the budget against the fare's actual tip", async () => {
    const { demoRefusal } = await import("../src/probe.js");
    const budget = Math.round(config.probeBudgetSol * 1e9);
    const base = { id: "express" as const, priorityFeeMicroLamports: 0, probability: 0.9, deadlineSlots: 1 };
    expect(demoRefusal({ ...base, tipLamports: 1_000_000 })).toBeNull();
    expect(demoRefusal({ ...base, tipLamports: budget })?.reason).toBe("budget");
  });
});
