// Mirrors the backend PhotonEvent contract (src/shared/bus.ts).

export type Commitment = "processed" | "confirmed" | "finalized";
export type Stage = "submitted" | "processed" | "confirmed" | "finalized";
export type FailureClass =
  | "expired_blockhash"
  | "fee_too_low"
  | "compute_exceeded"
  | "bundle_dropped"
  | "leader_skipped"
  | "unknown";

export interface StageMark {
  slot: number | null;
  at: number;
}

export type PhotonEvent =
  | { type: "slot"; slot: number; commitment: Commitment }
  | {
      type: "lifecycle";
      signature: string;
      source: "observed" | "submitted";
      stages: Partial<Record<Stage, StageMark>>;
      tip: number;
      failure: FailureClass | null;
      retryOf: string | null;
    }
  | { type: "tip_policy"; anchor: string; multiplier: number; tip: number; reasoning: string; confidence: number }
  | { type: "agent"; kind: "recovery" | "failure_reasoning"; signature: string; action: string; reasoning: string; confidence: number }
  | { type: "stream"; connected: boolean; dropped: number; reconnects: number };

export const STAGES: Stage[] = ["submitted", "processed", "confirmed", "finalized"];

export const FAILURES: FailureClass[] = [
  "expired_blockhash",
  "fee_too_low",
  "compute_exceeded",
  "bundle_dropped",
  "leader_skipped",
];
