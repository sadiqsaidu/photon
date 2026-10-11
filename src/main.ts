import { startBlur } from "./blur.js";
import { bus, FARES_EVERY_MS, LAG_INTERVAL_MS, PRODUCTS_EVERY_MS, requireApiKey, SOL_PRICE_EVERY_MS, TIP_WINDOW_SLOTS } from "./config.js";
import { latestReceipts, markLanded, migrateDb, probeRows, prune, saveReceipt, saveSlots, storedSlots, type ProbeFields } from "./db.js";
import { demo } from "./demo.js";
import { doctor } from "./doctor.js";
import { startGrpc } from "./grpc.js";
import { leaderOf, onFinalized, refreshLeaders } from "./leaders.js";
import * as lifecycle from "./lifecycle.js";
import { raceSlot, raceStats, startMirage } from "./mirage.js";
import { budgetState, loadProbes, probeOutcomes, probeSettled, startProbes } from "./probe.js";
import { products } from "./products.js";
import { fares, quote } from "./quote.js";
import { asReceipt, routes } from "./routes.js";
import { startServer } from "./server.js";
import { beamTipAddresses, leaderNow, refreshSolPrice, solPrice } from "./solami.js";
import { addHeat, addTip, confirmedRow, mood, onConfirmed, recentHeat, refreshLag, seedWindow, tipState, useLeaders, type SlotStats } from "./tips.js";
import { resumeWebhook, webhookHealth } from "./watch.js";

const RECENT_RECEIPTS = 20;
const STATUS_EVERY_MS = 60_000;
const PRUNE_EVERY_MS = 3_600_000;

// A Solami refusal (missing permission, plan or balance) degrades one feature;
// the server keeps running and serving stored data instead of crash-looping.
const degraded = new Map<string, string>();
async function optional<T>(feature: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    degraded.set(feature, (e as Error).message);
    console.warn(`[${feature}] unavailable: ${(e as Error).message}`);
    return fallback;
  }
}

