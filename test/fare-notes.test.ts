import { describe, expect, it } from "vitest";
import { fareNotes as notesOf, type FareLike } from "../web/lib/fareNotes.js";

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

describe("fare notes", () => {
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
