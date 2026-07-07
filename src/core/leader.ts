import type { Slot } from "../shared/types.js";
import { bus } from "../shared/bus.js";
import { info, warn } from "../shared/log.js";

const SCHEDULE_LIMIT = 5000;
const SCHEDULE_REFETCH_MARGIN = 500;
const KEEP_BEHIND = 100;
// With no Jito window found (validator set still loading), rescan this often.
const RESCAN_EVERY_SLOTS = 25;
const SCHEDULE_RETRY_MS = 30_000;

// The RPC surface the local schedule needs (SolanaRpc satisfies it).
export interface LeaderRpc {
  slotLeaders(start: number, limit: number): Promise<string[]>;
  epochInfo(): Promise<{ epoch: number; slotIndex: number; slotsInEpoch: number; absoluteSlot: number }>;
}

export interface LeaderStatus {
  slotsToLeader: number;
  open: boolean;
  leaderIdentity: string | null;
}

export interface JitoWindow {
  start: Slot;
  end: Slot;
  identity: string;
  slotsAway: number;
}

// Fully local Jito leader windows: getSlotLeaders gives the identity for the
// next ~5000 slots and the Kobe validator set says who runs jito-solana.
// (getNextScheduledLeader is gRPC-searcher-only — the HTTP block engines 404
// it — so nothing here talks to Jito at all.) observe()/status() are
// synchronous: no HTTP on the per-slot hot path.
export class LeaderWindow {
  private slot: Slot = 0;
  private target: JitoWindow | null = null;
  private open = false;
  private readonly leaderBySlot = new Map<Slot, string>();
  private scheduleEnd: Slot = 0;
  private epoch = -1;
  private lastScanSlot = 0;
  private fetchingSchedule = false;
  private timer: NodeJS.Timeout | null = null;
  private openWaiters: (() => void)[] = [];

  constructor(
    private readonly rpc?: LeaderRpc,
    private readonly isJito?: (identity: string) => boolean,
  ) {}

  start(): void {
    void this.refreshSchedule();
    // retry loop until both the schedule and the validator set have landed
    this.timer = setInterval(() => {
      if (this.scheduleEnd === 0) void this.refreshSchedule();
    }, SCHEDULE_RETRY_MS);
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.openWaiters = [];
  }

  currentSlot(): Slot {
    return this.slot;
  }

  // Hot path: called for every streamed slot. Synchronous recompute only.
  observe(slot: Slot): void {
    if (slot <= this.slot) return;
    this.slot = slot;

    if (!this.target || slot > this.target.end) {
      // No target (or it passed): rescan. When the scan keeps coming up empty
      // (validator set not loaded yet) throttle to every 25 slots.
      const throttled = this.target === null && slot - this.lastScanSlot < RESCAN_EVERY_SLOTS;
      if (!throttled) {
        this.lastScanSlot = slot;
        this.target = this.scanFrom(slot)[0] ?? null;
      }
    }

    const open = this.target !== null && slot >= this.target.start && slot <= this.target.end;
    if (open !== this.open) {
      this.open = open;
      const s = this.status();
      bus.publish({
        type: "leader",
        slotsToLeader: s.slotsToLeader,
        windowOpen: s.open,
        leaderIdentity: s.leaderIdentity,
      });
      if (open) {
        const waiters = this.openWaiters;
        this.openWaiters = [];
        for (const w of waiters) w();
      }
    }
    this.prune();
    if (this.rpc && this.scheduleEnd > 0 && slot > this.scheduleEnd - SCHEDULE_REFETCH_MARGIN) {
      void this.refreshSchedule();
    }
  }

  status(): LeaderStatus {
    if (this.target === null) return { slotsToLeader: -1, open: false, leaderIdentity: null };
    return {
      slotsToLeader: this.target.start - this.slot,
      open: this.open,
      leaderIdentity: this.target.identity,
    };
  }

  // The slot range a bundle submitted right now is aiming for.
  window(): { start: Slot; end: Slot } | null {
    if (this.target === null) return null;
    return { start: this.target.start, end: this.target.end };
  }

  // The next `count` Jito leader windows from the local schedule (grouped by
  // consecutive slots of the same identity). Powers the deck's windows table.
  upcomingWindows(count: number): JitoWindow[] {
    return this.scanFrom(this.slot, count);
  }

  // One-shot: fires when the window next flips open (agent "hold" support).
  onceWindowOpen(cb: () => void): void {
    this.openWaiters.push(cb);
  }

  private scanFrom(from: Slot, count = 1): JitoWindow[] {
    const out: JitoWindow[] = [];
    if (!this.isJito || from === 0) return out;
    let s = Math.max(from, 1);
    while (out.length < count && s <= this.scheduleEnd) {
      const id = this.leaderBySlot.get(s);
      if (id && this.isJito(id)) {
        let end = s;
        while (end + 1 <= this.scheduleEnd && this.leaderBySlot.get(end + 1) === id) end++;
        out.push({ start: s, end, identity: id, slotsAway: s - this.slot });
        s = end + 1;
      } else {
        s++;
      }
    }
    return out;
  }

  private prune(): void {
    const floor = this.slot - KEEP_BEHIND;
    for (const s of this.leaderBySlot.keys()) {
      if (s >= floor) break; // insertion order is ascending
      this.leaderBySlot.delete(s);
    }
  }

  private async refreshSchedule(): Promise<void> {
    if (!this.rpc || this.fetchingSchedule) return;
    this.fetchingSchedule = true;
    try {
      const ep = await this.rpc.epochInfo();
      const start = ep.absoluteSlot;
      if (start > this.slot) this.slot = start;
      // getSlotLeaders cannot cross the epoch boundary.
      const limit = Math.max(1, Math.min(SCHEDULE_LIMIT, ep.slotsInEpoch - ep.slotIndex));
      const leaders = await this.rpc.slotLeaders(start, limit);
      leaders.forEach((id, i) => this.leaderBySlot.set(start + i, id));
      this.scheduleEnd = start + leaders.length - 1;
      if (ep.epoch !== this.epoch) {
        this.epoch = ep.epoch;
        info("leader", "slot leader schedule loaded", {
          epoch: ep.epoch,
          from: start,
          slots: leaders.length,
        });
      }
    } catch (e) {
      warn("leader", "slot leader schedule unavailable", String(e));
    } finally {
      this.fetchingSchedule = false;
    }
  }
}
