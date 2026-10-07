import { LEADER_COUNT, LEADER_REFRESH_SLOTS } from "./config.js";
import { leaderStats, saveSkip } from "./db.js";
import { rpc } from "./solami.js";

const KEEP_SLOTS = 5_000;

const schedule = new Map<number, string>();
let refreshedAt = 0;
let lastFinalized = 0;

export function leaderOf(slot: number): string | null {
  return schedule.get(slot) ?? null;
}

export async function refreshLeaders(slot: number): Promise<void> {
  if (slot - refreshedAt < LEADER_REFRESH_SLOTS) return;
  refreshedAt = slot;
  // Fetch past the visible 20 so the slot_stats leader column stays filled
  // between refreshes.
  const leaders = await rpc<string[]>("getSlotLeaders", [slot, LEADER_COUNT + LEADER_REFRESH_SLOTS]);
  leaders.forEach((identity, i) => schedule.set(slot + i, identity));
  for (const s of schedule.keys()) if (s < slot - KEEP_SLOTS) schedule.delete(s);
}

// Finalized slots form one chain, so a gap between consecutive finalized
// slots is a slot whose leader produced nothing that survived.
export function onFinalized(slot: number): void {
  if (lastFinalized && slot > lastFinalized + 1 && slot - lastFinalized < 64) {
    for (let s = lastFinalized + 1; s < slot; s++) {
      const leader = leaderOf(s);
      if (leader) saveSkip(s, leader).catch((e: Error) => console.error(`[db] skip ${s}: ${e.message}`));
    }
  }
  if (slot > lastFinalized) lastFinalized = slot;
}

export async function upcomingLeaders(currentSlot: number) {
  const rows: { identity: string; firstSlot: number; lastSlot: number }[] = [];
  for (let s = currentSlot; s < currentSlot + LEADER_COUNT; s++) {
    const identity = leaderOf(s);
    if (!identity) continue;
    const last = rows.at(-1);
    if (last && last.identity === identity && last.lastSlot === s - 1) last.lastSlot = s;
    else rows.push({ identity, firstSlot: s, lastSlot: s });
  }
  const stats = await leaderStats([...new Set(rows.map((r) => r.identity))]);
  return rows.map((r) => ({ ...r, ...(stats.get(r.identity) ?? { slotsObserved: 0, medianTip: null, probesLanded: 0, skipped: 0 }) }));
}
