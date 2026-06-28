import type { BundleGateway, DecisionPort, StreamSource } from "../shared/ports.js";
import type { Lifecycle } from "../shared/types.js";
import type { Store } from "../db/store.js";
import { info, warn } from "../shared/log.js";
import { LifecycleTracker } from "./lifecycle.js";
import { LeaderWindow } from "./leader.js";
import { TipOracle } from "./tip-oracle.js";

export class Worker {
  private readonly tracker: LifecycleTracker;
  private slotsToLeader = 0;

  constructor(
    private readonly stream: StreamSource,
    private readonly jito: BundleGateway,
    private readonly oracle: TipOracle,
    private readonly leader: LeaderWindow,
    private readonly agent: DecisionPort,
    private readonly store: Store,
  ) {
    this.tracker = new LifecycleTracker((l) => void this.onSettled(l));
  }

  async start(): Promise<void> {
    await this.refreshPolicy();
    setInterval(() => void this.refreshPolicy(), 5000);
    for await (const ev of this.stream.events()) {
      if (ev.kind === "slot") {
        this.leader.observe(ev.slot);
        this.tracker.onSlot(ev.slot, ev.commitment);
      } else {
        this.tracker.observe(ev.signature, ev.slot, ev.err);
      }
    }
  }

  private async refreshPolicy(): Promise<void> {
    try {
      const floor = await this.oracle.refresh();
      const { slotsToLeader } = await this.leader.status();
      this.slotsToLeader = slotsToLeader;
      const policy = await this.agent.tipPolicy({
        floor,
        landRate: this.oracle.landRate(),
        inFlight: this.tracker.active(),
        slotsToLeader,
      });
      await this.store.saveDecision("tip_policy", { floor, slotsToLeader }, policy, policy.trace);
      info("agent", "tip policy", {
        anchor: policy.anchor,
        multiplier: policy.multiplier,
        reasoning: policy.trace.reasoning,
      });
    } catch (e) {
      warn("agent", "policy refresh failed", String(e));
    }
  }

  private async onSettled(l: Lifecycle): Promise<void> {
    this.oracle.observe(l.failure === null);
    await this.store.saveLifecycle(l);
    if (l.failure === null) return;
    const decision = await this.agent.recover({
      failure: l.failure,
      lastTip: l.tip,
      floor: this.oracle.floor(),
      slotsToLeader: this.slotsToLeader,
      attempt: 1,
    });
    await this.store.saveDecision("failure_reasoning", { signature: l.signature, failure: l.failure }, decision, decision.trace);
    info("agent", "failure reasoning", {
      signature: l.signature,
      failure: l.failure,
      action: decision.action,
      reasoning: decision.trace.reasoning,
    });
  }
}
