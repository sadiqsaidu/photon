import {
  BEAM_MIN_SAMPLES,
  BEAM_MIN_TIP,
  bus,
  HEAT_MULT_MAX,
  HEAT_MULT_MIN,
  LAG_MAX_K,
  LAG_WINDOW_SLOTS,
  TIP_WINDOW_SLOTS,
} from "./config.js";
import type { Tip, TipSource } from "./grpc.js";
import { computeLag, holt, percentile, rankOf, type Lag } from "./stats.js";

export interface SlotStats {
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
}

const pending = new Map<number, Map<string, Tip>>();
const heat = new Map<number, number>();
const samples = new Map<number, { lamports: number; source: TipSource }[]>();
const recent: SlotStats[] = [];
const f50 = holt();
const f90 = holt();
let lag: Lag = { k: 0, r: 0, n: 0, qualifies: false, beta: 0, computedAt: 0 };
let lastConfirmed = 0;
let sorted: { all: number[]; beam: number[]; eligible: number[] } = { all: [], beam: [], eligible: [] };
let leaderOf: (slot: number) => string | null = () => null;

export function useLeaders(fn: (slot: number) => string | null): void {
  leaderOf = fn;
}

// Stored rows for the window, so the dashboard has data before (or without)
// a live stream.
export function seedWindow(rows: SlotStats[]): void {
  for (const r of rows) {
    if (recent.some((x) => x.slot === r.slot)) continue;
    recent.push({ ...r, leader: r.leader ?? null });
    heat.set(r.slot, r.heat);
    if (r.slot > lastConfirmed) lastConfirmed = r.slot;
  }
  recent.sort((a, b) => a.slot - b.slot);
}

export function addTip(tip: Tip): void {
  if (tip.slot <= lastConfirmed - TIP_WINDOW_SLOTS) return;
  let slot = pending.get(tip.slot);
  if (!slot) pending.set(tip.slot, (slot = new Map()));
  slot.set(tip.signature, tip);
}

export function addHeat(slot: number, weight: number): void {
  if (lastConfirmed && slot <= lastConfirmed - LAG_WINDOW_SLOTS) return;
  heat.set(slot, (heat.get(slot) ?? 0) + weight);
}

const DOTS_PER_SLOT = 12;

// An even spread of one slot's landed tips, for the dashboard scatter.
function dotsOf(slot: number): number[] {
  const values = (samples.get(slot) ?? []).map((t) => t.lamports).sort((a, b) => a - b);
  if (values.length <= DOTS_PER_SLOT) return values;
  return Array.from({ length: DOTS_PER_SLOT }, (_, i) => values[Math.round((i * (values.length - 1)) / (DOTS_PER_SLOT - 1))] as number);
}

export function recentHeat(n: number): [number, number][] {
  return recent.slice(-n).map((r) => [r.slot, heatAt(r.slot)]);
}

function heatAt(slot: number): number {
  return heat.get(slot) ?? 0;
}

function prune(): void {
  for (const s of pending.keys()) if (s < lastConfirmed - 150) pending.delete(s);
  for (const s of samples.keys()) if (s <= lastConfirmed - TIP_WINDOW_SLOTS) samples.delete(s);
  for (const s of heat.keys()) if (s <= lastConfirmed - LAG_WINDOW_SLOTS - LAG_MAX_K) heat.delete(s);
  while (recent.length && (recent[0] as SlotStats).slot <= lastConfirmed - LAG_WINDOW_SLOTS) recent.shift();
}

