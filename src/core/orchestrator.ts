import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import type { Config } from "../config.js";
import type { BundleGateway, DecisionPort, StreamSource, TipPolicy } from "../shared/ports.js";
import type { Lamports, Lifecycle } from "../shared/types.js";
import { info, warn } from "../shared/log.js";
import { LifecycleTracker } from "./lifecycle.js";
import { LeaderWindow } from "./leader.js";
import { TipOracle } from "./tip-oracle.js";
import { BundleBuilder, type TxPayload } from "./builder.js";

const MAX_ATTEMPTS = 3;
const JITO_MIN_TIP = 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Orchestrator {
  private readonly tracker: LifecycleTracker;
  private readonly payloads = new Map<string, TxPayload>();
  private readonly attempts = new Map<string, number>();
  private policy: TipPolicy | null = null;
  private spent = 0;
  private inFlight = 0;

  constructor(
    private readonly cfg: Config,
    private readonly stream: StreamSource,
    private readonly jito: BundleGateway,
    private readonly builder: BundleBuilder,
    private readonly oracle: TipOracle,
    private readonly leader: LeaderWindow,
    private readonly agent: DecisionPort,
  ) {
    this.tracker = new LifecycleTracker((l) => void this.onSettled(l));
  }

  async start(): Promise<void> {
    await this.refreshPolicy();
    setInterval(() => void this.refreshPolicy(), 5000);
    void this.consume();
  }

  private async consume(): Promise<void> {
    for await (const ev of this.stream.events()) {
      if (ev.kind === "slot") {
        this.leader.observe(ev.slot);
        this.tracker.onSlot(ev.slot, ev.commitment);
      } else {
        this.tracker.onTx(ev.signature, ev.slot, ev.err);
      }
    }
  }

  private async refreshPolicy(): Promise<void> {
    try {
      const floor = await this.oracle.refresh();
      const { slotsToLeader } = await this.leader.status();
      this.policy = await this.agent.tipPolicy({
        floor,
        landRate: this.oracle.landRate(),
        inFlight: this.inFlight,
        slotsToLeader,
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

  private tipFromPolicy(): Lamports {
    const floor = this.oracle.floor();
    const p = this.policy;
    const base = p ? floor[p.anchor] * p.multiplier : floor.p50;
    const ceiling = Math.min(p?.ceiling ?? this.cfg.tipCeiling, this.cfg.tipCeiling);
    return Math.max(JITO_MIN_TIP, Math.min(Math.round(base), ceiling));
  }

  private async awaitWindow(maxMs = 2000): Promise<void> {
    const deadline = Date.now() + maxMs;
    for (;;) {
      const { open, slotsToLeader } = await this.leader.status();
      if (open || slotsToLeader <= 1 || Date.now() > deadline) return;
      await sleep(200);
    }
  }

  async submit(
    payload: TxPayload,
    opts: { fault?: boolean; retryOf?: string; tip?: Lamports; ttlMs?: number } = {},
  ): Promise<void> {
    if (this.spent >= this.cfg.budget) {
      warn("orch", "budget exhausted", { spent: this.spent });
      return;
    }
    await this.awaitWindow();
    const tip = opts.tip ?? this.tipFromPolicy();
    const stale = opts.fault ? bs58.encode(randomBytes(32)) : undefined;
    const { base64, signature } = await this.builder.build(payload, tip, stale);

    let bundleId: string | null = null;
    try {
      bundleId = await this.jito.sendBundle([base64]);
    } catch (e) {
      warn("jito", "sendBundle rejected", String(e));
    }

    this.spent += tip;
    this.inFlight++;
    const attempt = (opts.retryOf ? this.attempts.get(opts.retryOf) ?? 1 : 0) + 1;
    this.attempts.set(signature, attempt);
    this.payloads.set(signature, payload);

    const l: Lifecycle = {
      signature,
      bundleId,
      tip,
      payload: payload.kind,
      stages: {},
      failure: null,
      retryOf: opts.retryOf ?? null,
      trace: this.policy?.trace ?? null,
    };
    this.tracker.track(l, opts.ttlMs ?? 60_000);
    info("orch", "submitted", { signature, tip, bundleId, attempt, fault: Boolean(opts.fault) });
  }

  private async onSettled(l: Lifecycle): Promise<void> {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.oracle.observe(l.failure === null);
    const payload = this.payloads.get(l.signature);
    this.payloads.delete(l.signature);
    if (l.failure === null || !payload) return;

    const attempt = this.attempts.get(l.signature) ?? 1;
    if (attempt >= MAX_ATTEMPTS) {
      warn("orch", "giving up", { signature: l.signature, attempts: attempt });
      return;
    }

    const { slotsToLeader } = await this.leader.status();
    const decision = await this.agent.recover({
      failure: l.failure,
      lastTip: l.tip,
      floor: this.oracle.floor(),
      slotsToLeader,
      attempt,
    });
    info("agent", "recovery", {
      failure: l.failure,
      action: decision.action,
      refreshBlockhash: decision.refreshBlockhash,
      tip: decision.tip,
      reasoning: decision.trace.reasoning,
    });
    if (decision.action !== "resubmit") return;
    await this.submit(payload, { retryOf: l.signature, tip: decision.tip });
  }
}