async function serve(): Promise<void> {
  requireApiKey();
  await migrateDb();
  seedWindow((await storedSlots(TIP_WINDOW_SLOTS)).reverse());
  const beamTips = await optional("beam", beamTipAddresses, []);
  await loadProbes(await probeRows(), markLanded);
  const startedAt = Date.now();
  let processed = 0;
  let chainTip = 0;
  let behind = 0;
  let maxBehind = 0;
  let leaderAt = 0;
  const finalizedRows: SlotStats[] = [];
  const probeFields = new Map<string, ProbeFields>();
  const recent: lifecycle.Receipt[] = (await latestReceipts(RECENT_RECEIPTS)).map(asReceipt);
  useLeaders(leaderOf);

  const grpc = startGrpc(beamTips, {
    onSlot(slot, status) {
      lifecycle.onSlot(slot, status);
      if (status === "processed") {
        raceSlot("grpc", slot);
        if (slot > processed) {
          processed = slot;
          bus.emit("slot", { slot, chainTip, behind });
          refreshLeaders(slot).catch((e: Error) => console.warn(`[leaders] ${e.message}`));
        }
      }
      if (status === "confirmed") onConfirmed(slot);
      if (status === "finalized") {
        onFinalized(slot);
        const row = confirmedRow(slot);
        if (row) finalizedRows.push(row);
      }
    },
    onBlock: lifecycle.onBlock,
    onTip: addTip,
    onTx: lifecycle.onTx,
  });
  const mirage = startMirage();
  const blur = startBlur(() => processed, addHeat);
  await optional("webhooks", resumeWebhook, undefined);
  const streams = () => [grpc, mirage, ...blur, webhookHealth()].filter((s) => s !== null).map((s) => ({ ...s }));
  const degradedNow = () => [
    ...[...degraded].map(([feature, error]) => ({ feature, error })),
    ...streams()
      .filter((s) => s.blocked)
      .map((s) => ({ feature: s.name, error: s.blocked as string })),
  ];

  bus.on("lifecycle", (r: lifecycle.Receipt) => {
    const i = recent.findIndex((x) => x.signature === r.signature);
    if (i >= 0) recent.splice(i, 1);
    recent.unshift(r);
    recent.length = Math.min(recent.length, RECENT_RECEIPTS);
  });
  lifecycle.onReceiptSettled((r) => {
    if (r.kind === "probe" || r.kind === "demo") probeSettled(r);
    saveReceipt(r, probeFields.get(r.signature)).catch((e: Error) => console.error(`[db] receipt ${r.signature}: ${e.message}`));
    const link = `https://solscan.io/tx/${r.signature}`;
    const landed = r.landedSlot === null ? "not landed" : `landed slot ${r.landedSlot} (+${r.landedSlot - r.sentSlot})`;
    console.log(`[${r.kind}] ${r.failure ?? "finalized"} tip ${r.tip} ${landed} beam ${r.beam ? `${r.beam.region} landed=${r.beam.is_landed}` : "no record"} ${link}`);
  });

  // The chain tip guards slots-to-land against a lagging stream.
  const probeWallet = await optional(
    "probes",
    () =>
      startProbes(
        () => Math.max(processed, chainTip),
        (r, fields) => {
          probeFields.set(r.signature, fields);
          saveReceipt(r, fields).catch((e: Error) => console.error(`[db] receipt ${r.signature}: ${e.message}`));
        },
      ),
    null,
  );
  setInterval(() => prune().catch((e: Error) => console.error(`[db] prune: ${e.message}`)), PRUNE_EVERY_MS).unref();
  setTimeout(() => prune().catch((e: Error) => console.error(`[db] prune: ${e.message}`)), 60_000).unref();

  setInterval(refreshLag, LAG_INTERVAL_MS);
  // Slot rows are written in one batched insert every couple of seconds.
  setInterval(() => {
    const rows = finalizedRows.splice(0);
    saveSlots(rows).catch((e: Error) => console.error(`[db] ${rows.length} slot rows: ${e.message}`));
  }, 2_000);
  // Blur events can land after a slot confirms, so recent heat is re-sent.
  setInterval(() => bus.emit("heat", recentHeat(40)), 2_000);
  setInterval(() => {
    leaderNow().then(
      (l) => {
        chainTip = l.slot;
        leaderAt = Date.now();
        behind = Math.max(0, l.slot - processed);
        if (processed && behind > maxBehind) maxBehind = behind;
      },
      (e: Error) => console.warn(`[leader-tracking] ${e.message}`),
    );
  }, 2_000);
  setInterval(() => {
    if (tipState().samples) quote(2, 0.9, probeOutcomes()).then((q) => bus.emit("quote", q), () => undefined);
  }, 5_000);

  const refreshPrice = () => refreshSolPrice().catch((e: Error) => console.warn(`[data] SOL price: ${e.message}`));
  await refreshPrice();
  setInterval(refreshPrice, SOL_PRICE_EVERY_MS);

  let fareCache: Awaited<ReturnType<typeof fares>> | null = null;
  let fareKey = "";
  const refreshFares = async () => {
    fareCache = await fares(probeOutcomes(), solPrice().usd);
    return fareCache;
  };
  setInterval(() => {
    if (!tipState().samples) return;
    refreshFares().then(
      (f) => {
        const event = { ...f, mood: mood() };
        const key = JSON.stringify(event);
        if (key === fareKey) return;
        fareKey = key;
        bus.emit("fares", { ...event, updatedAt: Date.now() });
      },
      (e: Error) => console.warn(`[fares] ${e.message}`),
    );
  }, FARES_EVERY_MS);

  const productContext = {
    streams,
    degraded: degradedNow,
    beamTips,
    behind: () => behind,
    leaderAgeMs: () => (leaderAt ? Date.now() - leaderAt : null),
  };
  setInterval(() => {
    products(productContext).then((p) => bus.emit("products", p), (e: Error) => console.warn(`[products] ${e.message}`));
  }, PRODUCTS_EVERY_MS);
  setInterval(() => {
    const t = tipState();
    const race = raceStats();
    console.log(
      `[status] slot ${processed} behind ${behind} (max ${maxBehind}) | grpc queue ${grpc.queue?.depth} (max ${grpc.queue?.maxDepth}, shed ${grpc.queue?.dropped}) | ` +
        `${streams().map((s) => `${s.name} ${s.connected ? "up" : "down"} r${s.reconnects} bp${s.backpressureClosures}`).join(", ")} | ` +
        `quote samples ${t.samples}, beam floor at p${t.floorPercentile} | race grpc ${race.wins.grpc} mirage ${race.wins.mirage} | ` +
        `lag k=${t.lag.k} r=${t.lag.r} | probe budget left ${budgetState().leftLamports}`,
    );
  }, STATUS_EVERY_MS);

  startServer(
    routes({
      startedAt,
      beamTips,
      probeWallet,
      recent,
      slot: () => processed,
      chainTip: () => chainTip,
      behind: () => behind,
      maxBehind: () => maxBehind,
      streams,
      degraded: degradedNow,
      fares: async () => fareCache ?? refreshFares(),
      products: () => products(productContext),
      onDemoSent: (r, fields) => saveReceipt(r, fields).catch((e: Error) => console.error(`[db] receipt ${r.signature}: ${e.message}`)),
    }),
  );
  console.log(`[tipwise] region streams up; ${beamTips.length} Beam tip addresses; probes ${probeWallet ? "on" : "off (PROBE_SECRET not set)"}`);
}

// Hosts stop instances with SIGTERM; exit cleanly so exit hooks run.
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => process.exit(0));

const mode = process.argv[2];

async function main(): Promise<void> {
  if (mode === "doctor") process.exit((await doctor()) ? 0 : 1);
  if (mode === "serve") return serve();
  if (mode === "demo") return demo();
  throw new Error(`unknown mode "${mode ?? ""}". Use: serve | doctor | demo`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
