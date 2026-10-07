import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import {
  BASE_FEE_PER_SIGNATURE,
  BEAM_MIN_TIP,
  BUCKETS,
  bus,
  config,
  LAMPORTS_PER_SOL,
  MEMO_PROGRAM,
  MIN_BUCKET_PROBES,
  PROBE_COMPUTE_UNIT_LIMIT,
  PROBE_COMPUTE_UNIT_PRICE,
  PROBE_MEMO,
} from "./config.js";
import type { ProbeFields, ReceiptRow } from "./db.js";
import { confirmedBlockhash, rejected, track, type FailureClass, type Receipt } from "./lifecycle.js";
import { bucketOf, CALIBRATION_DEADLINE, probabilities, reachableBuckets, tipForBucket, type ProbeOutcome } from "./quote.js";
import { beamSend, beamTipAddresses, rpc } from "./solami.js";
import { distribution, percentile, rankOf } from "./tips.js";

export const PROBE_FEE = BASE_FEE_PER_SIGNATURE + Math.ceil((PROBE_COMPUTE_UNIT_PRICE * PROBE_COMPUTE_UNIT_LIMIT) / 1_000_000);
// Kept in the wallet so it stays rent exempt.
const RESERVE_LAMPORTS = 1_000_000;

interface ProbeRecord extends ProbeFields {
  signature: string;
  calibrate: boolean;
  tip: number;
  sentSlot: number;
  landedSlot: number | null;
  failure: FailureClass | null;
  settled: boolean;
}

const records = new Map<string, ProbeRecord>();
let budget = Math.round(config.probeBudgetSol * LAMPORTS_PER_SOL);
let stopped = false;
let stopReason: string | null = null;

// Probes still in flight when the server stopped get their outcome from
// signature status; ones never seen stay out of calibration but count as spent.
export async function loadProbes(rows: ReceiptRow[], save: (signature: string, landedSlot: number, failed: boolean) => Promise<void>): Promise<void> {
  const open = rows.filter((r) => r.failure === null && r.landedSlot === null).map((r) => r.signature);
  const found = new Map<string, { slot: number; err: unknown }>();
  for (let i = 0; i < open.length; i += 200) {
    const batch = open.slice(i, i + 200);
    const { value } = await rpc<{ value: ({ slot: number; err: unknown } | null)[] }>("getSignatureStatuses", [batch, { searchTransactionHistory: true }]);
    value.forEach((s, j) => s && found.set(batch[j] as string, s));
  }
  for (const r of rows) {
    const status = found.get(r.signature);
    if (status) {
      r.landedSlot = status.slot;
      r.failure = status.err ? "failed_onchain" : null;
      await save(r.signature, status.slot, Boolean(status.err));
    }
    records.set(r.signature, {
      signature: r.signature,
      tip: r.tip,
      fee: r.fee ?? PROBE_FEE,
      bucket: r.bucket ?? 0,
      percentile: r.percentile ?? 0,
      predicted: r.predicted ?? 0,
      calibrate: r.predicted !== null,
      sentSlot: r.sentSlot,
      landedSlot: r.landedSlot,
      failure: r.failure as FailureClass | null,
      settled: r.landedSlot !== null || r.failure !== null,
    });
  }
}

export function probeSettled(r: Receipt): void {
  const rec = records.get(r.signature);
  if (!rec) return;
  rec.landedSlot = r.landedSlot;
  rec.failure = r.failure;
  rec.settled = true;
}

export function probeRecords(): ProbeRecord[] {
  return [...records.values()];
}

export function probeOutcomes(): ProbeOutcome[] {
  return probeRecords()
    .filter((r) => r.settled && r.calibrate && r.failure !== "send_rejected")
    .map((r) => ({ bucket: r.bucket, slotsToLand: r.landedSlot === null ? null : r.landedSlot - r.sentSlot }));
}

// Unsettled probes count in full: they may still land.
export function spentLamports(): number {
  let spent = 0;
  for (const r of records.values()) {
    if (r.failure === "send_rejected" || r.failure === "expired_blockhash" || r.failure === "leader_skipped") continue;
    spent += r.failure === "failed_onchain" ? r.fee : r.tip + r.fee;
  }
  return spent;
}

export function budgetState() {
  return { budgetLamports: budget, spentLamports: spentLamports(), leftLamports: Math.max(0, budget - spentLamports()), stopped, stopReason };
}

export function bucketCounts(): number[] {
  const counts = BUCKETS.map(() => 0);
  for (const r of records.values()) if (r.calibrate && r.failure !== "send_rejected") counts[r.bucket]!++;
  return counts;
}

// Least-sampled reachable bucket first; ties go to the cheaper bucket when
// planning and to a random one when sending.
function nextBucket(counts: number[], reachable: boolean[], random: boolean): number | null {
  const open = counts.map((n, i) => ({ n, i })).filter((c) => reachable[c.i] && c.n < MIN_BUCKET_PROBES);
  if (!open.length) return null;
  const least = Math.min(...open.map((c) => c.n));
  const ties = open.filter((c) => c.n === least);
  return (ties[random ? Math.floor(Math.random() * ties.length) : 0] as { i: number }).i;
}

