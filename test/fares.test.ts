import { describe, expect, it, vi } from "vitest";

vi.mock("../src/solami.js", () => ({
  rpc: vi.fn(async () => [{ prioritizationFee: 1_000 }, { prioritizationFee: 2_000 }]),
  beamRecord: vi.fn(async () => null),
  beamSend: vi.fn(async () => "sig"),
}));

const { BUCKETS, FARES } = await import("../src/config.js");
const { fares, landingModel, quote } = await import("../src/quote.js");
const { addTip, onConfirmed } = await import("../src/tips.js");

// 200 landed tips from 100,000 to 1,493,000 lamports: the top quarter sits above
// the default 1,000,000 lamport ceiling, so buckets p75 and up are unreachable.
for (let i = 0; i < 200; i++) addTip({ slot: 1_000 + Math.floor(i / 20), signature: `t${i}`, lamports: 100_000 + i * 7_000, source: "jito", payer: "p" });
for (let s = 1_000; s < 1_010; s++) onConfirmed(s);

type Outcome = { bucket: number; slotsToLand: number | null; sentSlot: number };
const trips = (bucket: number, slots: (number | null)[]): Outcome[] => slots.map((s, i) => ({ bucket, slotsToLand: s, sentSlot: 900 + bucket * 20 + i }));
const repeat = (v: number | null, n: number) => Array.from({ length: n }, () => v);
const bucketIndex = (lo: number) => BUCKETS.findIndex((b) => b.lo === lo);

function consistent(out: Awaited<ReturnType<typeof fares>>, outcomes: Outcome[]) {
  for (const f of out.fares) {
    const model = landingModel(outcomes, f.deadlineSlots);
    const b = model.buckets[bucketIndex(f.bucket.lo)]!;
    expect(f.probability).toBeCloseTo(b.p, 3);
    expect(f.meetsConfidence).toBe(b.p >= f.confidence);
    expect(f.estimate.basis).toBe(b.basis);
    expect(f.estimate.samples).toBe(b.n);
  }
}

describe("fares describe their final price", () => {
  it("selects the cheapest bucket for equal estimates, so fares can share one tip", async () => {
    const outcomes = [0, 1, 2].flatMap((b) => trips(b, repeat(1, 10)));
    const out = await fares(outcomes, 100);
    consistent(out, outcomes);
    expect(new Set(out.fares.map((f) => f.tipLamports)).size).toBe(1);
    expect(out.fares.every((f) => f.bucket.lo === 0 && f.meetsConfidence)).toBe(true);
    expect(new Set(out.fares.map((f) => f.priorityFeeMicroLamports)).size).toBe(1);
  });

  it("never attaches a pricier bucket's probability to a cheaper tip", async () => {
    // Saver needs bucket p25 to meet 0.8 at 10 slots; Express misses 0.9 at 1 slot everywhere.
    const outcomes = [
      ...trips(0, [...repeat(1, 3), ...repeat(12, 7)]),
      ...trips(1, [...repeat(2, 9), 1]),
      ...trips(2, [...repeat(2, 9), 1]),
    ];
    const out = await fares(outcomes, 100);
    consistent(out, outcomes);
    const [saver, , express] = out.fares;
    expect(saver!.meetsConfidence).toBe(true);
    expect(saver!.bucket.lo).toBe(25);
    expect(express!.meetsConfidence).toBe(false);
    expect(express!.tipLamports).toBeLessThan(saver!.tipLamports);
  });

  it("a slower fare that meets its target never costs more than a faster one that meets its own", async () => {
    const outcomes = [...trips(0, [...repeat(1, 5), ...repeat(3, 5)]), ...trips(1, repeat(1, 10)), ...trips(2, repeat(1, 10))];
    const out = await fares(outcomes, 100);
    consistent(out, outcomes);
    const met = out.fares.filter((f) => f.meetsConfidence);
    for (let i = 0; i < met.length - 1; i++) expect(met[i]!.tipLamports).toBeLessThanOrEqual(met[i + 1]!.tipLamports);
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
