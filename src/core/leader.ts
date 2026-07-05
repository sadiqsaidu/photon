import type { BundleGateway } from "../shared/ports.js";
import type { Slot } from "../shared/types.js";
import { bus } from "../shared/bus.js";
import { info, warn } from "../shared/log.js";

const WINDOW_SLOTS = 4;
const ANCHOR_MS = 30_000;
const ANCHOR_MIN_GAP_MS = 5_000;
const SCHEDULE_LIMIT = 5000;
const SCHEDULE_REFETCH_MARGIN = 500;
const KEEP_BEHIND = 100;

// The RPC surface the local schedule needs (SolanaRpc satisfies it).
export interface LeaderRpc {
  slot(): Promise<number>;
  slotLeaders(start: number, limit: number): Promise<string[]>;
  epochInfo(): Promise<{ epoch: number; slotIndex: number; slotsInEpoch: number; absoluteSlot: number }>;
}

export interface LeaderStatus {
  slotsToLeader: number;
  open: boolean;
  leaderIdentity: string | null;
}

// Local leader schedule: getSlotLeaders gives identities for the next ~5000
// slots; jito.nextLeader() anchors the next Jito window every 30 s; between
// anchors the schedule is interpolated. observe()/status() are synchronous —
// no HTTP on the per-slot hot path.
export class LeaderWindow {
  private slot: Slot = 0;
  private nextLeaderSlot: Slot = 0;
  private open = false;
  private readonly leaderBySlot = new Map<Slot, string>();
  private scheduleEnd: Slot = 0;
  private epoch = -1;
  private lastAnchorAt = 0;
  private anchorWarned = false;
  private fetchingSchedule = false;
  private timer: NodeJS.Timeout | null = null;
  private openWaiters: (() => void)[] = [];

  constructor(
    private readonly jito: BundleGateway,
    private readonly rpc?: LeaderRpc,
    private readonly isJito?: (identity: string) => boolean,
  ) {}

  start(): void {
    void this.anchor();
    void this.refreshSchedule();
    this.timer = setInterval(() => void this.anchor(), ANCHOR_MS);
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.openWaiters = [];
  }

  // Hot path: called for every streamed slot. Synchronous recompute only.
  observe(slot: Slot): void {
    if (slot <= this.slot) return;
    this.slot = slot;
    if (this.nextLeaderSlot > 0 && slot >= this.nextLeaderSlot + WINDOW_SLOTS) {
      // Current anchor window has passed: interpolate from the local
      // schedule, and (throttled) re-anchor in the background.
      this.interpolateNext();
      if (slot >= this.nextLeaderSlot + WINDOW_SLOTS) void this.anchor();
    }
    const open =
      this.nextLeaderSlot > 0 && slot >= this.nextLeaderSlot && slot < this.nextLeaderSlot + WINDOW_SLOTS;
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
    if (this.nextLeaderSlot === 0) return { slotsToLeader: -1, open: false, leaderIdentity: null };
    return {
      slotsToLeader: this.nextLeaderSlot - this.slot,
      open: this.open,
      leaderIdentity: this.leaderBySlot.get(this.nextLeaderSlot) ?? null,
    };
  }

  // The slot range a bundle submitted right now is aiming for.
  window(): { start: Slot; end: Slot } | null {
    if (this.nextLeaderSlot === 0) return null;
    return { start: this.nextLeaderSlot, end: this.nextLeaderSlot + WINDOW_SLOTS - 1 };
  }

  // One-shot: fires when the window next flips open (agent "hold" support).
  onceWindowOpen(cb: () => void): void {
    this.openWaiters.push(cb);
  }

  private interpolateNext(): void {
    if (!this.isJito) return;
    for (let s = this.slot; s <= this.scheduleEnd; s++) {
      const id = this.leaderBySlot.get(s);
      if (id && this.isJito(id)) {
        this.nextLeaderSlot = s;
        return;
      }
    }
  }

  private prune(): void {
    const floor = this.slot - KEEP_BEHIND;
    for (const s of this.leaderBySlot.keys()) {
      if (s >= floor) break; // insertion order is ascending
      this.leaderBySlot.delete(s);
    }
  }

  // Best-effort: never throws, so a Jito hiccup can't stall anything.
  private async anchor(): Promise<void> {
    if (Date.now() - this.lastAnchorAt < ANCHOR_MIN_GAP_MS) return;
    this.lastAnchorAt = Date.now();
    try {
      const { currentSlot, nextLeaderSlot } = await this.jito.nextLeader();
      if (currentSlot > this.slot) this.slot = currentSlot;
      this.nextLeaderSlot = nextLeaderSlot;
      this.anchorWarned = false;
      const local = this.leaderBySlot.get(nextLeaderSlot);
      if (local && this.isJito && !this.isJito(local)) {
        warn("leader", "jito anchor disagrees with local schedule/validator set", {
          nextLeaderSlot,
          localLeader: local,
        });
      }
    } catch (e) {
      if (!this.anchorWarned) {
        warn("leader", "next leader unavailable (window disabled)", String(e));
        this.anchorWarned = true;
      }
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
