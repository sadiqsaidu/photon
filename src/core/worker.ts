import type { BundleGateway, DecisionPort, StreamSource, TipPolicy } from "../shared/ports.js";
import type { DecisionTrace, Lamports, Lifecycle } from "../shared/types.js";
import type { Store } from "../db/store.js";
import type { SubmitContext } from "./submission.js";
import { info, warn } from "../shared/log.js";
import { bus } from "../shared/bus.js";
import { LifecycleTracker } from "./lifecycle.js";
import { LeaderWindow } from "./leader.js";
import { TipOracle } from "./tip-oracle.js";
import { BlockhashCache } from "./blockhash.js";
import { TipStream } from "./tip-stream.js";
import { TipForecaster } from "./tip-forecast.js";

const JITO_MIN_TIP = 1000;

export class Worker implements SubmitContext {
  private readonly tracker: LifecycleTracker;
  private policy: TipPolicy | null = null;
  private policyTimer: NodeJS.Timeout | null = null;
  onSubmittedFailure?: (l: Lifecycle) => Promise<void>;

  constructor(
    private readonly stream: StreamSource,
    private readonly jito: BundleGateway,
    private readonly oracle: TipOracle,
    private readonly leader: LeaderWindow,
    private readonly agent: DecisionPort,
    private readonly store: Store,
    private readonly tipCeiling: number,
    private readonly blockhash: BlockhashCache,
    private readonly tipStream?: TipStream,
    private readonly forecaster?: TipForecaster,
  ) {
    this.tracker = new LifecycleTracker(
      (l) => void this.onSettled(l),
      (l) => this.publishLifecycle(l),
      (id) => this.jito.bundleStatus(id),
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
    // Record the leader window this submission is aiming for, so the tracker
    // can tell "leader skipped" apart from "bundle dropped".
    this.tracker.track(l, ttlMs, this.leader.window());
  }

  // Send-side rejections settle without ever being tracked.
  settleNow(l: Lifecycle): void {
    void this.onSettled(l);
  }

  slotsToLeader(): number {
    return this.leader.status().slotsToLeader;
  }

  tip(): { tip: Lamports; trace: DecisionTrace | null } {
    const floor = this.oracle.floor();
    const p = this.policy;
    const base = p ? floor[p.anchor] * p.multiplier : floor.p50;
    const ceiling = Math.min(p?.ceiling ?? this.tipCeiling, this.tipCeiling);
    return { tip: Math.max(JITO_MIN_TIP, Math.min(Math.round(base), ceiling)), trace: p?.trace ?? null };
  }

  start(): void {
    this.leader.start();
    void this.refreshPolicy();
    this.policyTimer = setInterval(() => void this.refreshPolicy(), 20_000);
    void this.consume();
  }

  close(): void {
    if (this.policyTimer) clearInterval(this.policyTimer);
    this.policyTimer = null;
    this.leader.close();
  }

  private async consume(): Promise<void> {
    for await (const ev of this.stream.events()) {
      switch (ev.kind) {
        case "slot":
          this.leader.observe(ev.slot);
          this.tracker.onSlot(ev.slot, ev.commitment);
          bus.publish({ type: "slot", slot: ev.slot, commitment: ev.commitment });
          break;
        case "tx":
          this.tracker.onTx(ev.signature, ev.slot, ev.err);
          break;
        case "block":
          this.blockhash.onBlock(ev);
          this.tracker.onBlock(this.blockhash.currentHeight());
          break;
        case "tip":
          this.tipStream?.observe(ev.slot, ev.lamports);
          break;
      }
    }
  }

  private async refreshPolicy(): Promise<void> {
    try {
      const floor = await this.oracle.refresh();
      const { slotsToLeader, open } = this.leader.status();
      // Forecast at the expected landing slot; when the window is unknown
      // (slotsToLeader < 0) assume a nominal 8 slots out.
      const ahead = slotsToLeader >= 0 ? slotsToLeader : 8;
      const f = this.forecaster?.forecast(ahead) ?? { p50: floor.p50, trendPctPer10Slots: 0, volatility: 0 };
      const forecast = {
        p50AtLanding: f.p50 > 0 ? f.p50 : floor.p50,
        trendPctPer10Slots: f.trendPctPer10Slots,
        volatility: f.volatility,
      };
      this.policy = await this.agent.tipPolicy({
        floor,
        landRate: this.oracle.landRate(),
        inFlight: this.tracker.active(),
        slotsToLeader,
        forecast,
        windowOpen: open,
        floorSource: floor.source,
      });
      await this.store.saveDecision(
        "tip_policy",
        { floor, slotsToLeader, forecast, windowOpen: open, floorSource: floor.source },
        this.policy,
        this.policy.trace,
      );
      bus.publish({
        type: "tip_policy",
        anchor: this.policy.anchor,
        multiplier: this.policy.multiplier,
        tip: this.tip().tip,
        reasoning: this.policy.trace.reasoning,
        confidence: this.policy.trace.confidence,
        floorSource: floor.source,
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
    try {
      this.oracle.observe(l.failure === null);
      this.publishLifecycle(l);
      await this.store.saveLifecycle(l, this.stream.raceSnapshot?.());
      // The agent only reasons about our own submitted bundles. Observed
      // third-party failures are classified and recorded, but not sent to the LLM.
      if (l.failure && l.source === "submitted") await this.onSubmittedFailure?.(l);
    } catch (e) {
      // Fired via `void`; never let a store/agent hiccup become an unhandled rejection.
      warn("worker", "settle handling failed", { signature: l.signature, error: String(e) });
    }
  }
}
