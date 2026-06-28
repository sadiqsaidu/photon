import type { BundleGateway } from "../shared/ports.js";
import type { Slot } from "../shared/types.js";
import { warn } from "../shared/log.js";

const WINDOW_SLOTS = 4;
const REFRESH_MS = 15_000;

export class LeaderWindow {
  private slot: Slot = 0;
  private nextLeaderSlot = 0;
  private lastFetch = 0;

  constructor(private readonly jito: BundleGateway) {}

  observe(slot: Slot): void {
    if (slot > this.slot) this.slot = slot;
  }

  // Best-effort: never throws, so a Jito hiccup can't stall the tip-policy loop.
  async status(): Promise<{ slotsToLeader: number; open: boolean }> {
    await this.refresh();
    if (this.nextLeaderSlot === 0) return { slotsToLeader: -1, open: false };
    const slotsToLeader = this.nextLeaderSlot - this.slot;
    const open = slotsToLeader <= 0 && this.slot <= this.nextLeaderSlot + WINDOW_SLOTS - 1;
    return { slotsToLeader, open };
  }

  private async refresh(): Promise<void> {
    if (Date.now() - this.lastFetch < REFRESH_MS) return;
    this.lastFetch = Date.now();
    try {
      const { currentSlot, nextLeaderSlot } = await this.jito.nextLeader();
      this.nextLeaderSlot = nextLeaderSlot;
      if (currentSlot > this.slot) this.slot = currentSlot;
    } catch (e) {
      warn("leader", "next leader unavailable", String(e));
    }
  }
}
