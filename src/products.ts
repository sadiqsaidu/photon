import { blurCounts } from "./blur.js";
import { beamDay } from "./db.js";
import { raceStats } from "./mirage.js";
import { priorityFeeAge } from "./quote.js";
import { solPrice } from "./solami.js";
import type { StreamHealth } from "./stream.js";
import { tipsPerMinute } from "./tips.js";
import { watchedCount } from "./watch.js";

export type ProductStatus = "live" | "reconnecting" | "refused" | "idle";

export interface ProductContext {
  streams(): StreamHealth[];
  degraded(): { feature: string; error: string }[];
  beamTips: string[];
  behind(): number;
  leaderAgeMs(): number | null;
}

const rates = new Map<string, { at: number; value: number; rate: number }>();

// Per-second rate of a growing counter between calls.
function rate(key: string, value: number): number {
  const now = Date.now();
  const prev = rates.get(key);
  if (!prev) {
    rates.set(key, { at: now, value, rate: 0 });
    return 0;
  }
  if (now - prev.at < 1_000) return prev.rate;
  const r = Math.max(0, (value - prev.value) / ((now - prev.at) / 1000));
  rates.set(key, { at: now, value, rate: r });
  return r;
}

function streamStatus(s: StreamHealth | undefined): ProductStatus {
  if (!s) return "idle";
  if (s.blocked) return "refused";
  return s.connected ? "live" : "reconnecting";
}

const fresh = (age: number | null, ms: number) => age !== null && age < ms;
const secs = (ms: number | null) => (ms === null ? "never" : `${Math.round(ms / 1000)} s ago`);

let beam = { sends: 0, landed: 0, at: 0 };

export async function products(ctx: ProductContext) {
  if (Date.now() - beam.at > 30_000) beam = { ...(await beamDay().catch(() => beam)), at: Date.now() };
  const streams = ctx.streams();
  const byName = (name: string) => streams.find((s) => s.name === name);
  const refused = (feature: string) => ctx.degraded().some((d) => d.feature === feature);
  const grpc = byName("grpc");
  const mbps = rate("grpc", grpc?.bytes ?? 0) / 1e6;
  const race = raceStats();
  const blur = streams.filter((s) => s.name.startsWith("blur"));
  const eps = rate("blur", Object.values(blurCounts).reduce((a, b) => a + b, 0));
  const price = solPrice();
  const fee = priorityFeeAge();
  const hooks = byName("webhooks");
  const leader = ctx.leaderAgeMs();
  const share = beam.sends ? Math.round((beam.landed / beam.sends) * 100) : null;
  return [
    {
      id: "grpc",
      name: "Yellowstone gRPC",
      status: streamStatus(grpc),
      job: "Streams every block and every tip that lands in it.",
      metric: `${tipsPerMinute().toLocaleString("en-US")} tips in the last minute at ${mbps.toFixed(2)} MB/s`,
      values: { tipsPerMinute: tipsPerMinute(), mbps: Math.round(mbps * 100) / 100, queue: grpc?.queue?.depth ?? 0, reconnects: grpc?.reconnects ?? 0 },
    },
    {
      id: "mirage",
      name: "Mirage",
      status: streamStatus(byName("mirage")),
      job: "Races a second block feed against gRPC to see which hears of each block first.",
      metric: `gRPC first ${race.wins.grpc.toLocaleString("en-US")}, Mirage first ${race.wins.mirage.toLocaleString("en-US")}${race.grpcLeadP50Ms === null ? "" : `, median lead ${race.grpcLeadP50Ms} ms`}`,
      values: race,
    },
    {
      id: "blur",
      name: "Blur",
      status: blur.some((s) => s.blocked) ? "refused" : blur.length && blur.every((s) => s.connected) ? "live" : blur.length ? "reconnecting" : "idle",
      job: "Streams market activity (big swaps, launches, graduations) to test whether it moves tips.",
      metric: `${eps.toFixed(1)} market events per second`,
      values: { eventsPerSecond: Math.round(eps * 10) / 10 },
    },
    {
      id: "beam",
      name: "Beam",
      status: refused("beam") ? "refused" : ctx.beamTips.length ? "live" : "idle",
      job: "Sends every Tipwise transaction with stake-weighted priority and reports how it landed.",
      metric: `${beam.sends.toLocaleString("en-US")} sends in the last 24 h${share === null ? "" : `, ${share}% landed`}`,
      values: { sends: beam.sends, landed: beam.landed },
    },
    {
      id: "rpc",
      name: "RPC",
      status: fresh(fee, 60_000) ? "live" : "idle",
      job: "Priority fees, the block builder schedule, blockhashes and block lookups for checkups.",
      metric: `Priority fee updated ${secs(fee)}`,
      values: { priorityFeeAgeMs: fee },
    },
    {
      id: "data",
      name: "Data API",
      status: refused("data") ? "refused" : fresh(price.ageMs, 180_000) ? "live" : "idle",
      job: "Wallet history for checkups and the SOL price for every dollar figure.",
      metric: price.usd === null ? "No SOL price yet" : `SOL at $${price.usd.toFixed(2)}, updated ${secs(price.ageMs)}`,
      values: { solPriceUsd: price.usd, ageMs: price.ageMs },
    },
    {
      id: "webhooks",
      name: "Webhooks",
      status: hooks ? streamStatus(hooks) : refused("webhooks") ? "refused" : "idle",
      job: "Streams new transactions of watched wallets onto their receipts.",
      metric: `${watchedCount()} ${watchedCount() === 1 ? "wallet" : "wallets"} watched live`,
      values: { watched: watchedCount() },
    },
    {
      id: "leaders",
      name: "Leader tracking",
      status: fresh(leader, 15_000) ? "live" : leader === null ? "idle" : "reconnecting",
      job: "Reports the chain tip, so we know how far behind the live stream is.",
      metric: `${ctx.behind()} ${ctx.behind() === 1 ? "block" : "blocks"} behind the chain tip`,
      values: { behind: ctx.behind() },
    },
  ];
}
