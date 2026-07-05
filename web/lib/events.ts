// Mirrors the backend PhotonEvent contract (src/shared/bus.ts).

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

export interface StageMark {
  slot: number | null;
  at: number;
}

export interface RaceProvider {
  name: string;
  wins: number;
  losses: number;
  p50DeltaMs: number;
  p99DeltaMs: number;
  reconnects: number;
  connected: boolean;
  lastEventAgoMs: number;
}

export interface Forecast {
  p50AtLanding: number;
  trendPctPer10Slots: number;
  volatility: number;
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
  | {
      type: "tip_policy";
      anchor: string;
      multiplier: number;
      tip: number;
      reasoning: string;
      confidence: number;
      floorSource: "local" | "rest";
      landRate: number;
      slotsToLeader: number;
      windowOpen: boolean;
      forecast: Forecast;
    }
  | { type: "agent"; kind: "recovery" | "failure_reasoning"; signature: string; action: string; reasoning: string; confidence: number }
  | { type: "stream"; connected: boolean; dropped: number; reconnects: number }
  | { type: "stream_race"; providers: RaceProvider[]; dropped: number; droppedDelta: number }
  | { type: "leader"; slotsToLeader: number; windowOpen: boolean; leaderIdentity: string | null }
  | {
      type: "network";
      slot: number;
      leader: string | null;
      leaderIsJito: boolean;
      nextLeader: string | null;
      nextIsJito: boolean;
      epoch: number;
      epochProgress: number;
      tps: number;
      tipFloor: number;
    };

export const STAGES: Stage[] = ["submitted", "processed", "confirmed", "finalized"];

export const FAILURES: FailureClass[] = [
  "expired_blockhash",
  "fee_too_low",
  "compute_exceeded",
  "bundle_dropped",
  "leader_skipped",
  "send_rejected",
];
