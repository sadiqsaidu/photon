import { classify } from "./classifier.js";
import { record } from "../shared/log.js";
import type { Commitment, FailureClass, Lifecycle, Slot } from "../shared/types.js";

interface Entry {
  l: Lifecycle;
  expiresAt: number;
  slot: Slot | null;
}

export class LifecycleTracker {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly onSettled: (l: Lifecycle) => void) {}

  track(l: Lifecycle, ttlMs: number): void {
    l.stages.submitted = { slot: null, at: Date.now() };
    this.entries.set(l.signature, { l, expiresAt: Date.now() + ttlMs, slot: null });
  }

  onTx(signature: string, slot: Slot, err: unknown): void {
    const e = this.entries.get(signature);
    if (!e) return;
    e.slot = slot;
    e.l.stages.processed ??= { slot, at: Date.now() };
    if (err) this.settle(e, classify(err, {}));
  }

  onSlot(slot: Slot, commitment: Commitment): void {
    for (const e of this.entries.values()) {
      if (e.slot !== slot) continue;
      if (commitment === "confirmed") e.l.stages.confirmed ??= { slot, at: Date.now() };
      if (commitment === "finalized") {
        e.l.stages.confirmed ??= { slot, at: Date.now() };
        e.l.stages.finalized ??= { slot, at: Date.now() };
        this.settle(e, null);
      }
    }
    this.sweep();
  }

  private sweep(): void {
    const now = Date.now();
    for (const e of this.entries.values()) {
      if (!e.l.stages.processed && now > e.expiresAt) this.settle(e, "expired_blockhash");
    }
  }

  private settle(e: Entry, failure: FailureClass | null): void {
    if (!this.entries.delete(e.l.signature)) return;
    e.l.failure = failure;
    record(e.l);
    this.onSettled(e.l);
  }
}
