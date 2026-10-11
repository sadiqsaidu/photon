export type FareId = "saver" | "standard" | "express";
export type Mood = "quiet" | "busy" | "rush";
export type ProductStatus = "live" | "reconnecting" | "refused" | "idle";
export type FailureClass = "send_rejected" | "failed_onchain" | "leader_skipped" | "expired_blockhash";
export type Stage = "submitted" | "processed" | "confirmed" | "finalized";

export interface Fare {
  id: FareId;
  label: string;
  deadlineSlots: number;
  deadlineMs: number;
  confidence: number;
  tipLamports: number;
  tipSol: number;
  tipUsd: number | null;
  priorityFeeMicroLamports: number;
  probability: number;
  meetsConfidence: boolean;
}

export interface Fares {
  fares: Fare[];
  calibrated: boolean;
  progress: { done: number; needed: number };
  samples: number;
  solPriceUsd: number | null;
  mood?: { mood: Mood; ratio: number };
  updatedAt?: number;
}

export interface WindowRow {
  slot: number;
  count: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  max: number;
  heat: number;
  dots: number[];
  beam: number[];
}

export interface Product {
  id: string;
  name: string;
  status: ProductStatus;
  job: string;
  metric: string;
  values: Record<string, unknown>;
}

export interface StreamHealth {
  name: string;
  connected: boolean;
  reconnects: number;
  lastEventAt: number;
  bytes: number;
  error: string | null;
  blocked: string | null;
  backpressureClosures: number;
  queue?: { depth: number; maxDepth: number; capacity: number; dropped: number };
}

export interface Lag {
  k: number;
  r: number;
  n: number;
  qualifies: boolean;
  beta: number;
  computedAt: number;
}

export interface Explanation {
  verdict: "landed" | "failed";
  title: string;
  whatHappened: string;
  whatToDo: string;
}

export interface BeamRecord {
  is_landed: boolean;
  landed_via_jito: boolean;
  rebroadcasted: boolean;
  region: string;
  tip_lamports: number;
}

export interface Receipt {
  signature: string;
  kind: "probe" | "sdk" | "demo";
  sentSlot: number;
  lastValidBlockHeight: number | null;
  tip: number;
  stages: Partial<Record<Stage, { slot: number; ms: number }>>;
  landedSlot: number | null;
  failure: FailureClass | null;
  error: string | null;
  beam: BeamRecord | null;
  settled: boolean;
  sentAt: number;
  fare: FareId | null;
  quotedProbability: number | null;
  deadlineSlots: number | null;
  explanation: Explanation | null;
}

export interface TrackRow {
  lo: number;
  hi: number;
  n: number;
  promised: number | null;
  delivered: number | null;
  reachable: boolean;
}

export interface TrackRecord {
  deadlineSlots: number;
  trips: number;
  averageGapPoints: number | null;
  rows: TrackRow[];
}

export interface CalibrationBucket {
  lo: number;
  hi: number;
  n: number;
  predicted: number | null;
  actual: number | null;
  model: number;
  status: string;
}

export interface Calibration {
  deadlineSlots: number;
  probes: number;
  calibrated: boolean;
  brier: number | null;
  buckets: CalibrationBucket[];
}

export interface Stats {
  slot: number;
  chainTip: number;
  behind: number;
  maxBehind: number;
  degraded: { feature: string; error: string }[];
  streams: StreamHealth[];
  race: { wins: { grpc: number; mirage: number }; matched: number; grpcLeadP50Ms: number | null };
  blur: { counts: Record<string, number>; since: number };
  tips: {
    lastConfirmed: number;
    window: WindowRow[];
    lag: Lag;
    heatMultiplier: number;
    source: string;
    samples: number;
    allSamples: number;
    beamSamples: number;
    floorPercentile: number;
    forecast: { h: number; p50: number; p90: number }[];
  };
  mood: { mood: Mood; ratio: number };
  fares: Fares;
  solPrice: { usd: number | null; ageMs: number | null };
  products: Product[];
  calibration: Calibration;
  trackRecord: TrackRecord;
  testTrips: { trips: number; landed: number; running: boolean };
  receipts: Receipt[];
}

export interface AuditTx {
  signature: string;
  slot: number;
  blockTime: number | null;
  success: boolean;
  tip: number;
  priorityFee: number;
  slotP25: number | null;
  slotP50: number | null;
  overpay: number;
  underpaid: boolean;
}

export interface AuditSummary {
  periodFrom: number | null;
  periodTo: number | null;
  totalTipsUsd: number | null;
  goingRateLamports: number;
  monthlyOverpayLamports: number | null;
  monthlyOverpayUsd: number | null;
  stamp: "overpaid" | "fair" | "too_low";
  analyzed: number;
  tipped: number;
  benchmarked: number;
  totalTipsLamports: number;
  overpayLamports: number;
  overpaySol: number;
  overpayUsd: number | null;
  underpaidCount: number;
}

export interface Audit {
  address: string;
  limit: number;
  solPriceUsd: number | null;
  watching: boolean;
  updatedAt: number;
  summary: AuditSummary;
  txs: AuditTx[];
}

export interface Leader {
  identity: string;
  firstSlot: number;
  lastSlot: number;
  slotsObserved: number;
  medianTip: number | null;
  probesLanded: number;
  skipped: number;
}
