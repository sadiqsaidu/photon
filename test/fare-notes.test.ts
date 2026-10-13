import { describe, expect, it } from "vitest";
import { fareNotes as notesOf, tipStanding, type FareLike } from "../web/lib/fareNotes.js";

const fareNotes = (...a: Parameters<typeof notesOf>) => notesOf(...a).map((n) => n.text);

const fare = (id: string, deadlineSlots: number, confidence: number, tipLamports: number, probability: number, extra: Partial<FareLike> = {}): FareLike => ({
  id,
  label: id[0]!.toUpperCase() + id.slice(1),
  deadlineSlots,
  confidence,
  tipLamports,
  priorityFeeMicroLamports: 1_000,
  probability,
  meetsConfidence: probability >= confidence,
  ...extra,
});

describe("fare notes from servers before market pricing", () => {
  it("explains three equal prices without claiming anything about the market", () => {
    const notes = fareNotes([fare("saver", 10, 0.8, 111_814, 0.917), fare("standard", 4, 0.9, 111_814, 0.917), fare("express", 1, 0.9, 111_814, 0.667)]);
    expect(notes[0]).toContain("Same recommended tip for all three fares");
    expect(notes[0]).toContain("adds no priority");
    expect(notes[1]).toBe(
      "Express target not met: estimated 67% within 1 block (target 90%). No higher eligible tip currently shows a better estimate in our model.",
    );
    expect(notes.join(" ")).not.toMatch(/quiet|rush|faster|cannot help/i);
  });

  it("handles Saver and Standard equal only", () => {
    expect(fareNotes([fare("saver", 10, 0.8, 100, 0.917), fare("standard", 4, 0.9, 100, 0.917), fare("express", 1, 0.9, 300, 0.95)])).toEqual([
      "Saver and Standard share a tip: the cheapest eligible tip already meets both targets in our current estimates.",
    ]);
    expect(fareNotes([fare("saver", 10, 0.8, 100, 0.85), fare("standard", 4, 0.9, 100, 0.85), fare("express", 1, 0.9, 300, 0.95)])[0]).toContain(
      "do not justify a higher tip for Standard",
    );
  });

  it("handles Standard and Express equal only", () => {
    expect(fareNotes([fare("saver", 10, 0.8, 100, 0.9), fare("standard", 4, 0.9, 300, 0.92), fare("express", 1, 0.9, 300, 0.92)])).toEqual([
      "Standard and Express share a tip and fee, so choosing Express adds no priority.",
    ]);
  });

  it("says nothing when all prices differ and every target is met", () => {
    expect(fareNotes([fare("saver", 10, 0.8, 100, 0.9), fare("standard", 4, 0.9, 200, 0.92), fare("express", 1, 0.9, 300, 0.95)])).toEqual([]);
  });

  it("does not call fares the same when the priority fee differs", () => {
    const notes = fareNotes([fare("saver", 10, 0.8, 100, 0.9), fare("standard", 4, 0.9, 100, 0.92, { priorityFeeMicroLamports: 5 }), fare("express", 1, 0.9, 300, 0.95)]);
    expect(notes).toEqual([]);
  });

  it("tags each note so the board can mark it", () => {
    const kinds = notesOf([fare("saver", 10, 0.8, 1, 0.917), fare("standard", 4, 0.9, 1, 0.917), fare("express", 1, 0.9, 1, 0.5)]).map((n) => n.kind);
    expect(kinds).toEqual(["same", "unmet"]);
  });

  it("names the tip ceiling when it limits the search", () => {
    const notes = fareNotes(
      [fare("saver", 10, 0.8, 100, 0.9), fare("standard", 4, 0.9, 200, 0.92), fare("express", 1, 0.9, 1_000_000, 0.6, { ceilingLimited: true })],
      1_000_000,
    );
    expect(notes).toEqual([
      "Express target not met: estimated 60% within 1 block (target 90%). No higher eligible tip currently shows a better estimate in our model. Tips above the 0.001 SOL ceiling are not evaluated.",
    ]);
  });

  it("returns nothing while fares are missing", () => {
    expect(fareNotes([])).toEqual([]);
  });
});

const market = (id: string, deadlineSlots: number, confidence: number, tipLamports: number, tipPercentile: number, probability: number, probabilityAtCheaperTip: number | null, extra: Partial<FareLike> = {}) =>
  fare(id, deadlineSlots, confidence, tipLamports, probability, { tipPercentile, probabilityAtCheaperTip, ...extra });

