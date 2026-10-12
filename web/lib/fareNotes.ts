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
  tipPercentile?: number;
  probabilityAtCheaperTip?: number | null;
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
const blocks = (n: number) => `${n} ${n === 1 ? "block" : "blocks"}`;
const sameSettings = (a: FareLike, b: FareLike) => a.tipLamports === b.tipLamports && a.priorityFeeMicroLamports === b.priorityFeeMicroLamports;
const listOf = (names: string[]) => (names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

// Where a fare's percentile sits among today's landed tips.
export function tipPosition(percentile: number): string {
  if (percentile >= 90) return "near the top of";
  if (percentile >= 75) return "in the top quarter of";
  if (percentile > 50) return "above most of";
  return "in the middle of";
}

// The board's words for where a fare's tip sits; null on servers that do not
// price from the market.
export function tipStanding(f: Pick<FareLike, "tipPercentile" | "ceilingLimited">): string | null {
  if (f.tipPercentile === undefined) return null;
  if (f.ceilingLimited) return "held at the tip ceiling";
  if (f.tipPercentile >= 90) return "top tenth of landed tips";
  if (f.tipPercentile >= 75) return "top quarter of landed tips";
  if (f.tipPercentile > 50) return "above most landed tips";
  return "the typical landed tip";
}

// Short, factual notes for the board. Prices come from where landed tips sit
// today; chances come from Tipwise's test trips. Never claims a higher tip
// lands faster, and never infers anything about the market from equal prices.
export interface FareNote {
  kind: "same" | "ceiling" | "gain" | "unmet";
  text: string;
}

export function fareNotes(fares: FareLike[], tipCeilingLamports?: number): FareNote[] {
  if (fares.length < 3) return [];
  return fares.some((f) => f.tipPercentile !== undefined) ? marketNotes(fares, tipCeilingLamports) : legacyNotes(fares, tipCeilingLamports);
}

function marketNotes(fares: FareLike[], tipCeilingLamports?: number): FareNote[] {
  const notes: FareNote[] = [];
  const ceiling = `${tipCeilingLamports ? `${tipCeilingLamports / 1e9} SOL ` : ""}tip ceiling`;
  const capped = fares.filter((f) => f.ceilingLimited);
  if (capped.length) {
    const shared = capped.length > 1 && new Set(capped.map((f) => f.tipLamports)).size === 1;
    notes.push({
      kind: "ceiling",
      text: `${listOf(capped.map((f) => f.label))} ${capped.length > 1 ? "are" : "is"} held at the ${ceiling}${shared ? ", so they share a price" : ""}.`,
    });
  }
  const noGain = fares.filter((f, i) => {
    const cheaper = fares[i - 1];
    if (!cheaper || typeof f.probabilityAtCheaperTip !== "number" || f.tipLamports <= cheaper.tipLamports) return false;
    return f.probability <= f.probabilityAtCheaperTip + 1e-9;
  });
  if (noGain.length) {
    const position = tipPosition(Math.min(...noGain.map((f) => f.tipPercentile ?? 100)));
    notes.push({
      kind: "gain",
      text: `${listOf(noGain.map((f) => f.label))} ${noGain.length > 1 ? "pay" : "pays"} ${position} today's tips. That buys position when blocks get crowded; our test trips have not measured a gain yet.`,
    });
  }
  for (const f of fares) {
    if (f.meetsConfidence) continue;
    notes.push({
      kind: "unmet",
      text: `${f.label} target not met: estimated ${pct(f.probability)} within ${blocks(f.deadlineSlots)} (target ${pct(f.confidence)}). The price follows today's tips; the estimate comes from our test trips.`,
    });
  }
  return notes;
}

// Servers before market-percentile pricing quoted the cheapest range meeting
// each target, so fares could share a tip.
function legacyNotes(fares: FareLike[], tipCeilingLamports?: number): FareNote[] {
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
