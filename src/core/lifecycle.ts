import { classify } from "./classifier.js";
import type { BundleStatus } from "../shared/ports.js";
import type { Commitment, FailureClass, Lifecycle, Slot, Stage } from "../shared/types.js";

// When a wall-clock TTL fires but bundleStatus says the bundle landed, wait
// this much longer for the stream to confirm before giving up.
const STATUS_EXTEND_MS = 30_000;
// How many trailing confirmed slots to remember for leader-skip detection.
const CONFIRMED_KEEP = 512;

export interface SlotWindow {
  start: Slot;
  end: Slot;
}

interface Entry {
  l: Lifecycle;
  slot: Slot | null;
  expiresAt: number | null;
  targetWindow: SlotWindow | null;
  ttlExtended: boolean;
  statusRequested: boolean;
  statusInFlight: boolean;
}

export class LifecycleTracker {
  private readonly entries = new Map<string, Entry>();
  private readonly confirmedSlots = new Set<Slot>();
  private latestSlot: Slot = 0;
  private height = 0;

  constructor(
    private readonly onSettled: (l: Lifecycle) => void,
    private readonly onTransition?: (l: Lifecycle, stage: Stage) => void,
    private readonly bundleStatus?: (id: string) => Promise<BundleStatus>,
  ) {}

  active(): number {
    return this.entries.size;
  }

  track(l: Lifecycle, ttlMs: number, targetWindow: SlotWindow | null = null): void {
    const e: Entry = {
      l,
      slot: null,
      expiresAt: Date.now() + ttlMs,
      targetWindow,
      ttlExtended: false,
      statusRequested: false,
      statusInFlight: false,
    };
    this.entries.set(l.signature, e);
    this.mark(e, "submitted", null);
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
        lastValidBlockHeight: null,
        landedSlot: null,
        blockhashSource: null,
        landedPerBundleStatus: null,
        targetLeaderSkipped: false,
      };
      e = {
        l,
        slot,
        expiresAt: null,
        targetWindow: null,
        ttlExtended: false,
        statusRequested: false,
        statusInFlight: false,
      };
      this.entries.set(signature, e);
    }
    e.slot = slot;
    e.l.landedSlot = slot;
    this.mark(e, "processed", slot);
    if (err) this.settle(e, classify(err, {}));
  }

  onSlot(slot: Slot, commitment: Commitment): void {
    if (slot > this.latestSlot) this.latestSlot = slot;
    if (commitment === "confirmed" || commitment === "finalized") {
      this.confirmedSlots.add(slot);
      this.pruneConfirmed();
    }
    for (const e of this.entries.values()) {
      if (e.slot !== slot) continue;
      if (commitment === "confirmed") this.mark(e, "confirmed", slot);
      if (commitment === "finalized") {
        this.mark(e, "confirmed", slot);
        this.mark(e, "finalized", slot);
        this.settle(e, null);
      }
    }
    this.sweep();
  }

  // Precise expiry: a blockhash is dead only once the chain's block height
  // passes its lastValidBlockHeight — never on wall clock alone.
  onBlock(currentHeight: number): void {
    if (currentHeight > this.height) this.height = currentHeight;
    for (const e of this.entries.values()) {
      if (
        !e.l.stages.processed &&
        e.l.lastValidBlockHeight !== null &&
        this.height > e.l.lastValidBlockHeight
      ) {
        this.settle(e, "expired_blockhash");
      }
    }
  }

  private mark(e: Entry, stage: Stage, slot: Slot | null): void {
    if (e.l.stages[stage]) return;
    e.l.stages[stage] = { slot, at: Date.now() };
    this.onTransition?.(e.l, stage);
  }

  private pruneConfirmed(): void {
    if (this.confirmedSlots.size <= CONFIRMED_KEEP) return;
    const floor = this.latestSlot - CONFIRMED_KEEP;
    for (const s of this.confirmedSlots) if (s < floor) this.confirmedSlots.delete(s);
  }

  // Unknown validity (no lvbh recorded, or no block feed yet) counts as
  // valid: we never classify expired_blockhash without proof.
  private blockhashStillValid(e: Entry): boolean {
    if (e.l.lastValidBlockHeight === null || this.height === 0) return true;
    return this.height <= e.l.lastValidBlockHeight;
  }

  private windowPassed(e: Entry): boolean {
    return e.targetWindow === null || this.latestSlot > e.targetWindow.end;
  }

  // The targeted leader skipped if none of the window's slot numbers were
  // ever confirmed while later slots were — the chain jumped past the window.
  private windowSkipped(e: Entry): boolean {
    if (e.targetWindow === null || !this.windowPassed(e)) return false;
    for (let s = e.targetWindow.start; s <= e.targetWindow.end; s++) {
      if (this.confirmedSlots.has(s)) return false;
    }
    for (const s of this.confirmedSlots) if (s > e.targetWindow.end) return true;
    return false;
  }

  private sweep(): void {
    const now = Date.now();
    for (const e of this.entries.values()) {
      if (e.expiresAt === null || e.l.stages.processed || now <= e.expiresAt) continue;
      if (!this.blockhashStillValid(e)) {
        this.settle(e, "expired_blockhash");
        continue;
      }
      // TTL passed but the blockhash is alive: this is NOT expiry. Ask the
      // block engine once what happened to the bundle.
      if (e.l.bundleId && this.bundleStatus && !e.statusRequested) {
        e.statusRequested = true;
        e.statusInFlight = true;
        void this.checkStatus(e);
        continue;
      }
      if (e.statusInFlight) continue; // the one-shot check will settle it
      this.settleDropped(e);
    }
  }

  private settleDropped(e: Entry): void {
    if (!this.windowPassed(e)) return; // the targeted leader window is still ahead
    if (e.l.landedPerBundleStatus === true) {
      // Status said landed but the stream never confirmed within the extension.
      this.settle(e, "unknown");
      return;
    }
    const skipped = this.windowSkipped(e);
    e.l.targetLeaderSkipped = skipped;
    this.settle(e, classify(null, { timedOut: true, leaderSkipped: skipped }));
  }

  private async checkStatus(e: Entry): Promise<void> {
    let landed = false;
    try {
      const s = await (this.bundleStatus as (id: string) => Promise<BundleStatus>)(e.l.bundleId as string);
      landed = s.landed;
    } catch {
      // engine unreachable: treat as not landed
    }
    e.statusInFlight = false;
    if (!this.entries.has(e.l.signature)) return; // settled meanwhile
    e.l.landedPerBundleStatus = landed;
    if (landed && !e.ttlExtended) {
      e.ttlExtended = true;
      e.expiresAt = Date.now() + STATUS_EXTEND_MS; // keep waiting for the stream
      return;
    }
    this.settleDropped(e);
  }

  private settle(e: Entry, failure: FailureClass | null): void {
    if (!this.entries.delete(e.l.signature)) return;
    e.l.failure = failure;
    this.onSettled(e.l);
  }
}
