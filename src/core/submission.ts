import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import type { BundleGateway, DecisionPort, Signer } from "../shared/ports.js";
import type { BlockhashSource, DecisionTrace, Lamports, Lifecycle } from "../shared/types.js";
import type { Store } from "../db/store.js";
import { BundleBuilder, type BlockhashOverride, type TxPayload } from "./builder.js";
import { classify } from "./classifier.js";
import { TipOracle } from "./tip-oracle.js";
import { info, warn } from "../shared/log.js";
import { bus } from "../shared/bus.js";

const MAX_ATTEMPTS = 3;
// A held retry re-evaluates when the leader window opens, or after this long.
const HOLD_MAX_MS = 30_000;
const MAX_HOLDS = 2;

export interface SubmitContext {
  track(l: Lifecycle, ttlMs: number): void;
  // Settle a lifecycle immediately without tracking (send-side rejection is a
  // failure, not a zombie waiting out a TTL).
  settleNow(l: Lifecycle): void;
  tip(): { tip: Lamports; trace: DecisionTrace | null };
  slotsToLeader(): number;
}

export interface SubmitOptions {
  fault?: boolean;
  retryOf?: string;
  tip?: Lamports;
  ttlMs?: number;
  // Sign against this still-valid blockhash instead of fetching a new one
  // (agent said refreshBlockhash: false and the cache confirmed validity).
  reuseBlockhash?: string;
}

// Narrow seams so tests don't need the real cache / leader window.
export interface BlockhashValidity {
  isValid(lastValidBlockHeight: number): boolean;
}

export interface HoldScheduler {
  onceWindowOpen(cb: () => void): void;
}

export class Submitter {
  private readonly payloads = new Map<string, TxPayload>();
  private readonly attempts = new Map<string, number>();
  private readonly blockhashes = new Map<string, { blockhash: string; lastValidBlockHeight: number | null; source: BlockhashSource }>();
  private readonly holds = new Map<string, number>();

  constructor(
    private readonly builder: BundleBuilder,
    private readonly jito: BundleGateway,
    private readonly signer: Signer | undefined,
    private readonly agent: DecisionPort,
    private readonly oracle: TipOracle,
    private readonly store: Store,
    private readonly ctx: SubmitContext,
    private readonly blockhash?: BlockhashValidity,
    private readonly leader?: HoldScheduler,
  ) {}

  async submit(payload: TxPayload, opts: SubmitOptions = {}): Promise<string> {
    const signer = this.signer;
    if (!signer) throw new Error("no server signer; submit requires a Signer");
    const { tip, trace } = opts.tip !== undefined ? { tip: opts.tip, trace: null } : this.ctx.tip();
    // Fault demo: a fabricated hash is expired by definition (lvbh 0), so the
    // tracker classifies it as a true expiry as soon as a block streams in.
    const override: BlockhashOverride | undefined = opts.fault
      ? { blockhash: bs58.encode(randomBytes(32)), lastValidBlockHeight: 0, source: "injected" as const }
      : opts.reuseBlockhash
        ? this.reuseOverride(opts.reuseBlockhash, opts.retryOf)
        : undefined;
    const built = await this.builder.buildAndSign(payload, signer, tip, override);
    const { base64, signature } = built;

    const attempt = (opts.retryOf ? this.attempts.get(opts.retryOf) ?? 1 : 0) + 1;
    this.attempts.set(signature, attempt);
    this.payloads.set(signature, payload);
    this.blockhashes.set(signature, {
      blockhash: built.blockhash,
      lastValidBlockHeight: built.lastValidBlockHeight,
      source: built.blockhashSource,
    });

    let bundleId: string | null = null;
    let sendError: unknown = null;
    try {
      bundleId = await this.jito.sendBundle([base64]);
    } catch (e) {
      sendError = e;
      warn("jito", "sendBundle rejected by all engines", String(e));
    }

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
      lastValidBlockHeight: built.lastValidBlockHeight,
      landedSlot: null,
      blockhashSource: built.blockhashSource,
      landedPerBundleStatus: null,
      targetLeaderSkipped: false,
    };

    if (sendError !== null) {
      // Every engine rejected: settle right now and let the agent decide the
      // retry — no 60 s zombie lifecycle.
      l.stages.submitted = { slot: null, at: Date.now() };
      l.failure = classify(sendError, { sendRejected: true });
      this.ctx.settleNow(l);
      return signature;
    }

