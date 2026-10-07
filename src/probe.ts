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
  PROBE_COMPUTE_UNIT_LIMIT,
  PROBE_COMPUTE_UNIT_PRICE,
  PROBE_MEMO,
} from "./config.js";
import type { ProbeFields, ReceiptRow } from "./db.js";
import { confirmedBlockhash, rejected, track, type FailureClass, type Receipt } from "./lifecycle.js";
import { CALIBRATION_DEADLINE, probabilities, type ProbeOutcome } from "./quote.js";
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
  return { budgetLamports: budget, spentLamports: spentLamports(), leftLamports: Math.max(0, budget - spentLamports()), stopped };
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

export function bucketOf(pct: number): number {
  const i = BUCKETS.findIndex((b) => pct >= b.lo && pct < b.hi);
  return i === -1 ? BUCKETS.length - 1 : i;
}

async function sendProbe(payer: Keypair, slot: number, onSent: (r: Receipt, f: ProbeFields) => void): Promise<void> {
  const target = BUCKETS[Math.floor(Math.random() * BUCKETS.length)] as (typeof BUCKETS)[number];
  const sorted = distribution().sorted;
  const tip = Math.min(config.tipCeilingLamports, Math.max(BEAM_MIN_TIP, percentile(sorted, (target.lo + target.hi) / 2)));
  const pct = rankOf(sorted, tip);
  const bucket = bucketOf(pct);
  const predicted = probabilities(probeOutcomes(), CALIBRATION_DEADLINE).p[bucket] as number;
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

export async function startProbes(slot: () => number, onSent: (r: Receipt, f: ProbeFields) => void): Promise<string | null> {
  const payer = probeKeypair();
  if (!payer) return null;
  const address = payer.publicKey.toBase58();
  const balance = (await rpc<{ value: number }>("getBalance", [address, { commitment: "confirmed" }])).value;
  budget = Math.min(budget, spentLamports() + Math.max(0, balance - RESERVE_LAMPORTS));
  const tick = () => {
    const maxCost = config.tipCeilingLamports + PROBE_FEE;
    if (stopped || budgetState().leftLamports < maxCost) {
      if (!stopped) console.log(`[probe] budget reached (${spentLamports()} of ${budget} lamports), probes stopped`);
      stopped = true;
      bus.emit("probe", { budget: budgetState() });
      return clearInterval(timer);
    }
    if (distribution().sorted.length === 0 || !slot()) return;
    sendProbe(payer, slot(), onSent).catch((e: Error) => console.error(`[probe] ${e.message}`));
  };
  const timer = setInterval(tick, config.probeIntervalSec * 1_000);
  setTimeout(tick, 15_000);
  console.log(`[probe] wallet ${address}, balance ${balance} lamports, budget ${budget} lamports, every ${config.probeIntervalSec} s`);
  return address;
}
