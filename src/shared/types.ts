export type Slot = number;
export type Lamports = number;

export type Commitment = "processed" | "confirmed" | "finalized";
export type Stage = "submitted" | "processed" | "confirmed" | "finalized";

export type FailureClass =
  | "expired_blockhash"
  | "fee_too_low"
  | "compute_exceeded"
  | "bundle_dropped"
  | "leader_skipped"
  | "unknown";

export type StreamEvent =
  | { kind: "slot"; slot: Slot; parent: Slot | null; commitment: Commitment }
  | { kind: "tx"; signature: string; slot: Slot; err: unknown | null };

export interface StageMark {
  slot: Slot | null;
  at: number;
}

export interface DecisionTrace {
  reasoning: string;
  confidence: number;
}

export interface Lifecycle {
  signature: string;
  bundleId: string | null;
  tip: Lamports;
  payload: string;
  stages: Partial<Record<Stage, StageMark>>;
  failure: FailureClass | null;
  retryOf: string | null;
  trace: DecisionTrace | null;
}

export interface TipFloor {
  p25: Lamports;
  p50: Lamports;
  p75: Lamports;
  p95: Lamports;
  p99: Lamports;
  ema: Lamports;
}
