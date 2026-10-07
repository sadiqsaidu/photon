import { HEAT_WEIGHTS } from "./config.js";
import { wsUrl } from "./solami.js";
import { supervise, wsSession, type StreamHealth } from "./stream.js";

const TYPES = Object.keys(HEAT_WEIGHTS);

export const blurCounts: Record<string, number> = Object.fromEntries(TYPES.map((t) => [t, 0]));

// Swaps, launches and pools carry their own slot; surges do not, so they are
// pinned to the latest processed slot seen on gRPC.
export function startBlur(currentSlot: () => number, onHeat: (slot: number, weight: number) => void): StreamHealth {
  const url = wsUrl("/data/subscribe", { chain: "solana", type: TYPES.join(","), metadata: "false" });
  return supervise("blur", (health, signal) =>
    wsSession(url, health, signal, (data) => {
      const ev = JSON.parse(data.toString()) as { type?: string; slot?: number };
      const weight = ev.type ? HEAT_WEIGHTS[ev.type] : undefined;
      if (weight === undefined) return;
      const slot = typeof ev.slot === "number" ? ev.slot : currentSlot();
      if (!slot) return;
      blurCounts[ev.type as string]!++;
      onHeat(slot, weight);
    }),
  );
}
