export type Slot = number;
export type Lamports = number;

// Yellowstone delivers u64s as strings; convert exactly once at the edge.
export function toSlot(v: string | number | bigint): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error(`u64 out of safe integer range: ${String(v)}`);
  return n;
}

export type Commitment = "processed" | "confirmed" | "finalized";
export type Stage = "submitted" | "processed" | "confirmed" | "finalized";

export type FailureClass =
  | "expired_blockhash"
  | "fee_too_low"
  | "compute_exceeded"
  | "bundle_dropped"
  | "leader_skipped"
  | "send_rejected"
  | "unknown";

export type StreamEvent =
  | { kind: "slot"; slot: Slot; parent: Slot | null; commitment: Commitment }
  | { kind: "tx"; signature: string; slot: Slot; err: unknown | null }
  | { kind: "block"; slot: Slot; blockhash: string; blockHeight: number; parentBlockhash: string }
  // A lamport transfer into a Jito tip account, observed on-stream. The
  // signature is carried for cross-provider dedup.
  | { kind: "tip"; slot: Slot; lamports: Lamports; signature: string };

// A raw per-provider event, tagged so MultiStream can race providers.
export interface TaggedStreamEvent {
  event: StreamEvent;
  provider: string;
  recvAt: number;
}

export interface StageMark {
  slot: Slot | null;
  at: number;
}

export interface DecisionTrace {
  reasoning: string;
  confidence: number;
}

// Where the recent blockhash for a bundle came from. "injected" is the
// fault-demo path (fabricated, already-expired hash).
export type BlockhashSource = "stream" | "rpc" | "injected";

export interface Lifecycle {
  signature: string;
  source: "observed" | "submitted";
  bundleId: string | null;
  tip: Lamports;
  payload: string;
  stages: Partial<Record<Stage, StageMark>>;
  failure: FailureClass | null;
  retryOf: string | null;
  trace: DecisionTrace | null;
  lastValidBlockHeight: number | null;
  landedSlot: Slot | null;
  blockhashSource: BlockhashSource | null;
  // Result of the one-shot bundleStatus check at TTL (null = never checked).
  landedPerBundleStatus: boolean | null;
  targetLeaderSkipped: boolean;
}

export interface TipFloor {
  p25: Lamports;
  p50: Lamports;
  p75: Lamports;
  p95: Lamports;
  p99: Lamports;
  ema: Lamports;
}
