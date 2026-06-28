import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import type { BundleGateway, DecisionPort, Signer } from "../shared/ports.js";
import type { DecisionTrace, Lamports, Lifecycle } from "../shared/types.js";
import type { Store } from "../db/store.js";
import { BundleBuilder, type TxPayload } from "./builder.js";
import { TipOracle } from "./tip-oracle.js";
import { info, warn } from "../shared/log.js";

const MAX_ATTEMPTS = 3;

export interface SubmitContext {
  track(l: Lifecycle, ttlMs: number): void;
  tip(): { tip: Lamports; trace: DecisionTrace | null };
  slotsToLeader(): number;
}

export interface SubmitOptions {
  fault?: boolean;
  retryOf?: string;
  tip?: Lamports;
  ttlMs?: number;
}

export class Submitter {
  private readonly payloads = new Map<string, TxPayload>();
  private readonly attempts = new Map<string, number>();

  constructor(
    private readonly builder: BundleBuilder,
    private readonly jito: BundleGateway,
    private readonly signer: Signer,
    private readonly agent: DecisionPort,
    private readonly oracle: TipOracle,
    private readonly store: Store,
    private readonly ctx: SubmitContext,
  ) {}

  async submit(payload: TxPayload, opts: SubmitOptions = {}): Promise<string> {
    const { tip, trace } = opts.tip !== undefined ? { tip: opts.tip, trace: null } : this.ctx.tip();
    const stale = opts.fault ? bs58.encode(randomBytes(32)) : undefined;
    const { base64, signature } = await this.builder.buildAndSign(payload, this.signer, tip, stale);

    let bundleId: string | null = null;
    try {
      bundleId = await this.jito.sendBundle([base64]);
    } catch (e) {
      warn("jito", "sendBundle rejected", String(e));
    }

    const attempt = (opts.retryOf ? this.attempts.get(opts.retryOf) ?? 1 : 0) + 1;
    this.attempts.set(signature, attempt);
    this.payloads.set(signature, payload);

    const l: Lifecycle = {
      signature,
      source: "submitted",
      bundleId,
      tip,
      payload: payload.kind,
      stages: {},
      failure: null,
      retryOf: opts.retryOf ?? null,
      trace,
    };
    this.ctx.track(l, opts.ttlMs ?? 60_000);
    info("submit", "submitted", { signature, tip, bundleId, attempt, fault: Boolean(opts.fault) });
    return signature;
  }

  async onFailure(l: Lifecycle): Promise<void> {
    const payload = this.payloads.get(l.signature);
    this.payloads.delete(l.signature);
    if (!payload || !l.failure) return;

    const attempt = this.attempts.get(l.signature) ?? 1;
    if (attempt >= MAX_ATTEMPTS) {
      warn("submit", "giving up", { signature: l.signature, attempts: attempt });
      return;
    }

    const decision = await this.agent.recover({
      failure: l.failure,
      lastTip: l.tip,
      floor: this.oracle.floor(),
      slotsToLeader: this.ctx.slotsToLeader(),
      attempt,
    });
    await this.store.saveDecision(
      "recovery",
      { signature: l.signature, failure: l.failure },
      decision,
      decision.trace,
    );
    info("agent", "recovery", {
      signature: l.signature,
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