describe("fare notes for market-percentile pricing", () => {
  const GAIN = "our test trips have not measured a gain yet";

  it("says the pricier fare has no measured gain when its estimate is not above the cheaper tip's at the same deadline", () => {
    const notes = fareNotes([
      market("saver", 10, 0.8, 125_000, 25, 0.917, null),
      market("standard", 4, 0.9, 300_000, 50, 0.917, 0.917),
      market("express", 2, 0.85, 950_000, 75, 0.75, 0.75),
    ]);
    expect(notes).toEqual([
      "Standard and Express pay at or above the middle of today's tips. That buys position when blocks get crowded; our test trips have not measured a gain yet.",
      "Express target not met: estimated 75% within 2 blocks (target 85%). The price follows today's tips; the estimate comes from our test trips.",
    ]);
  });

  it("names only the fare without a measured gain", () => {
    const notes = fareNotes([
      market("saver", 10, 0.8, 125_000, 25, 0.85, null),
      market("standard", 4, 0.9, 300_000, 50, 0.917, 0.85),
      market("express", 2, 0.85, 950_000, 75, 0.917, 0.917),
    ]);
    expect(notes).toEqual(["Express pays in the top quarter of today's tips. That buys position when blocks get crowded; our test trips have not measured a gain yet."]);
  });

  it("stays silent when estimates rise with price, even though tighter deadlines show lower chances", () => {
    const notes = fareNotes([
      market("saver", 10, 0.8, 125_000, 25, 0.95, null),
      market("standard", 4, 0.9, 300_000, 50, 0.917, 0.85),
      market("express", 2, 0.85, 950_000, 75, 0.917, 0.7),
    ]);
    expect(notes).toEqual([]);
    expect(notes.join(" ")).not.toContain(GAIN);
  });

  it("does not show the gain line against an older server that sends no like-for-like estimate", () => {
    const notes = fareNotes([market("saver", 10, 0.8, 1, 25, 0.9, null), market("standard", 4, 0.9, 2, 50, 0.9, null), market("express", 2, 0.85, 3, 75, 0.9, null)]);
    expect(notes.join(" ")).not.toContain(GAIN);
  });

  it("explains equal prices only by the tip ceiling", () => {
    const notes = notesOf(
      [
        market("saver", 10, 0.8, 440_000, 25, 0.917, null),
        market("standard", 4, 0.9, 1_000_000, 50, 0.917, 0.85, { ceilingLimited: true }),
        market("express", 2, 0.85, 1_000_000, 75, 0.917, 0.917, { ceilingLimited: true }),
      ],
      1_000_000,
    );
    expect(notes).toEqual([{ kind: "ceiling", text: "Standard and Express are held at the 0.001 SOL tip ceiling, so they share a price." }]);
    expect(notes.map((n) => n.text).join(" ")).not.toMatch(/same tip|adds no priority|faster/i);
  });

  it("shows no unmet note when every fare meets its target, as on production data of October 13", () => {
    const notes = notesOf([
      market("saver", 10, 0.8, 120_000, 25, 0.917, null),
      market("standard", 4, 0.9, 210_000, 50, 0.917, 0.917),
      market("express", 2, 0.85, 700_000, 75, 0.896, 0.896),
    ]);
    expect(notes.map((n) => n.kind)).toEqual(["gain"]);
    expect(notes[0]!.text).toBe(
      "Standard and Express pay at or above the middle of today's tips. That buys position when blocks get crowded; our test trips have not measured a gain yet.",
    );
  });

  it("never claims a higher tip guarantees a faster landing", () => {
    const notes = fareNotes([
      market("saver", 10, 0.8, 125_000, 25, 0.5, null),
      market("standard", 4, 0.9, 300_000, 50, 0.5, 0.5),
      market("express", 2, 0.85, 950_000, 75, 0.5, 0.5),
    ]);
    expect(notes.join(" ")).not.toMatch(/guarantee|faster|lands sooner/i);
  });
});

describe("tip standing on the board", () => {
  it("describes each fare's place among landed tips", () => {
    expect(tipStanding({ tipPercentile: 25 })).toBe("lower end of landed tips");
    expect(tipStanding({ tipPercentile: 50 })).toBe("the typical landed tip");
    expect(tipStanding({ tipPercentile: 75 })).toBe("top quarter of landed tips");
    expect(tipStanding({ tipPercentile: 90 })).toBe("top tenth of landed tips");
    expect(tipStanding({ tipPercentile: 90, ceilingLimited: true })).toBe("held at the tip ceiling");
    expect(tipStanding({})).toBeNull();
  });
});
