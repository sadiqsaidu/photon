import { BEAM_MIN_TIP, LAMPORTS_PER_SOL, SLOT_MS } from "./config.js";
import type { Receipt } from "./lifecycle.js";

export interface Explanation {
  verdict: "landed" | "failed";
  title: string;
  whatHappened: string;
  whatToDo: string;
}

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function landed(r: Receipt, slot: number): Explanation {
  const blocks = Math.max(1, slot - r.sentSlot);
  const ms = r.stages.processed?.ms ?? r.stages.confirmed?.ms ?? blocks * SLOT_MS;
  const title = `Landed in ${plural(blocks, "block")} (${seconds(ms)}).`;
  const stage = r.stages.finalized ? "finalized" : r.stages.confirmed ? "confirmed" : "seen by the network";
  if (r.deadlineSlots === null || r.quotedProbability === null) {
    return { verdict: "landed", title, whatHappened: `It went into block ${slot.toLocaleString("en-US")} and is ${stage}.`, whatToDo: "Nothing to fix. The tip was enough to get in." };
  }
  const pct = Math.round(r.quotedProbability * 100);
  const article = /^(8|11|18)/.test(String(pct)) ? "an" : "a";
  const estimate = `We estimated ${article} ${pct}% chance of landing within ${plural(r.deadlineSlots, "block")}. It took ${blocks}`;
  if (blocks <= r.deadlineSlots) {
    return { verdict: "landed", title, whatHappened: `${estimate}, within the target.`, whatToDo: "Nothing to fix. The tip was enough to get in on time." };
  }
  return {
    verdict: "landed",
    title,
    whatHappened: `${estimate}, past the target. The estimate left room for this on about ${100 - pct}% of trips.`,
    whatToDo: "If the deadline matters, compare the estimated chance of each fare before you send. Fare prices follow where landed tips sit today; a higher tip buys position in crowded blocks but does not guarantee an earlier one.",
  };
}

// Plain English for a receipt, from the facts already on it. Null while the
// transaction is still on its way.
export function explain(r: Receipt): Explanation | null {
  switch (r.failure) {
    case null:
      return r.landedSlot === null ? null : landed(r, r.landedSlot);
    case "send_rejected":
      return {
        verdict: "failed",
        title: "Beam refused it before it reached the network.",
        whatHappened: `Beam answered${r.error ? `: "${r.error}"` : " with an error"}. The transaction never reached a block, so nothing was charged.`,
        whatToDo: `Tip at least the Beam minimum of ${BEAM_MIN_TIP / LAMPORTS_PER_SOL} SOL to a Beam tip address, check every signature is valid, and fetch a fresh blockhash right before sending.`,
      };
    case "failed_onchain":
      return {
        verdict: "failed",
        title: `It made it into block ${(r.landedSlot ?? 0).toLocaleString("en-US")}, but the program returned an error.`,
        whatHappened: `The network ran it and the program failed${r.error ? `: ${r.error}` : ""}. Because it was included in a block, the tip and the fee were still paid.`,
        whatToDo: "Fix the instruction that failed. A bigger tip will not help.",
      };
    case "leader_skipped":
      return {
        verdict: "failed",
        title: "The block builder skipped its turn.",
        whatHappened: "The validator due to build a block right after it was sent skipped its turn, so the transaction was never picked up. Nothing was charged.",
        whatToDo: "This is bad luck, not a pricing problem. Send it again with a fresh blockhash.",
      };
    case "expired_blockhash":
      return {
        verdict: "failed",
        title: "It expired before any block included it.",
        whatHappened: `No block included it before its blockhash expired${r.lastValidBlockHeight ? ` at block height ${r.lastValidBlockHeight.toLocaleString("en-US")}` : ""}. Nothing was charged.`,
        whatToDo: "Fetch a fresh blockhash right before sending. If this keeps happening while the network is busy, tip more or pick a faster fare.",
      };
  }
}
