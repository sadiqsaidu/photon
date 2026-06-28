import { classify } from "./classifier.js";
import type { Commitment, FailureClass, Lifecycle, Slot } from "../shared/types.js";

interface Entry {
  l: Lifecycle;
  slot: Slot | null;
  expiresAt: number | null;
}

export class LifecycleTracker {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly onSettled: (l: Lifecycle) => void) {}

  active(): number {
    return this.entries.size;
  }

  track(l: Lifecycle, ttlMs: number): void {
    l.stages.submitted = { slot: null, at: Date.now() };
    this.entries.set(l.signature, { l, slot: null, expiresAt: Date.now() + ttlMs });
  }

  onTx(signature: string, slot: Slot, err: unknown): void {
    let e = this.entries.get(signature);
    if (!e) {
      const l: Lifecycle = {
        signature,
        source: "observed",
        bundleId: null,
        tip: 0,
        payload: "observed",
        stages: {},
        failure: null,
        retryOf: null,
        trace: null,
      };
      e = { l, slot, expiresAt: null };
      this.entries.set(signature, e);
    }
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
      if (e.expiresAt !== null && !e.l.stages.processed && now > e.expiresAt) {
        this.settle(e, "expired_blockhash");
      }
    }
  }

  private settle(e: Entry, failure: FailureClass | null): void {
    if (!this.entries.delete(e.l.signature)) return;
    e.l.failure = failure;
    this.onSettled(e.l);
  }
}
