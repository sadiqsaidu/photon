"use client";

import { createContext, useContext, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { API_BASE } from "./api";
import type { Commitment, FailureClass, PhotonEvent, Stage, StageMark } from "./events";

export interface Lifecycle {
  signature: string;
  source: "observed" | "submitted";
  stages: Partial<Record<Stage, StageMark>>;
  tip: number;
  failure: FailureClass | null;
  retryOf: string | null;
  updated: number;
}

export interface AgentEntry {
  kind: string;
  signature: string;
  action: string;
  reasoning: string;
  confidence: number;
  at: number;
}

export interface TipPolicy {
  anchor: string;
  multiplier: number;
  tip: number;
  reasoning: string;
  confidence: number;
}

export interface NetworkState {
  slot: number;
  leader: string | null;
  leaderIsJito: boolean;
  nextLeader: string | null;
  nextIsJito: boolean;
  epoch: number;
  epochProgress: number;
  tps: number;
  tipFloor: number;
}

interface State {
  slot: number;
  commitment: Commitment;
  network: NetworkState | null;
  lifecycles: Record<string, Lifecycle>;
  order: string[];
  tipPolicy: TipPolicy | null;
  agent: AgentEntry[];
  healthMs: number | null;
  lastEventAt: number;
}

const MAX = 80;

const initial: State = {
  slot: 0,
  commitment: "processed",
  network: null,
  lifecycles: {},
  order: [],
  tipPolicy: null,
  agent: [],
  healthMs: null,
  lastEventAt: 0,
};

function reduceInner(s: State, ev: PhotonEvent): State {
  switch (ev.type) {
    case "slot":
      return { ...s, slot: ev.slot, commitment: ev.commitment };
    case "network":
      return {
        ...s,
        network: {
          slot: ev.slot,
          leader: ev.leader,
          leaderIsJito: ev.leaderIsJito,
          nextLeader: ev.nextLeader,
          nextIsJito: ev.nextIsJito,
          epoch: ev.epoch,
          epochProgress: ev.epochProgress,
          tps: ev.tps,
          tipFloor: ev.tipFloor,
        },
      };
    case "tip_policy":
      return {
        ...s,
        tipPolicy: { anchor: ev.anchor, multiplier: ev.multiplier, tip: ev.tip, reasoning: ev.reasoning, confidence: ev.confidence },
      };
    case "agent":
      return {
        ...s,
        agent: [
          { kind: ev.kind, signature: ev.signature, action: ev.action, reasoning: ev.reasoning, confidence: ev.confidence, at: Date.now() },
          ...s.agent,
        ].slice(0, MAX),
      };
    case "stream":
      return s;
    case "lifecycle": {
      const prev = s.lifecycles[ev.signature];
      const lifecycles = {
        ...s.lifecycles,
        [ev.signature]: {
          signature: ev.signature,
          source: ev.source,
          stages: ev.stages,
          tip: ev.tip,
          failure: ev.failure,
          retryOf: ev.retryOf,
          updated: Date.now(),
        },
      };
      let order = s.order;
      if (!prev) {
        order = [ev.signature, ...s.order];
        if (order.length > MAX) {
          for (const sig of order.slice(MAX)) delete lifecycles[sig];
          order = order.slice(0, MAX);
        }
      }
      let healthMs = s.healthMs;
      const p = ev.stages.processed?.at;
      const c = ev.stages.confirmed?.at;
      if (p && c) {
        const d = c - p;
        healthMs = healthMs === null ? d : Math.round(healthMs * 0.8 + d * 0.2);
      }
      return { ...s, lifecycles, order, healthMs };
    }
    default:
      return s;
  }
}

function reduce(s: State, ev: PhotonEvent): State {
  return { ...reduceInner(s, ev), lastEventAt: Date.now() };
}

interface Ctx {
  state: State;
  subscribe: (fn: (ev: PhotonEvent) => void) => () => void;
}

const StoreContext = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, initial);
  const listeners = useRef(new Set<(ev: PhotonEvent) => void>());

  useEffect(() => {
    const es = new EventSource(`${API_BASE}/events`);
    es.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data) as PhotonEvent;
        dispatch(ev);
        listeners.current.forEach((fn) => fn(ev));
      } catch {
        /* ignore malformed frames */
      }
    };
    return () => es.close();
  }, []);

  const subscribe = useRef((fn: (ev: PhotonEvent) => void) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }).current;

  return <StoreContext.Provider value={{ state, subscribe }}>{children}</StoreContext.Provider>;
}

export function useStore(): Ctx {
  const c = useContext(StoreContext);
  if (!c) throw new Error("useStore must be used within StoreProvider");
  return c;
}

// Live if we received any event in the last 8s (ticks every second).
export function useLive(lastEventAt: number): boolean {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return lastEventAt > 0 && now - lastEventAt < 8000;
}

export function recentLifecycles(s: State): Lifecycle[] {
  return s.order.map((sig) => s.lifecycles[sig]).filter((l): l is Lifecycle => Boolean(l));
}

export function yourBundles(s: State): Lifecycle[] {
  return recentLifecycles(s).filter((l) => l.source === "submitted");
}

export function bundleCounts(s: State): { landed: number; failed: number; inFlight: number } {
  let landed = 0;
  let failed = 0;
  let inFlight = 0;
  for (const l of yourBundles(s)) {
    if (l.failure) failed++;
    else if (l.stages.finalized) landed++;
    else inFlight++;
  }
  return { landed, failed, inFlight };
}
