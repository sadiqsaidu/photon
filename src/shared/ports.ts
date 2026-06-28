import type {
  Commitment,
  DecisionTrace,
  FailureClass,
  Lamports,
  Slot,
  StreamEvent,
  TipFloor,
} from "./types.js";

export interface StreamSource {
  events(): AsyncIterable<StreamEvent>;
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

export interface TipContext {
  floor: TipFloor;
  landRate: number;
  inFlight: number;
  slotsToLeader: number;
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
