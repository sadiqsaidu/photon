import { describe, expect, it, vi } from "vitest";

vi.mock("../src/solami.js", () => ({
  rpc: vi.fn(async () => [{ prioritizationFee: 0 }, { prioritizationFee: 2_000 }, { prioritizationFee: 4_000 }, { prioritizationFee: 6_000 }]),
  beamRecord: vi.fn(async () => null),
  beamSend: vi.fn(async () => "sig"),
}));

const { FARES, SLOT_MS } = await import("../src/config.js");
const { capByFaster, fares, progress, trackRecord } = await import("../src/quote.js");
const { moodOf, rankPayers } = await import("../src/tips.js");
const { explain } = await import("../src/explain.js");
const { limiter } = await import("../src/server.js");
const { stampOf } = await import("../src/audit.js");
type Receipt = import("../src/lifecycle.js").Receipt;

describe("fares", () => {
  it("returns one priced fare per class, slowest first, with the full shape", async () => {
    const out = await fares([], 150);
    expect(out.fares.map((f) => f.id)).toEqual(["saver", "standard", "express"]);
    for (const [i, f] of out.fares.entries()) {
      const def = FARES[i]!;
      expect(f).toMatchObject({ label: def.label, deadlineSlots: def.deadlineSlots, deadlineMs: def.deadlineSlots * SLOT_MS, confidence: def.confidence });
      expect(f.tipLamports).toBeGreaterThanOrEqual(100_000);
      expect(f.tipSol).toBeCloseTo(f.tipLamports / 1e9);
      expect(f.tipUsd).toBeCloseTo((f.tipLamports / 1e9) * 150, 4);
      expect(typeof f.probability).toBe("number");
      expect(typeof f.meetsConfidence).toBe("boolean");
    }
    expect(out).toMatchObject({ calibrated: false, solPriceUsd: 150, progress: { done: 0, needed: 50 } });
  });

  it("never lets a slower fare cost more than a faster one", () => {
    const out = capByFaster([{ tipLamports: 900 }, { tipLamports: 500 }, { tipLamports: 700 }]);
    expect(out.map((f) => f.tipLamports)).toEqual([500, 500, 700]);
  });

  it("asks for no confidence the smoothed model cannot reach with 10 probes per bucket", () => {
    for (const f of FARES) expect(f.confidence).toBeLessThanOrEqual(11 / 12);
  });

  it("leaves dollars empty without a SOL price", async () => {
    expect((await fares([], null)).fares.every((f) => f.tipUsd === null)).toBe(true);
  });
});

describe("calibration progress and track record", () => {
  const trips = (bucket: number, n: number, slots: number | null, from = 0) =>
    Array.from({ length: n }, (_, i) => ({ bucket, slotsToLand: slots, sentSlot: from + i }));

  it("counts test trips toward reachable buckets only, capped at 10 each", () => {
    const reachable = [true, true, true, false, false];
    expect(progress([...trips(0, 14, 3), ...trips(1, 4, 3), ...trips(3, 5, 3)], reachable)).toEqual({ done: 14, needed: 30 });
  });

  it("scores each trip against the model built from earlier trips only", () => {
    const t = trackRecord([...trips(0, 3, 2), ...trips(0, 1, null, 3)], 6, [true, true, true, false, false]);
    expect(t.trips).toBe(4);
    expect(t.rows[0]).toMatchObject({ n: 4, promised: 0.5, delivered: 0.75 });
    expect(t.averageGapPoints).toBe(25);
    expect(t.rows[1]).toMatchObject({ n: 0, promised: null, delivered: null });
  });
});

describe("mood", () => {
  it("is quiet below 0.8 times the window median, rush above 1.5, busy between", () => {
    expect(moodOf(79, 100)).toEqual({ mood: "quiet", ratio: 0.79 });
    expect(moodOf(80, 100).mood).toBe("busy");
    expect(moodOf(150, 100).mood).toBe("busy");
    expect(moodOf(151, 100)).toEqual({ mood: "rush", ratio: 1.51 });
    expect(moodOf(0, 100)).toEqual({ mood: "busy", ratio: 1 });
  });
});

