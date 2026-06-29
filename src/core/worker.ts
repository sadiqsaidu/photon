import type { BundleGateway, DecisionPort, StreamSource, TipPolicy } from "../shared/ports.js";
import type { DecisionTrace, Lamports, Lifecycle } from "../shared/types.js";
import type { Store } from "../db/store.js";
import type { SubmitContext } from "./submission.js";
import { info, warn } from "../shared/log.js";
import { bus } from "../shared/bus.js";
import { LifecycleTracker } from "./lifecycle.js";
import { LeaderWindow } from "./leader.js";
import { TipOracle } from "./tip-oracle.js";

const JITO_MIN_TIP = 1000;

export class Worker implements SubmitContext {
  private readonly tracker: LifecycleTracker;
  private policy: TipPolicy | null = null;
  private slots = 0;
  onSubmittedFailure?: (l: Lifecycle) => Promise<void>;

  constructor(
    private readonly stream: StreamSource,
    private readonly jito: BundleGateway,
    private readonly oracle: TipOracle,
    private readonly leader: LeaderWindow,
    private readonly agent: DecisionPort,
    private readonly store: Store,
    private readonly tipCeiling: number,
  ) {
    this.tracker = new LifecycleTracker(
      (l) => void this.onSettled(l),
      (l) => this.publishLifecycle(l),
    );
  }

  private publishLifecycle(l: Lifecycle): void {
    bus.publish({
      type: "lifecycle",
      signature: l.signature,
      source: l.source,
      stages: l.stages,
      tip: l.tip,
      failure: l.failure,
      retryOf: l.retryOf,
    });
  }

  track(l: Lifecycle, ttlMs: number): void {
    this.tracker.track(l, ttlMs);
  }

  slotsToLeader(): number {
    return this.slots;
  }

  tip(): { tip: Lamports; trace: DecisionTrace | null } {
    const floor = this.oracle.floor();
    const p = this.policy;
    const base = p ? floor[p.anchor] * p.multiplier : floor.p50;
    const ceiling = Math.min(p?.ceiling ?? this.tipCeiling, this.tipCeiling);
    return { tip: Math.max(JITO_MIN_TIP, Math.min(Math.round(base), ceiling)), trace: p?.trace ?? null };
  }

  start(): void {
    void this.refreshPolicy();
    setInterval(() => void this.refreshPolicy(), 20_000);
    void this.consume();
  }

  private async consume(): Promise<void> {
    for await (const ev of this.stream.events()) {
      if (ev.kind === "slot") {
        this.leader.observe(ev.slot);
        this.tracker.onSlot(ev.slot, ev.commitment);
        bus.publish({ type: "slot", slot: ev.slot, commitment: ev.commitment });
      } else {
        this.tracker.onTx(ev.signature, ev.slot, ev.err);
      }
    }
  }

  private async refreshPolicy(): Promise<void> {
    try {
      const floor = await this.oracle.refresh();
      const { slotsToLeader } = await this.leader.status();
      this.slots = slotsToLeader;
      this.policy = await this.agent.tipPolicy({
        floor,
        landRate: this.oracle.landRate(),
        inFlight: this.tracker.active(),
        slotsToLeader,
      });
      await this.store.saveDecision("tip_policy", { floor, slotsToLeader }, this.policy, this.policy.trace);
      bus.publish({
        type: "tip_policy",
        anchor: this.policy.anchor,
        multiplier: this.policy.multiplier,
        tip: this.tip().tip,
        reasoning: this.policy.trace.reasoning,
        confidence: this.policy.trace.confidence,
      });
      info("agent", "tip policy", {
        anchor: this.policy.anchor,
        multiplier: this.policy.multiplier,
        reasoning: this.policy.trace.reasoning,
      });
    } catch (e) {
      warn("agent", "policy refresh failed", String(e));
    }
  }

  private async onSettled(l: Lifecycle): Promise<void> {
    this.oracle.observe(l.failure === null);
    this.publishLifecycle(l);
    await this.store.saveLifecycle(l);
    // The agent only reasons about our own submitted bundles. Observed
    // third-party failures are classified and recorded, but not sent to the LLM.
    if (l.failure && l.source === "submitted") await this.onSubmittedFailure?.(l);
  }
}
