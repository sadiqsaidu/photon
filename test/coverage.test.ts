import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db.js", () => ({ saveSkip: vi.fn(async () => undefined), leaderStats: vi.fn(async () => new Map()) }));
vi.mock("../src/solami.js", () => ({ rpc: vi.fn(async () => []) }));

type Tips = typeof import("../src/tips.js");
let tips: Tips;
beforeEach(async () => {
  vi.resetModules();
  tips = await import("../src/tips.js");
});

const MIN = 150;
// Confirms slots from..to with one eligible tip each.
function stream(from: number, to: number, lamports = (s: number) => 100_000 + s) {
  for (let s = from; s <= to; s++) {
    tips.addTip({ slot: s, signature: `sig${s}`, lamports: lamports(s), source: "jito", payer: "p" });
    tips.onConfirmed(s);
  }
}

describe("reconnect gaps", async () => {
  const { resumeSlot, sessionGap } = await import("../src/grpc.js");
  const REPLAY_MS = 15 * 60_000;

  it("does not resume past the replay window and records the gap", () => {
    expect(resumeSlot(1_000, 0, REPLAY_MS + 1, false)).toBe(0);
    expect(sessionGap(0, 1_000, 3_000)).toEqual({ from: 1_001, to: 3_002 });
    stream(1, 1_000);
    tips.markGap(1_001, 3_002);
    stream(2_995, 3_200);
    for (let s = 2_995; s <= 3_002; s++) expect(tips.isComplete(s)).toBe(false);
    expect(tips.isComplete(3_003)).toBe(true);
    expect(tips.distribution().sorted).not.toContain(100_000 + 3_000);
    expect(tips.distribution().sorted).toContain(100_000 + 3_003);
    const row = tips.tipState().window.find((r) => r.slot === 3_000);
    expect(row).toMatchObject({ incomplete: true });
  });

  it("leaves no incomplete slots after a replayed reconnect", () => {
    expect(resumeSlot(1_000, 0, 60_000, false)).toBe(999);
    expect(sessionGap(999, 1_000, 999)).toBeNull();
    stream(400, 1_000);
    stream(999, 1_200);
    const c = tips.coverage();
    expect(c.coverage).toBe(1);
    expect(c.incompleteSlots).toBe(0);
    expect(c.warmingUp).toBe(false);
  });

  it("tells a refused resume from a network fault", async () => {
    const { refusesResume } = await import("../src/grpc.js");
    expect(refusesResume(Object.assign(new Error("from_slot 1000 is not available"), { code: 3 }))).toBe(true);
    expect(refusesResume(Object.assign(new Error("14 UNAVAILABLE: No connection established"), { code: 14 }))).toBe(false);
  });

  it("does not retry a refused resume, and a replay that starts late is a gap", () => {
    expect(resumeSlot(1_000, 0, 60_000, true)).toBe(0);
    expect(sessionGap(999, 1_000, 1_050)).toEqual({ from: 1_001, to: 1_049 });
  });
});

describe("partial slots", () => {
  it("marks a slot with shed transaction updates incomplete and leaves it out of prices", () => {
    stream(1, 300);
    tips.addTip({ slot: 301, signature: "a", lamports: 9_000_000, source: "jito", payer: "p" });
    tips.markShed(301);
    tips.onConfirmed(301);
    expect(tips.isComplete(301)).toBe(false);
    expect(tips.distribution().sorted).not.toContain(9_000_000);
    expect(tips.coverage().completeSlots).toBe(300);
  });
});

describe("coverage", () => {
  it("does not count skipped leader slots as missing data", () => {
    const skipped = new Set<number>();
    for (let s = 1; s <= 600; s += 20) skipped.add(s);
    tips.useSkips((s) => skipped.has(s));
    // Skipped slots never confirm.
    for (let s = 1; s <= 600; s++) if (!skipped.has(s)) stream(s, s);
    const c = tips.coverage();
    expect(c.windowSlots).toBe(600 - skipped.size);
    expect(c.completeSlots).toBe(600 - skipped.size);
    expect(c.coverage).toBe(1);
    expect(c.incompleteSlots).toBe(0);
  });

  it("warms up below the minimum of complete slots", () => {
    stream(1, MIN - 1);
    expect(tips.coverage().warmingUp).toBe(true);
    stream(MIN, MIN);
    expect(tips.coverage().warmingUp).toBe(false);
    expect(tips.coverage().coverage).toBeCloseTo(MIN / 600, 3);
  });

  it("starts warming up after a restart until the window refills", () => {
    tips.seedWindow([{ slot: 900, leader: null, count: 5, beamCount: 0, p25: 1, p50: 2, p75: 3, p90: 4, max: 5, heat: 0 }]);
    tips.markGap(1, 1_002);
    stream(1_000, 1_100);
    expect(tips.coverage().completeSlots).toBe(98);
    expect(tips.coverage().warmingUp).toBe(true);
  });
});

describe("leader skips", () => {
  it("are not recorded for slots the stream missed", async () => {
    const leaders = await import("../src/leaders.js");
    tips.markGap(105, 110);
    leaders.onFinalized(100);
    leaders.onFinalized(112);
    expect(leaders.isSkipped(103)).toBe(true);
    expect(leaders.isSkipped(107)).toBe(false);
  });
});