describe("example wallets", () => {
  it("ranks by tips, then by the latest slot, without excluded wallets", () => {
    const counts = new Map([
      ["a", { tips: 5, lastSlot: 10 }],
      ["b", { tips: 9, lastSlot: 8 }],
      ["probe", { tips: 50, lastSlot: 12 }],
      ["c", { tips: 5, lastSlot: 11 }],
      ["d", { tips: 1, lastSlot: 13 }],
    ]);
    expect(rankPayers(counts, new Set(["probe"]), 3)).toEqual([
      { address: "b", tips: 9, lastSlot: 8 },
      { address: "c", tips: 5, lastSlot: 11 },
      { address: "a", tips: 5, lastSlot: 10 },
    ]);
  });
});

describe("rate limiter", () => {
  it("allows max hits per window per key and reports the wait in seconds", () => {
    let now = 0;
    const l = limiter(2, 60_000, () => now);
    expect(l.wait("ip")).toBe(0);
    l.hit("ip");
    l.hit("ip");
    expect(l.wait("ip")).toBe(60);
    expect(l.wait("other")).toBe(0);
    now = 30_000;
    expect(l.wait("ip")).toBe(30);
    now = 60_001;
    expect(l.wait("ip")).toBe(0);
  });
});

describe("wallet checkup stamp", () => {
  it("is overpaid above 30% of tips, too low above 25% of trades, else fair", () => {
    expect(stampOf(100, 31, 10, 5)).toBe("overpaid");
    expect(stampOf(100, 30, 10, 3)).toBe("too_low");
    expect(stampOf(100, 10, 10, 2)).toBe("fair");
    expect(stampOf(0, 0, 0, 0)).toBe("fair");
  });
});

describe("explain", () => {
  const base: Receipt = {
    signature: "s", kind: "demo", sentSlot: 100, lastValidBlockHeight: 5_000, tip: 200_000,
    stages: { submitted: { slot: 100, ms: 0 } }, landedSlot: null, failure: null, error: null, beam: null,
    settled: true, sentAt: 0, fare: null, quotedProbability: null, deadlineSlots: null,
  };

  it("is null while the transaction is on its way", () => {
    expect(explain({ ...base, settled: false })).toBeNull();
  });

  it("says how fast it landed and whether the promise was kept", () => {
    const kept = explain({ ...base, landedSlot: 103, stages: { ...base.stages, processed: { slot: 103, ms: 1_210 } }, fare: "standard", quotedProbability: 0.9, deadlineSlots: 6 });
    expect(kept).toMatchObject({ verdict: "landed", title: "Landed in 3 blocks (1.2 s)." });
    expect(kept?.whatHappened).toBe("We promised 90% within 6 blocks. It took 3, so the promise was kept.");
    const late = explain({ ...base, landedSlot: 108, fare: "express", quotedProbability: 0.6, deadlineSlots: 3 });
    expect(late?.title).toBe("Landed in 8 blocks (3.2 s).");
    expect(late?.whatHappened).toContain("later than promised");
    expect(explain({ ...base, landedSlot: 101 })?.title).toBe("Landed in 1 block (0.4 s).");
  });

  it("explains a Beam refusal with Beam's error", () => {
    const e = explain({ ...base, failure: "send_rejected", error: "tip_too_low" });
    expect(e).toMatchObject({ verdict: "failed", title: "Beam refused it before it reached the network." });
    expect(e?.whatHappened).toContain('"tip_too_low"');
    expect(e?.whatToDo).toContain("0.0001 SOL");
  });

  it("explains a failure on chain: the tip was still paid", () => {
    const e = explain({ ...base, failure: "failed_onchain", landedSlot: 1_234_567 });
    expect(e?.title).toBe("It made it into block 1,234,567, but the program returned an error.");
    expect(e?.whatHappened).toContain("tip and the fee were still paid");
    expect(e?.whatToDo).toContain("not help");
  });

  it("explains a skipped block builder as bad luck", () => {
    expect(explain({ ...base, failure: "leader_skipped" })).toMatchObject({ verdict: "failed", title: "The block builder skipped its turn." });
  });

  it("explains an expired blockhash with its block height", () => {
    const e = explain({ ...base, failure: "expired_blockhash" });
    expect(e?.whatHappened).toContain("at block height 5,000");
    expect(e?.whatToDo).toContain("fresh blockhash");
  });
});
