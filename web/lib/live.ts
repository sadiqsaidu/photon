"use client";

import { useSyncExternalStore } from "react";
import { API_BASE, api } from "./api";
import type { Calibration, Fares, Lag, Mood, Product, Receipt, Stats, StreamHealth, TrackRecord, WindowRow } from "./types";

export type FeedStatus = "connecting" | "live" | "reconnecting";

export interface LiveState {
  status: FeedStatus;
  downSince: number | null;
  ready: boolean;
  slot: number;
  lastSlotAt: number;
  chainTip: number;
  behind: number;
  maxBehind: number;
  fares: Fares | null;
  mood: { mood: Mood; ratio: number } | null;
  solPrice: number | null;
  products: Product[];
  streams: StreamHealth[];
  race: Stats["race"] | null;
  lag: Lag | null;
  calibration: Calibration | null;
  trackRecord: TrackRecord | null;
  testTrips: Stats["testTrips"] | null;
  tipsInfo: Omit<Stats["tips"], "window"> | null;
  receipts: Receipt[];
  windowVersion: number;
}

const WINDOW_SLOTS = 600;
const NOTIFY_MS = 150;

const initial: LiveState = {
  status: "connecting",
  downSince: null,
  ready: false,
  slot: 0,
  lastSlotAt: 0,
  chainTip: 0,
  behind: 0,
  maxBehind: 0,
  fares: null,
  mood: null,
  solPrice: null,
  products: [],
  streams: [],
  race: null,
  lag: null,
  calibration: null,
  trackRecord: null,
  testTrips: null,
  tipsInfo: null,
  receipts: [],
  windowVersion: 0,
};

let state = initial;
const windowRows: WindowRow[] = [];
const listeners = new Set<() => void>();
const eventListeners = new Map<string, Set<(data: unknown) => void>>();
let started = false;
let source: EventSource | null = null;
let backoff = 1_000;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function set(patch: Partial<LiveState>): void {
  state = { ...state, ...patch };
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    for (const fn of listeners) fn();
  }, NOTIFY_MS);
}

function putRow(row: WindowRow): void {
  const last = windowRows.at(-1);
  if (!last || row.slot > last.slot) windowRows.push(row);
  else {
    const i = windowRows.findIndex((r) => r.slot === row.slot);
    if (i >= 0) windowRows[i] = row;
    else {
      windowRows.push(row);
      windowRows.sort((a, b) => a.slot - b.slot);
    }
  }
  while (windowRows.length > WINDOW_SLOTS) windowRows.shift();
}

function upsertReceipt(list: Receipt[], r: Receipt): Receipt[] {
  return [r, ...list.filter((x) => x.signature !== r.signature)].slice(0, 30);
}

async function loadStats(): Promise<void> {
  const s = await api.stats();
  windowRows.length = 0;
  for (const r of s.tips.window) putRow(r);
  const { window: _w, ...tipsInfo } = s.tips;
  set({
    ready: true,
    slot: Math.max(state.slot, s.slot),
    lastSlotAt: performance.now(),
    chainTip: s.chainTip,
    behind: s.behind,
    maxBehind: s.maxBehind,
    fares: { ...s.fares, mood: s.mood },
    mood: s.mood,
    solPrice: s.solPrice.usd,
    products: s.products,
    streams: s.streams,
    race: s.race,
    lag: s.tips.lag,
    calibration: s.calibration,
    trackRecord: s.trackRecord,
    testTrips: s.testTrips,
    tipsInfo,
    receipts: s.receipts,
    windowVersion: state.windowVersion + 1,
  });
}

const handlers: Record<string, (data: never) => void> = {
  slot: (d: { slot: number; chainTip: number; behind: number }) => {
    if (d.slot <= state.slot) return;
    set({ slot: d.slot, chainTip: d.chainTip, behind: d.behind, lastSlotAt: performance.now() });
  },
  tips: (row: WindowRow) => {
    putRow(row);
    set({ windowVersion: state.windowVersion + 1 });
  },
  fares: (f: Fares) => set({ fares: f, mood: f.mood ?? state.mood, solPrice: f.solPriceUsd ?? state.solPrice }),
  products: (p: Product[]) => set({ products: p }),
  lag: (l: Lag) => set({ lag: l }),
  stream: (s: StreamHealth) => set({ streams: state.streams.map((x) => (x.name === s.name ? s : x)) }),
  lifecycle: (r: Receipt) => set({ receipts: upsertReceipt(state.receipts, r) }),
};

function connect(): void {
  source?.close();
  const es = new EventSource(`${API_BASE}/events`);
  source = es;
  es.onopen = () => {
    backoff = 1_000;
    const wasDown = state.status === "reconnecting";
    set({ status: "live", downSince: null });
    if (wasDown) loadStats().catch(() => undefined);
  };
  for (const name of [...Object.keys(handlers), "audit", "probe"]) {
    es.addEventListener(name, (e) => {
      let data: unknown;
      try {
        data = JSON.parse((e as MessageEvent<string>).data);
      } catch {
        return;
      }
      handlers[name]?.(data as never);
      for (const fn of eventListeners.get(name) ?? []) fn(data);
    });
  }
  es.onerror = () => {
    es.close();
    if (source !== es) return;
    source = null;
    set({ status: state.ready ? "reconnecting" : "connecting", downSince: state.downSince ?? Date.now() });
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 15_000);
  };
}

function start(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const first = () =>
    loadStats().catch(() => {
      set({ downSince: state.downSince ?? Date.now() });
      setTimeout(first, Math.min((backoff *= 2), 15_000));
    });
  first();
  connect();
}

export function subscribe(fn: () => void): () => void {
  start();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getState = () => state;
export const getWindow = (): readonly WindowRow[] => windowRows;

export function onEvent(name: string, fn: (data: unknown) => void): () => void {
  start();
  let group = eventListeners.get(name);
  if (!group) eventListeners.set(name, (group = new Set()));
  group.add(fn);
  return () => group.delete(fn);
}

export function useLive<T>(selector: (s: LiveState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(initial));
}