export function onConfirmed(slot: number): SlotStats | null {
  const tips = [...(pending.get(slot)?.values() ?? [])];
  pending.delete(slot);
  if (slot > lastConfirmed) lastConfirmed = slot;
  const values = tips.map((t) => t.lamports).sort((a, b) => a - b);
  const stats: SlotStats = {
    slot,
    leader: leaderOf(slot),
    count: values.length,
    beamCount: tips.filter((t) => t.source === "beam").length,
    p25: percentile(values, 25),
    p50: percentile(values, 50),
    p75: percentile(values, 75),
    p90: percentile(values, 90),
    max: values.at(-1) ?? 0,
    heat: heatAt(slot),
  };
  samples.set(slot, tips.map((t) => ({ lamports: t.lamports, source: t.source })));
  // A from_slot replay confirms slots again: replace the row, observe once.
  const existing = recent.findIndex((r) => r.slot === slot);
  if (existing >= 0) recent[existing] = stats;
  else {
    recent.push(stats);
    recent.sort((a, b) => a.slot - b.slot);
    if (stats.count > 0) {
      f50.observe(stats.p50);
      f90.observe(stats.p90);
    }
  }
  prune();
  const all: number[] = [], beam: number[] = [];
  for (const list of samples.values()) for (const t of list) (t.source === "beam" ? beam : all).push(t.lamports);
  const combined = all.concat(beam).sort((a, b) => a - b);
  sorted = { all: combined, beam: beam.sort((a, b) => a - b), eligible: combined.filter((v) => v >= BEAM_MIN_TIP) };
  bus.emit("tips", { ...stats, dots: dotsOf(slot) });
  return stats;
}

// A confirmed slot's row with the heat known now: Blur events can arrive
// after gRPC has confirmed the slot.
export function confirmedRow(slot: number): SlotStats | null {
  const row = recent.find((r) => r.slot === slot);
  return row ? { ...row, heat: heatAt(slot) } : null;
}

export function refreshLag(): Lag {
  lag = computeLag(recent.filter((r) => r.count > 0).map((r) => ({ slot: r.slot, p75: r.p75, heat: heatAt(r.slot) })));
  bus.emit("lag", lag);
  return lag;
}

// Quotes price inside the tips a Beam send could actually pay: landed tips at
// or above the Beam floor, from Beam itself once it has enough samples.
export function distribution(): { source: "beam" | "combined"; sorted: number[] } {
  return sorted.beam.length >= BEAM_MIN_SAMPLES ? { source: "beam", sorted: sorted.beam } : { source: "combined", sorted: sorted.eligible };
}

// Where the Beam floor sits among all landed tips (percentile, 0 to 100).
export function floorPercentile(): number {
  return Math.round(rankOf(sorted.all, BEAM_MIN_TIP) * 10) / 10;
}

export function heatMultiplier(): number {
  if (!lag.qualifies) return 1;
  const hs = recent.map((r) => heatAt(r.slot));
  const mean = hs.reduce((a, b) => a + b, 0) / (hs.length || 1);
  const sd = Math.sqrt(hs.reduce((a, b) => a + (b - mean) ** 2, 0) / (hs.length || 1));
  // Two slots behind the confirmed tip, so late Blur events are already counted.
  const z = sd > 0 ? (heatAt(lastConfirmed - 2) - mean) / sd : 0;
  return Math.min(HEAT_MULT_MAX, Math.max(HEAT_MULT_MIN, 1 + lag.beta * z));
}

// Tip at percentile `pct` of the live distribution, projected h slots ahead by
// the Holt trend of per-slot p50 (below p50) blending into p90 (above p90).
export function forecastAt(pct: number, h: number): number {
  const base = percentile(distribution().sorted, pct);
  const w = Math.min(1, Math.max(0, (pct - 50) / 40));
  const growth = (1 - w) * f50.growth(h) + w * f90.growth(h);
  return Math.round(base * growth * heatMultiplier());
}

// Per-slot series projection, the dashed lines past "now" on the dashboard.
function projected(f: ReturnType<typeof holt>, h: number): number {
  return Math.round((f.level() ?? 0) * f.growth(h) * heatMultiplier());
}

export function tipState() {
  const d = distribution();
  return {
    lastConfirmed,
    window: recent.slice(-150).map((r) => ({ ...r, heat: heatAt(r.slot), dots: dotsOf(r.slot) })),
    lag,
    heatMultiplier: heatMultiplier(),
    source: d.source,
    samples: d.sorted.length,
    allSamples: sorted.all.length,
    beamSamples: sorted.beam.length,
    floorPercentile: floorPercentile(),
    forecast: Array.from({ length: 10 }, (_, i) => ({ h: i + 1, p50: projected(f50, i + 1), p90: projected(f90, i + 1) })),
  };
}
