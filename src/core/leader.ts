import type { BundleGateway } from "../shared/ports.js";
import type { Slot } from "../shared/types.js";

const WINDOW_SLOTS = 4;

export class LeaderWindow {
  private slot: Slot = 0;

  constructor(private readonly jito: BundleGateway) {}

  observe(slot: Slot): void {
    if (slot > this.slot) this.slot = slot;
  }

  async status(): Promise<{ slotsToLeader: number; open: boolean }> {
    const { currentSlot, nextLeaderSlot } = await this.jito.nextLeader();
    const current = Math.max(this.slot, currentSlot);
    const slotsToLeader = nextLeaderSlot - current;
    const open = slotsToLeader <= 0 && current <= nextLeaderSlot + WINDOW_SLOTS - 1;
    return { slotsToLeader, open };
  }
}
