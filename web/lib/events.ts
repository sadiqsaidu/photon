"use client";

import { useEffect, useReducer, useRef } from "react";
import { API, getJson } from "./format";

export type Stage = "submitted" | "processed" | "confirmed" | "finalized";

export interface SlotRow {
  slot: number;
  leader: string | null;
  count: number;
  beamCount: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  max: number;
  heat: number;
  dots: number[];
}

export interface Lag {
  k: number;
  r: number;
  n: number;
  qualifies: boolean;
  computedAt: number;
}

export interface Receipt {
  signature: string;
  kind: "probe" | "sdk";
  sentSlot: number;
  landedSlot: number | null;
  tip: number;
  stages: Partial<Record<Stage, { slot: number; ms: number }>>;
  failure: string | null;
  error: string | null;
  beam: { is_landed: boolean; region: string; landed_via_jito: boolean } | null;
  settled: boolean;
  sentAt?: number;
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

export interface Calibration {
  deadlineSlots: number;
  probes: number;
  calibrated: boolean;
  brier: number | null;
  buckets: { lo: number; hi: number; n: number; predicted: number | null; actual: number | null; model: number }[];
}

export interface Stats {
  slot: number;
  chainTip: number;
  behind: number;
  maxBehind: number;
  streams: StreamHealth[];
  race: { wins: { grpc: number; mirage: number }; matched: number; grpcLeadP50Ms: number | null };
  blur: { counts: Record<string, number>; since: number };
  tips: {
    lastConfirmed: number;
    window: SlotRow[];
    lag: Lag;
    heatMultiplier: number;
    source: string;
    samples: number;
    allSamples: number;
    beamSamples: number;
    floorPercentile: number;
    forecast: { h: number; p50: number; p90: number }[];
  };
  calibration: Calibration;
  probe: { wallet: string | null; budgetLamports: number; spentLamports: number; leftLamports: number; stopped: boolean; stopReason: string | null };
  receipts: Receipt[];
}

export interface Live {
  stats: Stats | null;
  connected: boolean;
  blurPerSec: number | null;
  error: string | null;
}

const WINDOW = 150;
const RECEIPTS = 10;
const POLL_MS = 5_000;

type Action =
  | { type: "stats"; stats: Stats; blurPerSec: number | null }
  | { type: "sse"; event: string; data: unknown }
  | { type: "status"; connected: boolean; error?: string | null };

function reduce(state: Live, a: Action): Live {
  if (a.type === "status") return { ...state, connected: a.connected, error: a.error ?? state.error };
  if (a.type === "stats") {
    // The polled snapshot refreshes everything except the per-slot window,
    // which SSE keeps current between polls.
    const prev = state.stats;
    const window = prev && prev.tips.window.length ? prev.tips.window : a.stats.tips.window;
    return { ...state, error: null, blurPerSec: a.blurPerSec ?? state.blurPerSec, stats: { ...a.stats, tips: { ...a.stats.tips, window } } };
  }
  const s = state.stats;
  if (!s) return state;
  switch (a.event) {
    case "slot": {
      const d = a.data as { slot: number; chainTip: number; behind: number };
      return { ...state, stats: { ...s, slot: d.slot, chainTip: d.chainTip || s.chainTip, behind: d.behind } };
    }
    case "tips": {
      const row = a.data as SlotRow;
      if (s.tips.window.some((r) => r.slot === row.slot)) return state;
      const window = [...s.tips.window, row].sort((x, y) => x.slot - y.slot).slice(-WINDOW);
      return { ...state, stats: { ...s, tips: { ...s.tips, window, lastConfirmed: Math.max(s.tips.lastConfirmed, row.slot) } } };
    }
    case "heat": {
      const heat = new Map(a.data as [number, number][]);
      const window = s.tips.window.map((r) => (heat.has(r.slot) ? { ...r, heat: heat.get(r.slot) as number } : r));
      return { ...state, stats: { ...s, tips: { ...s.tips, window } } };
    }
    case "lag":
      return { ...state, stats: { ...s, tips: { ...s.tips, lag: a.data as Lag } } };
    case "lifecycle": {
      const r = a.data as Receipt;
      const receipts = [r, ...s.receipts.filter((x) => x.signature !== r.signature)].slice(0, RECEIPTS);
      return { ...state, stats: { ...s, receipts } };
    }
    default:
      return state;
  }
}

export function useLive(): Live {
  const [state, dispatch] = useReducer(reduce, { stats: null, connected: false, blurPerSec: null, error: null });
  const lastBlur = useRef<{ at: number; total: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const stats = await getJson<Stats>("/stats");
        const total = Object.values(stats.blur.counts).reduce((a, b) => a + b, 0);
        const prev = lastBlur.current;
        const blurPerSec = prev ? ((total - prev.total) * 1000) / Math.max(1, Date.now() - prev.at) : null;
        lastBlur.current = { at: Date.now(), total };
        if (alive) dispatch({ type: "stats", stats, blurPerSec });
      } catch (e) {
        if (alive) dispatch({ type: "status", connected: false, error: (e as Error).message });
      }
    };
    void poll();
    const timer = setInterval(poll, POLL_MS);

    const es = new EventSource(`${API}/events`);
    es.onopen = () => dispatch({ type: "status", connected: true, error: null });
    es.onerror = () => dispatch({ type: "status", connected: false });
    for (const event of ["slot", "tips", "heat", "lag", "lifecycle"]) {
      es.addEventListener(event, (m) => dispatch({ type: "sse", event, data: JSON.parse((m as MessageEvent).data) }));
    }
    return () => {
      alive = false;
      clearInterval(timer);
      es.close();
    };
  }, []);

  return state;
}

export function useEvent<T>(event: string, onData: (data: T) => void): void {
  const handler = useRef(onData);
  handler.current = onData;
  useEffect(() => {
    const es = new EventSource(`${API}/events`);
    es.addEventListener(event, (m) => handler.current(JSON.parse((m as MessageEvent).data) as T));
    return () => es.close();
  }, [event]);
}
