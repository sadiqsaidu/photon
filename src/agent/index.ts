import type {
  DecisionPort,
  LlmClient,
  RecoveryContext,
  RecoveryDecision,
  TipContext,
  TipPolicy,
} from "../shared/ports.js";
import type { TipFloor } from "../shared/types.js";

const ANCHORS: (keyof TipFloor)[] = ["p25", "p50", "p75", "p95", "p99", "ema"];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(n, hi));
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === "string" ? v : "");

function parse(raw: string): Record<string, unknown> {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) text = text.slice(start, end + 1);
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export class Agent implements DecisionPort {
  constructor(
    private readonly llm: LlmClient,
    private readonly model: string,
    private readonly ceiling: number,
  ) {}

  async tipPolicy(ctx: TipContext): Promise<TipPolicy> {
    const system =
      "You are the tip-intelligence controller for a Solana Jito bundle submitter. " +
      "Balance landing probability against cost using the live tip floor and recent landing rate. " +
      "The bundle lands slots_to_leader slots from now, so reason about the FORECAST tip at expected " +
      "landing time (forecast.p50_at_landing_lamports, trend, volatility) — not just the current floor. " +
      "A rising trend or high volatility argues for anchoring higher now; a falling trend lets you save. " +
      "Respond ONLY with JSON.";
    const user = JSON.stringify({
      schema: "{anchor: p25|p50|p75|p95|p99|ema, multiplier: 0.5-5, ceiling: lamports, reasoning, confidence: 0-1}",
      tip_floor_lamports: ctx.floor,
      tip_floor_source: ctx.floorSource,
      forecast: {
        p50_at_landing_lamports: ctx.forecast.p50AtLanding,
        trend_pct_per_10_slots: ctx.forecast.trendPctPer10Slots,
        volatility: ctx.forecast.volatility,
      },
      recent_land_rate: ctx.landRate,
      in_flight: ctx.inFlight,
      slots_to_leader: ctx.slotsToLeader,
      leader_window_open: ctx.windowOpen,
    });
    const p = parse(await this.llm.complete(this.model, system, user));
    const anchor = (ANCHORS as string[]).includes(String(p.anchor))
      ? (p.anchor as keyof TipFloor)
      : "p50";
    return {
      anchor,
      multiplier: clamp(num(p.multiplier, 1), 0.5, 5),
      ceiling: clamp(num(p.ceiling, this.ceiling), 1000, this.ceiling),
      trace: { reasoning: str(p.reasoning), confidence: clamp(num(p.confidence, 0.5), 0, 1) },
    };
  }

  async recover(ctx: RecoveryContext): Promise<RecoveryDecision> {
    const system =
      "You own retry decisions for failed Solana Jito bundles. Reason about the failure cause " +
      "and decide what to change before resubmitting. Check that the classification is consistent " +
      "with blockhash_still_valid: expired_blockhash with a still-valid hash means the bundle was " +
      "likely dropped, not expired — do not refresh the blockhash, raise the tip instead. " +
      "landed_per_bundle_status=true means the engine saw it land (be careful about double-spend " +
      "risk on resubmit); target_leader_skipped=true means the fault was the leader, not your tip. " +
      "Respond ONLY with JSON.";
    const user = JSON.stringify({
      schema: "{action: resubmit|hold|abort, refreshBlockhash: bool, tip: lamports, reasoning, confidence: 0-1}",
      failure: ctx.failure,
      last_tip_lamports: ctx.lastTip,
      tip_floor_lamports: ctx.floor,
      slots_to_leader: ctx.slotsToLeader,
      attempt: ctx.attempt,
      blockhash_still_valid: ctx.blockhashStillValid,
      landed_per_bundle_status: ctx.landedPerBundleStatus,
      target_leader_skipped: ctx.targetLeaderSkipped,
    });
    const d = parse(await this.llm.complete(this.model, system, user));
    const action = ["resubmit", "hold", "abort"].includes(String(d.action))
      ? (d.action as RecoveryDecision["action"])
      : "resubmit";
    return {
      action,
      refreshBlockhash: d.refreshBlockhash !== false,
      tip: clamp(num(d.tip, ctx.lastTip), 1000, this.ceiling),
      trace: { reasoning: str(d.reasoning), confidence: clamp(num(d.confidence, 0.5), 0, 1) },
    };
  }
}
