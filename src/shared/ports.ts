import type {
  Commitment,
  DecisionTrace,
  FailureClass,
  Lamports,
  Slot,
  StreamEvent,
  TaggedStreamEvent,
  TipFloor,
} from "./types.js";

export interface StreamSource {
  events(): AsyncIterable<StreamEvent>;
  close(): Promise<void>;
}

// One leg of a racing stream: a tagged raw feed plus the hooks MultiStream
// needs to police it (staleness watchdog, telemetry).
export interface RawStreamProvider {
  readonly name: string;
  readonly connected: boolean;
  readonly reconnects: number;
  raw(): AsyncIterable<TaggedStreamEvent>;
  forceReconnect(): void;
  close(): Promise<void>;
}

export interface BundleStatus {
  landed: boolean;
  slot: Slot | null;
  err: unknown | null;
}

export interface BundleGateway {
  tipAccounts(): Promise<string[]>;
  nextLeader(): Promise<{ currentSlot: Slot; nextLeaderSlot: Slot }>;
  sendBundle(base64Txs: string[]): Promise<string>;
  bundleStatus(id: string): Promise<BundleStatus>;
}

export interface RpcGateway {
  latestBlockhash(
    commitment: Commitment,
  ): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  blockHeight(): Promise<number>;
}

export interface LlmClient {
  complete(model: string, system: string, user: string): Promise<string>;
}

// Wallet-phase seam: signing happens client-side, never on the server.
export interface Signer {
  readonly publicKey: string;
  sign(message: Uint8Array): Promise<Uint8Array>;
}

export interface TipForecastView {
  p50AtLanding: Lamports;
  trendPctPer10Slots: number;
  volatility: number;
}

export interface TipContext {
  floor: TipFloor;
  landRate: number;
  inFlight: number;
  slotsToLeader: number;
  forecast: TipForecastView;
  windowOpen: boolean;
  floorSource: "local" | "rest";
}

export interface TipPolicy {
  anchor: keyof TipFloor;
  multiplier: number;
  ceiling: Lamports;
  trace: DecisionTrace;
}

export interface RecoveryContext {
  failure: FailureClass;
  lastTip: Lamports;
  floor: TipFloor;
  slotsToLeader: number;
  attempt: number;
  blockhashStillValid: boolean;
  landedPerBundleStatus: boolean;
  targetLeaderSkipped: boolean;
}

export interface RecoveryDecision {
  action: "resubmit" | "hold" | "abort";
  refreshBlockhash: boolean;
  tip: Lamports;
  trace: DecisionTrace;
}

export interface DecisionPort {
  tipPolicy(ctx: TipContext): Promise<TipPolicy>;
  recover(ctx: RecoveryContext): Promise<RecoveryDecision>;
}
