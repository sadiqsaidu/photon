import { HEAT_WEIGHTS } from "./config.js";
import { wsUrl } from "./solami.js";
import { supervise, wsSession, type StreamHealth } from "./stream.js";

const TYPES = Object.keys(HEAT_WEIGHTS);

export const blurCounts: Record<string, number> = Object.fromEntries(TYPES.map((t) => [t, 0]));

// Blur's swap firehose is ~0.7 MB/s; heat counts swaps of $100 or more
// (~0.1 MB/s). A filter that applies to one event type drops the others, so
// launch-type events stream on a second, unfiltered connection.
const SWAP_MIN_VOLUME_USD = "100";

// Swaps, launches and pools carry their own slot; surges do not, so they are
// pinned to the latest processed slot seen on gRPC.
export function startBlur(currentSlot: () => number, onHeat: (slot: number, weight: number) => void): StreamHealth[] {
  const onEvent = (data: Buffer) => {
    const ev = JSON.parse(data.toString()) as { type?: string; slot?: number };
    const weight = ev.type ? HEAT_WEIGHTS[ev.type] : undefined;
    if (weight === undefined) return;
    const slot = typeof ev.slot === "number" ? ev.slot : currentSlot();
    if (!slot) return;
    blurCounts[ev.type as string]!++;
    onHeat(slot, weight);
  };
  const swaps = wsUrl("/data/subscribe", { chain: "solana", type: "swap", min_volume_usd: SWAP_MIN_VOLUME_USD, metadata: "false" });
  const events = wsUrl("/data/subscribe", { chain: "solana", type: TYPES.filter((t) => t !== "swap").join(","), metadata: "false" });
  return [
    supervise("blur:swaps", (health, signal) => wsSession(swaps, health, signal, onEvent)),
    supervise("blur:events", (health, signal) => wsSession(events, health, signal, onEvent)),
  ];
}
