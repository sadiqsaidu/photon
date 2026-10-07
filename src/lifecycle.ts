import { SystemProgram, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { BEAM_MIN_TIP, BLOCKHASH_VALID_BLOCKS, bus, LEADER_SKIP_SLOTS } from "./config.js";
import type { SlotStatus } from "./grpc.js";
import { beamRecord, beamSend, rpc, type BeamRecord } from "./solami.js";

export type Stage = "submitted" | "processed" | "confirmed" | "finalized";
export type FailureClass = "send_rejected" | "failed_onchain" | "leader_skipped" | "expired_blockhash";

export interface Receipt {
  signature: string;
  kind: "probe" | "sdk";
  sentSlot: number;
  lastValidBlockHeight: number | null;
  tip: number;
  stages: Partial<Record<Stage, { slot: number; ms: number }>>;
  landedSlot: number | null;
  failure: FailureClass | null;
  error: string | null;
  beam: BeamRecord | null;
  settled: boolean;
  sentAt: number;
}

const CONFIRMED_KEEP = 1_000;
const BEAM_LOOKUP_DELAY_MS = 3_000;

const BLOCKS_KEEP = 400;

const active = new Map<string, Receipt>();
const blocks = new Map<number, { blockhash: string; lastValidBlockHeight: number }>();
const validUntil = new Map<string, number>();
let latestBlockhash: { blockhash: string; lastValidBlockHeight: number } | null = null;
const confirmedSlots = new Set<number>();
let latestConfirmed = 0;
let height = 0;
let onSettled: (r: Receipt) => void = () => {};

export function onReceiptSettled(fn: (r: Receipt) => void): void {
  onSettled = fn;
}

export function track(signature: string, kind: Receipt["kind"], sentSlot: number, lastValidBlockHeight: number | null, tip: number): Receipt {
  const r: Receipt = {
    signature,
    kind,
    sentSlot,
    lastValidBlockHeight,
    tip,
    stages: { submitted: { slot: sentSlot, ms: 0 } },
    landedSlot: null,
    failure: null,
    error: null,
    beam: null,
    settled: false,
    sentAt: Date.now(),
  };
  active.set(signature, r);
  bus.emit("lifecycle", r);
  return r;
}

export function rejected(r: Receipt, error: string): void {
  r.error = error;
  settle(r, "send_rejected");
}

function mark(r: Receipt, stage: Stage, slot: number): void {
  if (r.stages[stage]) return;
  r.stages[stage] = { slot, ms: Date.now() - r.sentAt };
  bus.emit("lifecycle", r);
}

export function onTx(signature: string, slot: number, failed: boolean): void {
  const r = active.get(signature);
  if (!r) return;
  r.landedSlot = slot;
  mark(r, "processed", slot);
  if (failed) settle(r, "failed_onchain");
}

export function onBlock(slot: number, blockhash: string, blockHeight: number): void {
  const entry = { blockhash, lastValidBlockHeight: blockHeight + BLOCKHASH_VALID_BLOCKS };
  blocks.set(slot, entry);
  validUntil.set(blockhash, entry.lastValidBlockHeight);
  if (blocks.size > BLOCKS_KEEP) {
    const [oldSlot, old] = blocks.entries().next().value as [number, typeof entry];
    blocks.delete(oldSlot);
    validUntil.delete(old.blockhash);
  }
  onBlockHeight(blockHeight);
}

// The newest blockhash from a confirmed block, so probes never build on a fork.
export function confirmedBlockhash() {
  return latestBlockhash;
}

function lastValidHeightOf(blockhash: string): number | null {
  return validUntil.get(blockhash) ?? null;
}

export function onSlot(slot: number, status: SlotStatus): void {
  if (status === "confirmed") latestBlockhash = blocks.get(slot) ?? latestBlockhash;
  if (status === "confirmed" || status === "finalized") {
    confirmedSlots.add(slot);
    if (slot > latestConfirmed) latestConfirmed = slot;
    if (confirmedSlots.size > CONFIRMED_KEEP) {
      for (const s of confirmedSlots) if (s < latestConfirmed - CONFIRMED_KEEP) confirmedSlots.delete(s);
    }
  }
  for (const r of active.values()) {
    if (r.landedSlot !== slot) continue;
    if (status === "confirmed") mark(r, "confirmed", slot);
    if (status === "finalized") {
      mark(r, "confirmed", slot);
      mark(r, "finalized", slot);
      settle(r, null);
    }
  }
}

// A leader skipped if one of the first slots after the send never confirmed
// although a later slot did.
export function leaderSkipped(sentSlot: number, confirmed: Set<number>, latest: number): boolean {
  if (latest <= sentSlot + LEADER_SKIP_SLOTS) return false;
  for (let s = sentSlot + 1; s <= sentSlot + LEADER_SKIP_SLOTS; s++) if (!confirmed.has(s)) return true;
  return false;
}

const checking = new Set<string>();

// Expiry is decided only by streamed block height passing lastValidBlockHeight.
// One status lookup first, in case the stream missed the landing.
export function onBlockHeight(h: number): void {
  if (h > height) height = h;
  for (const r of active.values()) {
    if (r.stages.processed || r.lastValidBlockHeight === null || height <= r.lastValidBlockHeight || checking.has(r.signature)) continue;
    checking.add(r.signature);
    const failure = leaderSkipped(r.sentSlot, confirmedSlots, latestConfirmed) ? "leader_skipped" : "expired_blockhash";
    rpc<{ value: ({ slot: number; err: unknown; confirmationStatus: string } | null)[] }>("getSignatureStatuses", [[r.signature]])
      .then(({ value: [status] }) => {
        if (!status) return settle(r, failure);
        r.landedSlot = status.slot;
        mark(r, "processed", status.slot);
        if (status.err) return settle(r, "failed_onchain");
        if (status.confirmationStatus !== "processed") mark(r, "confirmed", status.slot);
        if (status.confirmationStatus === "finalized") {
          mark(r, "finalized", status.slot);
          settle(r, null);
        }
      })
      .catch(() => settle(r, failure))
      .finally(() => checking.delete(r.signature));
  }
}

function settle(r: Receipt, failure: FailureClass | null): void {
  if (!active.delete(r.signature)) return;
  r.failure = failure;
  bus.emit("lifecycle", r);
  // Settled only once the Beam landing record is attached, so a receipt read
  // after settling is complete.
  setTimeout(() => {
    beamRecord(r.signature)
      .then((rec) => (r.beam = rec))
      .catch((e: Error) => console.warn(`[beam] record ${r.signature}: ${e.message}`))
      .finally(() => {
        r.settled = true;
        bus.emit("lifecycle", r);
        onSettled(r);
      });
  }, failure === "send_rejected" ? 0 : BEAM_LOOKUP_DELAY_MS);
}

export function activeReceipts(): Receipt[] {
  return [...active.values()];
}

// Sum of System transfers to Beam tip addresses (transfer is instruction 2,
// lamports as u64 little endian after the 4 byte index).
export function beamTipOf(tx: VersionedTransaction, beamTips: Set<string>): number {
  const keys = tx.message.staticAccountKeys;
  let tip = 0;
  for (const ix of tx.message.compiledInstructions) {
    const data = Buffer.from(ix.data);
    if (!keys[ix.programIdIndex]?.equals(SystemProgram.programId) || data.length < 12 || data.readUInt32LE(0) !== 2) continue;
    const to = keys[ix.accountKeyIndexes[1] ?? -1]?.toBase58();
    if (to && beamTips.has(to)) tip += Number(data.readBigUInt64LE(4));
  }
  return tip;
}

export async function submitSigned(base64: string, slot: number, beamTips: Set<string>): Promise<Receipt> {
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
  } catch {
    throw new Error("tx must be a base64 serialized, signed transaction");
  }
  const sig = tx.signatures[0];
  if (!sig || sig.every((b) => b === 0)) throw new Error("transaction is not signed");
  const tip = beamTipOf(tx, beamTips);
  if (tip < BEAM_MIN_TIP) throw new Error(`transaction must transfer at least ${BEAM_MIN_TIP} lamports to a Beam tip address (GET /tips/addresses)`);
  const receipt = track(bs58.encode(sig), "sdk", slot, lastValidHeightOf(tx.message.recentBlockhash), tip);
  try {
    await beamSend(base64);
  } catch (e) {
    rejected(receipt, (e as Error).message);
  }
  return receipt;
}
