export interface FareLike {
  id: string;
  label: string;
  deadlineSlots: number;
  confidence: number;
  tipLamports: number;
  priorityFeeMicroLamports: number;
  probability: number;
  meetsConfidence: boolean;
  ceilingLimited?: boolean;
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
const blocks = (n: number) => `${n} ${n === 1 ? "block" : "blocks"}`;
const sameSettings = (a: FareLike, b: FareLike) => a.tipLamports === b.tipLamports && a.priorityFeeMicroLamports === b.priorityFeeMicroLamports;

// Short, factual notes for the board: why fares share a price, and which
// targets the current estimates do not reach. Never infers anything about the
// market from equal prices.
export interface FareNote {
  kind: "same" | "unmet";
  text: string;
}

export function fareNotes(fares: FareLike[], tipCeilingLamports?: number): FareNote[] {
  if (fares.length < 3) return [];
  const [saver, standard, express] = fares as [FareLike, FareLike, FareLike];
  const same: string[] = [];
  if (sameSettings(saver, standard) && sameSettings(standard, express)) {
    same.push(
      "Same recommended tip for all three fares, with different target times. Our current estimates do not justify a higher tip, and a different label adds no priority when the tip and fee are the same.",
    );
  } else if (sameSettings(saver, standard)) {
    same.push(
      saver.meetsConfidence && standard.meetsConfidence
        ? "Saver and Standard share a tip: the cheapest eligible tip already meets both targets in our current estimates."
        : "Saver and Standard share a tip and fee: our current estimates do not justify a higher tip for Standard.",
    );
  } else if (sameSettings(standard, express)) {
    same.push("Standard and Express share a tip and fee, so choosing Express adds no priority.");
  } else if (sameSettings(saver, express)) {
    same.push("Saver and Express share a tip and fee, so choosing Express adds no priority.");
  }
  const notes: FareNote[] = same.map((text) => ({ kind: "same", text }));
  for (const f of fares) {
    if (f.meetsConfidence) continue;
    let line = `${f.label} target not met: estimated ${pct(f.probability)} within ${blocks(f.deadlineSlots)} (target ${pct(f.confidence)}). No higher eligible tip currently shows a better estimate in our model.`;
    if (f.ceilingLimited) line += ` Tips above the ${tipCeilingLamports ? `${tipCeilingLamports / 1e9} SOL ` : ""}ceiling are not evaluated.`;
    notes.push({ kind: "unmet", text: line });
  }
  return notes;
}
