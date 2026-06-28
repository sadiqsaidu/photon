import { classify } from "./classifier.js";
import type { Commitment, FailureClass, Lifecycle, Slot } from "../shared/types.js";

interface Entry {
  l: Lifecycle;
  slot: Slot;
}

export class LifecycleTracker {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly onSettled: (l: Lifecycle) => void) {}

  active(): number {
    return this.entries.size;
  }

  observe(signature: string, slot: Slot, err: unknown): void {
    let e = this.entries.get(signature);
    if (!e) {
      const l: Lifecycle = {
        signature,
        source: "observed",
        bundleId: null,
        tip: 0,
        payload: "observed",
        stages: { processed: { slot, at: Date.now() } },
        failure: null,
        retryOf: null,
        trace: null,
      };
      e = { l, slot };
      this.entries.set(signature, e);
    }
    e.slot = slot;
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
  }

  private settle(e: Entry, failure: FailureClass | null): void {
    if (!this.entries.delete(e.l.signature)) return;
    e.l.failure = failure;
    this.onSettled(e.l);
  }
}