    this.ctx.track(l, opts.ttlMs ?? 60_000);
    info("submit", "submitted", {
      signature,
      tip,
      bundleId,
      attempt,
      blockhashSource: built.blockhashSource,
      lastValidBlockHeight: built.lastValidBlockHeight,
      fault: Boolean(opts.fault),
    });
    return signature;
  }

  async submitSigned(input: {
    signedTxs: string[];
    signature: string;
    tip: Lamports;
    payloadKind?: string;
  }): Promise<string | null> {
    let bundleId: string | null = null;
    let sendError: unknown = null;
    try {
      bundleId = await this.jito.sendBundle(input.signedTxs);
    } catch (e) {
      sendError = e;
      warn("jito", "sendBundle rejected by all engines", String(e));
    }
    const l: Lifecycle = {
      signature: input.signature,
      source: "submitted",
      bundleId,
      tip: input.tip,
      payload: input.payloadKind ?? "external",
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
    if (sendError !== null) {
      l.stages.submitted = { slot: null, at: Date.now() };
      l.failure = classify(sendError, { sendRejected: true });
      this.ctx.settleNow(l);
      return null;
    }
    this.ctx.track(l, 60_000);
    info("submit", "submitted (external)", { signature: input.signature, bundleId });
    return bundleId;
  }

  async onFailure(l: Lifecycle): Promise<void> {
    const payload = this.payloads.get(l.signature);
    if (!payload || !l.failure) {
      this.cleanup(l.signature);
      return;
    }

    const attempt = this.attempts.get(l.signature) ?? 1;
    if (attempt >= MAX_ATTEMPTS) {
      warn("submit", "giving up", { signature: l.signature, attempts: attempt });
      this.cleanup(l.signature);
      return;
    }

    const blockhashStillValid = this.stillValid(l);
    let decision;
    try {
      decision = await this.agent.recover({
        failure: l.failure,
        lastTip: l.tip,
        floor: this.oracle.floor(),
        slotsToLeader: this.ctx.slotsToLeader(),
        attempt,
        blockhashStillValid,
        landedPerBundleStatus: l.landedPerBundleStatus === true,
        targetLeaderSkipped: l.targetLeaderSkipped,
      });
    } catch (e) {
      warn("agent", "recovery failed", String(e));
      this.cleanup(l.signature);
      return;
    }
    await this.store.saveDecision(
      "recovery",
      { signature: l.signature, failure: l.failure, blockhashStillValid, targetLeaderSkipped: l.targetLeaderSkipped },
      decision,
      decision.trace,
    );
    bus.publish({
      type: "agent",
      kind: "recovery",
      signature: l.signature,
      action: decision.action,
      reasoning: decision.trace.reasoning,
      confidence: decision.trace.confidence,
    });
    info("agent", "recovery", {
      signature: l.signature,
      failure: l.failure,
      action: decision.action,
      refreshBlockhash: decision.refreshBlockhash,
      tip: decision.tip,
      blockhashStillValid,
      reasoning: decision.trace.reasoning,
    });

    if (decision.action === "abort") {
      this.cleanup(l.signature);
      return;
    }
    if (decision.action === "hold") {
      this.hold(l);
      return;
    }

    // Honor refreshBlockhash: false only when the original hash is provably
    // still live; otherwise refresh regardless and note the override.
    let reuseBlockhash: string | undefined;
    if (!decision.refreshBlockhash) {
      const original = this.blockhashes.get(l.signature);
      if (original && blockhashStillValid) {
        reuseBlockhash = original.blockhash;
      } else {
        info("submit", "agent kept blockhash but it is no longer valid; refreshing (override)", {
          signature: l.signature,
        });
      }
    }
    await this.submit(payload, { retryOf: l.signature, tip: decision.tip, reuseBlockhash });
    this.cleanup(l.signature);
  }

  // Real hold: re-evaluate when the leader window opens or after 30 s,
  // whichever comes first; at most 2 holds per signature, then force-abort.
  private hold(l: Lifecycle): void {
    const holds = (this.holds.get(l.signature) ?? 0) + 1;
    this.holds.set(l.signature, holds);
    if (holds > MAX_HOLDS) {
      warn("submit", "hold limit reached, aborting", { signature: l.signature, holds });
      this.cleanup(l.signature);
      return;
    }
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      clearTimeout(timer);
      void this.onFailure(l);
    };
    const timer = setTimeout(fire, HOLD_MAX_MS);
    timer.unref?.();
    this.leader?.onceWindowOpen(fire);
    info("submit", "holding for leader window", { signature: l.signature, holds });
  }

  private stillValid(l: Lifecycle): boolean {
    if (l.lastValidBlockHeight === null || !this.blockhash) return false;
    return this.blockhash.isValid(l.lastValidBlockHeight);
  }

  private reuseOverride(blockhash: string, retryOf: string | undefined): BlockhashOverride {
    const original = retryOf ? this.blockhashes.get(retryOf) : undefined;
    return {
      blockhash,
      lastValidBlockHeight: original?.lastValidBlockHeight ?? null,
      source: original?.source ?? "rpc",
    };
  }

  private cleanup(signature: string): void {
    this.payloads.delete(signature);
    this.blockhashes.delete(signature);
    this.holds.delete(signature);
    this.attempts.delete(signature);
  }
}
