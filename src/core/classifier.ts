import type { FailureClass } from "../shared/types.js";

export interface FailureHint {
  timedOut?: boolean;
  leaderSkipped?: boolean;
}

export function classify(err: unknown, hint: FailureHint): FailureClass {
  if (hint.leaderSkipped) return "leader_skipped";
  const s = JSON.stringify(err ?? "");
  if (s.includes("BlockhashNotFound") || s.includes("BlockhashExpired")) return "expired_blockhash";
  if (s.includes("ComputeBudgetExceeded") || s.includes("ExceededMax")) return "compute_exceeded";
  if (s.includes("InsufficientFundsForFee") || s.includes("AccountNotFound")) return "fee_too_low";
  if (hint.timedOut) return "bundle_dropped";
  return "unknown";
}
