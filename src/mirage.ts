import { yellowstone } from "./grpc.js";
import { mirageSlotSubscription, SolamiError, wsUrl } from "./solami.js";
import { streamError, supervise, wsSession, type StreamHealth } from "./stream.js";

export type RaceSource = "grpc" | "mirage";

const KEEP_SLOTS = 2_000;
const KEEP_DELTAS = 1_000;

const firstSeen = new Map<number, { source: RaceSource; at: number; settled: boolean }>();
const wins: Record<RaceSource, number> = { grpc: 0, mirage: 0 };
// Positive delta: gRPC saw the slot first by that many ms.
const deltas: number[] = [];

export function raceSlot(source: RaceSource, slot: number): void {
  const now = performance.now();
  const seen = firstSeen.get(slot);
  if (!seen) {
    firstSeen.set(slot, { source, at: now, settled: false });
    if (firstSeen.size > KEEP_SLOTS) firstSeen.delete(firstSeen.keys().next().value as number);
    return;
  }
  if (seen.settled || seen.source === source) return;
  seen.settled = true;
  wins[seen.source]++;
  deltas.push(seen.source === "grpc" ? now - seen.at : seen.at - now);
  if (deltas.length > KEEP_DELTAS) deltas.shift();
}

export function raceStats() {
  const sorted = [...deltas].sort((a, b) => a - b);
  const p50 = sorted.length ? (sorted[Math.floor(sorted.length / 2)] as number) : null;
  return {
    wins: { ...wins },
    matched: deltas.length,
    grpcLeadP50Ms: p50 === null ? null : Math.round(p50 * 10) / 10,
  };
}

export function startMirage(): StreamHealth {
  return supervise("mirage", async (health, signal) => {
    const id = await mirageSlotSubscription().catch((e: Error) => {
      const refused = e instanceof SolamiError && [401, 402, 403].includes(e.status ?? 0);
      throw streamError(e.message, { blocked: refused });
    });
    await wsSession(wsUrl(`/mirage/stream/${id}`), health, signal, (data, binary) => {
      if (!binary) return;
      const u = yellowstone.SubscribeUpdate.decode(new Uint8Array(data));
      if (u.slot && u.slot.status === 0) raceSlot("mirage", Number(u.slot.slot));
    });
  });
}