// The probes this run would send, in order, and their cost. `limit` caps the
// count (PROBE_LIMIT); 0 means until every reachable bucket is full.
export function fillPlan(sorted: number[], limit = 0) {
  const reachable = reachableBuckets(sorted);
  const counts = bucketCounts();
  const sends: { bucket: number; tip: number }[] = [];
  for (;;) {
    if (limit && sends.length >= limit) break;
    const i = nextBucket(counts, reachable, false);
    if (i === null) break;
    const target = tipForBucket(sorted, i);
    if (!target) break;
    sends.push({ bucket: i, tip: target.tip });
    counts[i]!++;
  }
  const have = bucketCounts();
  const buckets = BUCKETS.map((b, i) => ({
    lo: b.lo,
    hi: b.hi,
    status: reachable[i] ? "reachable" : "above tip ceiling",
    have: have[i] as number,
    planned: sends.filter((x) => x.bucket === i).length,
    tip: sends.find((x) => x.bucket === i)?.tip ?? null,
  }));
  return { buckets, probes: sends.length, costLamports: sends.reduce((a, x) => a + x.tip + PROBE_FEE, 0) };
}

export function probeKeypair(): Keypair | null {
  return config.probeSecret ? Keypair.fromSecretKey(bs58.decode(config.probeSecret)) : null;
}

export function buildTx(payer: Keypair, tipAccount: string, tip: number, blockhash: string, memo: string): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: PROBE_COMPUTE_UNIT_LIMIT }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PROBE_COMPUTE_UNIT_PRICE }),
      new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM), keys: [], data: Buffer.from(memo) }),
      SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: new PublicKey(tipAccount), lamports: tip }),
    ],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([payer]);
  return tx;
}

async function sendProbe(payer: Keypair, slot: number, target: { tip: number; pct: number }, onSent: (r: Receipt, f: ProbeFields) => void): Promise<void> {
  const { tip, pct } = target;
  const bucket = bucketOf(pct);
  const predicted = probabilities(probeOutcomes(), CALIBRATION_DEADLINE, reachableBuckets(distribution().sorted)).p[bucket] as number;
  const recent = confirmedBlockhash() ?? (await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>("getLatestBlockhash", [{ commitment: "confirmed" }])).value;
  const tips = await beamTipAddresses();
  const tx = buildTx(payer, tips[Math.floor(Math.random() * tips.length)] as string, tip, recent.blockhash, PROBE_MEMO);
  const signature = bs58.encode(tx.signatures[0] as Uint8Array);
  const fields = { fee: PROBE_FEE, bucket, percentile: Math.round(pct * 10) / 10, predicted };
  records.set(signature, { signature, tip, sentSlot: slot, landedSlot: null, failure: null, settled: false, calibrate: true, ...fields });
  const r = track(signature, "probe", slot, recent.lastValidBlockHeight, tip);
  onSent(r, fields);
  bus.emit("probe", { signature, tip, ...fields, budget: budgetState() });
  try {
    await beamSend(Buffer.from(tx.serialize()).toString("base64"));
  } catch (e) {
    rejected(r, (e as Error).message);
  }
}

function stop(reason: string): void {
  if (stopped) return;
  stopped = true;
  stopReason = reason;
  console.log(`[probe] stopped: ${reason}`);
  bus.emit("probe", { budget: budgetState() });
}

const WARMUP_MS = 45_000;

export async function startProbes(slot: () => number, onSent: (r: Receipt, f: ProbeFields) => void): Promise<string | null> {
  const payer = probeKeypair();
  if (!payer) return null;
  const address = payer.publicKey.toBase58();
  const balance = (await rpc<{ value: number }>("getBalance", [address, { commitment: "confirmed" }])).value;
  budget = Math.min(budget, spentLamports() + Math.max(0, balance - RESERVE_LAMPORTS));
  console.log(`[probe] wallet ${address}, balance ${balance} lamports, budget ${budget} lamports, every ${config.probeIntervalSec} s`);
  let timer: NodeJS.Timeout | undefined;
  let sent = 0;
  const tick = () => {
    if (stopped) return clearInterval(timer);
    if (config.probeLimit && sent >= config.probeLimit) return stop(`sent PROBE_LIMIT (${config.probeLimit}) probes`);
    const sorted = distribution().sorted;
    const index = nextBucket(bucketCounts(), reachableBuckets(sorted), true);
    if (index === null) return stop(`every reachable bucket has ${MIN_BUCKET_PROBES} probes`);
    const target = tipForBucket(sorted, index);
    if (!target) return;
    if (budgetState().leftLamports < target.tip + PROBE_FEE) return stop(`budget reached (${spentLamports()} of ${budget} lamports)`);
    sent++;
    sendProbe(payer, slot(), target, onSent).catch((e: Error) => console.error(`[probe] ${e.message}`));
  };
  // The plan needs a warm distribution; it gates probing before any send.
  setTimeout(() => {
    const plan = fillPlan(distribution().sorted, config.probeLimit);
    const left = budgetState().leftLamports;
    for (const b of plan.buckets) console.log(`[probe] plan p${b.lo}-${b.hi}: ${b.status}, have ${b.have}, planned ${b.planned}${b.tip ? ` at ${b.tip} lamports` : ""}`);
    console.log(`[probe] plan total: ${plan.probes} probes, ${plan.costLamports} lamports (${plan.costLamports / LAMPORTS_PER_SOL} SOL); budget left ${left} lamports`);
    bus.emit("probe", { plan, budget: budgetState() });
    if (plan.probes === 0) return stop(`every reachable bucket has ${MIN_BUCKET_PROBES} probes`);
    if (plan.costLamports > left) return stop(`plan cost ${plan.costLamports} exceeds budget left ${left}`);
    tick();
    timer = setInterval(tick, config.probeIntervalSec * 1_000);
  }, WARMUP_MS);
  return address;
}
