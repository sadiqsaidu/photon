import { EventEmitter } from "node:events";
import type { Commitment, FailureClass, Stage, StageMark } from "./types.js";

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
  | { type: "stream"; connected: boolean; dropped: number; reconnects: number }
  | {
      type: "stream_race";
      providers: {
        name: string;
        wins: number;
        losses: number;
        p50DeltaMs: number;
        p99DeltaMs: number;
        reconnects: number;
        connected: boolean;
        lastEventAgoMs: number;
      }[];
      dropped: number;
      droppedDelta: number;
    }
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

class Bus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(ev: PhotonEvent): void {
    this.emitter.emit("ev", ev);
  }

  subscribe(fn: (ev: PhotonEvent) => void): () => void {
    this.emitter.on("ev", fn);
    return () => this.emitter.off("ev", fn);
  }
}

export const bus = new Bus();
