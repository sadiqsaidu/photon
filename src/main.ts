import { blurCounts, startBlur } from "./blur.js";
import { bus, LAG_INTERVAL_MS, requireApiKey } from "./config.js";
import { checkDb, saveSlot } from "./db.js";
import { doctor } from "./doctor.js";
import { startGrpc } from "./grpc.js";
import { raceSlot, raceStats, startMirage } from "./mirage.js";
import { beamTipAddresses, leaderNow } from "./solami.js";
import type { StreamHealth } from "./stream.js";
import { addHeat, addTip, finalizedRow, onConfirmed, refreshLag, tipState } from "./tips.js";

const STATUS_EVERY_MS = 60_000;

async function serve(): Promise<void> {
  requireApiKey();
  await checkDb();
  const beamTips = await beamTipAddresses();
  let processed = 0;
  let chainTip = 0;
  let behind = 0;

  const grpc = startGrpc(beamTips, [], {
    onSlot(slot, status) {
      if (status === "processed") {
        raceSlot("grpc", slot);
        if (slot > processed) {
          processed = slot;
          bus.emit("slot", { slot, chainTip, behind });
        }
      }
      if (status === "confirmed") onConfirmed(slot);
      if (status === "finalized") {
        const row = finalizedRow(slot);
        if (row) saveSlot(row).catch((e: Error) => console.error(`[db] slot ${slot}: ${e.message}`));
      }
    },
    onBlock() {},
    onTip: addTip,
    onWatchedTx() {},
  });
  const mirage = startMirage();
  const blur = startBlur(() => processed, addHeat);

  setInterval(refreshLag, LAG_INTERVAL_MS);
  setInterval(() => {
    leaderNow().then(
      (l) => {
        chainTip = l.slot;
        behind = Math.max(0, l.slot - processed);
      },
      (e: Error) => console.warn(`[leader-tracking] ${e.message}`),
    );
  }, 2_000);

  const streams = [grpc, mirage, blur];
  let last = { at: Date.now(), bytes: streams.map((s) => s.bytes), blur: { ...blurCounts } };
  setInterval(() => {
    const secs = (Date.now() - last.at) / 1000;
    const mbps = (s: StreamHealth, i: number) => `${s.name} ${((s.bytes - (last.bytes[i] ?? 0)) / secs / 1e6).toFixed(3)} MB/s${s.connected ? "" : " (down)"}`;
    const rates = Object.entries(blurCounts).map(([t, n]) => `${t} ${((n - (last.blur[t] ?? 0)) / secs).toFixed(1)}/s`);
    const t = tipState();
    const rows = t.window.slice(-120);
    const avgTips = rows.reduce((a, r) => a + r.count, 0) / (rows.length || 1);
    console.log(
      [
        `[status] slot ${processed} (chain tip ${chainTip}, behind ${behind})`,
        `bandwidth: ${streams.map(mbps).join(", ")}`,
        `tips: ${avgTips.toFixed(1)}/slot over ${rows.length} slots, samples ${t.samples} (${t.source}, beam ${t.beamSamples})`,
        `blur: ${rates.join(", ")}`,
        `race: ${JSON.stringify(raceStats())}`,
        `lag: k=${t.lag.k} r=${t.lag.r} n=${t.lag.n} qualifies=${t.lag.qualifies}`,
      ].join("\n  "),
    );
    last = { at: Date.now(), bytes: streams.map((s) => s.bytes), blur: { ...blurCounts } };
  }, STATUS_EVERY_MS);
  console.log(`[photon] streaming (gRPC, Mirage, Blur) with ${beamTips.length} Beam tip addresses`);
}

const mode = process.argv[2];

async function main(): Promise<void> {
  if (mode === "doctor") process.exit((await doctor()) ? 0 : 1);
  if (mode === "serve") return serve();
  throw new Error(`unknown mode "${mode ?? ""}". Use: serve | doctor | demo`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
