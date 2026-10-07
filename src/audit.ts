import { createHmac, timingSafeEqual } from "node:crypto";
import bs58 from "bs58";
import {
  AUDIT_CONCURRENCY,
  BASE_FEE_PER_SIGNATURE,
  bus,
  config,
  JITO_TIP_ACCOUNTS,
  LAMPORTS_PER_SOL,
} from "./config.js";
import { loadAudit, saveAudit, saveSlot, slotRows } from "./db.js";
import * as solami from "./solami.js";
import { supervise, wsSession, type StreamHealth } from "./stream.js";
import { confirmedRow, percentile, type SlotStats } from "./tips.js";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
// Version 1 transactions are live on mainnet; RPC refuses them below this.
const TX_VERSION = 1;
const HOOK_LABEL = "photon-audit";
const WORST = 10;

interface Ix {
  programIdIndex: number;
  accounts: number[];
  data: string;
}

export interface RpcTx {
  slot: number;
  blockTime: number | null;
  transaction: { signatures: string[]; message: { accountKeys: string[]; instructions: Ix[] } };
  meta: {
    err: unknown;
    fee: number;
    loadedAddresses?: { writable: string[]; readonly: string[] };
    innerInstructions?: { instructions: Ix[] }[];
  } | null;
}

export interface AuditTx {
  signature: string;
  slot: number;
  blockTime: number | null;
  success: boolean;
  tip: number;
  priorityFee: number;
  slotP25: number | null;
  slotP50: number | null;
  overpay: number;
  underpaid: boolean;
}

// Lamports moved by System transfers (instruction 2) from `wallet` to a tip
// address, including transfers made by CPI.
export function tipPaid(tx: RpcTx, wallet: string, tipAccounts: Set<string>): number {
  const keys = [...tx.transaction.message.accountKeys, ...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? [])];
  const ixs = [...tx.transaction.message.instructions, ...(tx.meta?.innerInstructions ?? []).flatMap((i) => i.instructions)];
  let tip = 0;
  for (const ix of ixs) {
    if (keys[ix.programIdIndex] !== SYSTEM_PROGRAM) continue;
    const data = Buffer.from(bs58.decode(ix.data));
    if (data.length < 12 || data.readUInt32LE(0) !== 2) continue;
    if (keys[ix.accounts[0] ?? -1] === wallet && tipAccounts.has(keys[ix.accounts[1] ?? -1] ?? "")) tip += Number(data.readBigUInt64LE(4));
  }
  return tip;
}

export function analyze(tx: RpcTx, wallet: string, tipAccounts: Set<string>, bench: Map<number, SlotStats>): AuditTx {
  const tip = tipPaid(tx, wallet, tipAccounts);
  const b = bench.get(tx.slot);
  const slotP50 = b && b.count > 0 ? b.p50 : null;
  const slotP25 = b && b.count > 0 ? b.p25 : null;
  return {
    signature: tx.transaction.signatures[0] as string,
    slot: tx.slot,
    blockTime: tx.blockTime || null,
    success: tx.meta?.err == null,
    tip,
    priorityFee: Math.max(0, (tx.meta?.fee ?? 0) - BASE_FEE_PER_SIGNATURE * tx.transaction.signatures.length),
    slotP25,
    slotP50,
    overpay: tip > 0 && slotP50 !== null ? Math.max(0, tip - slotP50) : 0,
    underpaid: tip > 0 && slotP25 !== null && tip < slotP25,
  };
}

export function summarize(txs: AuditTx[], solPrice: number | null) {
  const tipped = txs.filter((t) => t.tip > 0);
  const overpay = tipped.reduce((a, t) => a + t.overpay, 0);
  return {
    analyzed: txs.length,
    tipped: tipped.length,
    benchmarked: tipped.filter((t) => t.slotP50 !== null).length,
    totalTipsLamports: tipped.reduce((a, t) => a + t.tip, 0),
    overpayLamports: overpay,
    overpaySol: overpay / LAMPORTS_PER_SOL,
    overpayUsd: solPrice === null ? null : Math.round((overpay / LAMPORTS_PER_SOL) * solPrice * 100) / 100,
    underpaidCount: tipped.filter((t) => t.underpaid).length,
    worst: [...tipped].sort((a, b) => b.overpay - a.overpay).slice(0, WORST),
  };
}

async function mapLimit<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  }));
  return out;
}

async function history(address: string, limit: number): Promise<{ txs: RpcTx[]; source: string }> {
  const opts = { transactionDetails: "full", encoding: "json", maxSupportedTransactionVersion: TX_VERSION, sortOrder: "desc" };
  try {
    const txs: RpcTx[] = [];
    let paginationToken: string | undefined;
    do {
      const page = await solami.rpc<{ data: RpcTx[]; paginationToken: string | null }>("getTransactionsForAddress", [
        address,
        { ...opts, limit: Math.min(100, limit - txs.length), ...(paginationToken ? { paginationToken } : {}) },
      ]);
      txs.push(...page.data);
      paginationToken = page.paginationToken ?? undefined;
    } while (paginationToken && txs.length < limit);
    return { txs, source: "getTransactionsForAddress" };
  } catch (e) {
    console.warn(`[audit] getTransactionsForAddress failed, falling back: ${(e as Error).message}`);
  }
  const sigs = await solami.rpc<{ signature: string }[]>("getSignaturesForAddress", [address, { limit }]);
  const txs = await mapLimit(sigs, AUDIT_CONCURRENCY, (s) =>
    solami.rpc<RpcTx | null>("getTransaction", [s.signature, { encoding: "json", maxSupportedTransactionVersion: TX_VERSION }]),
  );
  return { txs: txs.filter((t): t is RpcTx => t !== null), source: "getSignaturesForAddress" };
}

// Tips landed in one block: tip-account balance increases in successful txs.
// Solami's getBlock does not support transactionDetails "accounts", so this
// reads full transactions.
export async function blockStats(slot: number, tipAccounts: Set<string>): Promise<SlotStats | null> {
  const block = await solami.rpc<{ transactions: RpcTx[] } | null>("getBlock", [
    slot,
    { encoding: "json", transactionDetails: "full", rewards: false, maxSupportedTransactionVersion: TX_VERSION, commitment: "confirmed" },
  ]);
  if (!block) return null;
  const tips: number[] = [];
  for (const tx of block.transactions) {
    const meta = tx.meta as (RpcTx["meta"] & { preBalances: number[]; postBalances: number[] }) | null;
    if (!meta || meta.err) continue;
    const keys = [...tx.transaction.message.accountKeys, ...(meta.loadedAddresses?.writable ?? []), ...(meta.loadedAddresses?.readonly ?? [])];
    let tip = 0;
    keys.forEach((k, i) => {
      if (tipAccounts.has(k)) tip += Math.max(0, (meta.postBalances[i] ?? 0) - (meta.preBalances[i] ?? 0));
    });
    if (tip > 0) tips.push(tip);
  }
  tips.sort((a, b) => a - b);
  const row: SlotStats = {
    slot, leader: null, count: tips.length, beamCount: 0, heat: 0,
    p25: percentile(tips, 25), p50: percentile(tips, 50), p75: percentile(tips, 75), p90: percentile(tips, 90), max: tips.at(-1) ?? 0,
  };
  await saveSlot(row, "block");
  return row;
}

async function benchmarks(slots: number[], tipAccounts: Set<string>, maxBlocks: number) {
  const bench = new Map<number, SlotStats>((await slotRows(slots)).map((r) => [r.slot, r]));
  const missing = [...new Set(slots)].filter((s) => !bench.has(s)).sort((a, b) => b - a).slice(0, maxBlocks);
  const fetched = await mapLimit(missing, AUDIT_CONCURRENCY, (s) => blockStats(s, tipAccounts));
  fetched.forEach((r) => r && bench.set(r.slot, r));
  return { bench, blocksFetched: missing.length };
}

const tipSet = async () => new Set([...JITO_TIP_ACCOUNTS, ...(await solami.beamTipAddresses())]);
const solPrice = () => solami.solPriceUsd().catch(() => null);

export async function runAudit(address: string, limit: number) {
  const tips = await tipSet();
  const { txs, source } = await history(address, limit);
  const { bench, blocksFetched } = await benchmarks(txs.filter((t) => tipPaid(t, address, tips) > 0).map((t) => t.slot), tips, config.auditMaxBlocks);
  const analyzed = txs.map((t) => analyze(t, address, tips, bench));
  const price = await solPrice();
  const prev = (await loadAudit(address)) as { watching?: boolean } | null;
  const audit = { address, limit, historySource: source, blocksFetched, solPriceUsd: price, watching: prev?.watching ?? false, updatedAt: Date.now(), summary: summarize(analyzed, price), txs: analyzed };
  await saveAudit(address, audit);
  if (live.has(address)) live.set(address, audit);
  return audit;
}

type Audit = Awaited<ReturnType<typeof runAudit>>;

// Live updates: one stream-mode webhook (enriched transfer events) covers every
// watched wallet. Events are deduplicated by signature (one arrives per
// transfer leg), fetched a few at a time, and applied to in-memory audits that
// are saved every few seconds. A busy wallet can outrun the queue; overflow is
// counted, not processed.
const FETCH_CONCURRENCY = 4;
const MAX_QUEUE = 500;
const LIVE_TXS = 1_000;
const SEEN_KEEP = 20_000;

const live = new Map<string, Audit>();
const dirty = new Set<string>();
const seen = new Set<string>();
const queue: solami.WebhookEvent[] = [];
let inFlight = 0;
let dropped = 0;
let hook: solami.Webhook | null = null;
let hookSecret: string | null = null;
let hookStream: StreamHealth | null = null;

async function fetchTx(signature: string): Promise<RpcTx | null> {
  for (let i = 0; i < 4; i++) {
    if (i) await new Promise((r) => setTimeout(r, 1_500));
    const tx = await solami.rpc<RpcTx | null>("getTransaction", [signature, { encoding: "json", maxSupportedTransactionVersion: TX_VERSION, commitment: "confirmed" }]);
    if (tx) return tx;
  }
  return null;
}

async function applyEvent(ev: solami.WebhookEvent): Promise<void> {
  const involved = new Set((ev.transfers ?? []).flatMap((t) => [t.from_owner, t.to_owner]));
  const addresses = [...live.keys()].filter((a) => involved.has(a));
  if (!addresses.length) return;
  const tx = await fetchTx(ev.signature);
  if (!tx) return;
  const bench = new Map<number, SlotStats>();
  const row = confirmedRow(tx.slot) ?? (await slotRows([tx.slot]))[0];
  if (row) bench.set(tx.slot, row);
  const tips = await tipSet();
  for (const address of addresses) {
    const audit = live.get(address) as Audit;
    if (audit.txs.some((t) => t.signature === ev.signature)) continue;
    const r = analyze(tx, address, tips, bench);
    audit.txs.unshift(r);
    audit.txs.length = Math.min(audit.txs.length, LIVE_TXS);
    audit.summary = summarize(audit.txs, audit.solPriceUsd);
    audit.updatedAt = Date.now();
    dirty.add(address);
    bus.emit("audit", { address, tx: r, summary: audit.summary, dropped });
  }
}

function pump(): void {
  while (inFlight < FETCH_CONCURRENCY && queue.length) {
    const ev = queue.shift() as solami.WebhookEvent;
    inFlight++;
    applyEvent(ev)
      .catch((e: Error) => console.error(`[webhooks] ${ev.signature}: ${e.message}`))
      .finally(() => {
        inFlight--;
        pump();
      });
  }
}

function enqueue(ev: solami.WebhookEvent): void {
  if (!ev.signature || seen.has(ev.signature)) return;
  seen.add(ev.signature);
  if (seen.size > SEEN_KEEP) seen.delete(seen.values().next().value as string);
  if (queue.length >= MAX_QUEUE) {
    dropped++;
    return;
  }
  queue.push(ev);
  pump();
}

setInterval(() => {
  for (const address of dirty) saveAudit(address, live.get(address)).catch((e: Error) => console.error(`[db] audit ${address}: ${e.message}`));
  dirty.clear();
}, 3_000).unref();

function startHookStream(): void {
  if (hookStream || !hook) return;
  const id = hook.id;
  hookStream = supervise("webhooks", (health, signal) =>
    wsSession(solami.webhookStreamUrl(id), health, signal, (data) => enqueue(JSON.parse(data.toString()) as solami.WebhookEvent)),
  );
}

export function webhookHealth(): StreamHealth | null {
  return hookStream;
}

export async function resumeWebhook(): Promise<void> {
  hook = (await solami.webhookList()).find((h) => h.label === HOOK_LABEL) ?? null;
  for (const address of hook?.addresses ?? []) {
    const audit = (await loadAudit(address)) as Audit | null;
    if (audit) live.set(address, { ...audit, watching: true });
  }
  startHookStream();
}

export async function watchWallet(address: string) {
  if (!(await loadAudit(address))) throw new Error("run POST /audit for this address first");
  const url = config.webhookPublicUrl ? `${config.webhookPublicUrl.replace(/\/$/, "")}/webhooks/solami` : "";
  if (!hook) {
    hook = await solami.webhookCreate({
      label: HOOK_LABEL, addresses: [address], stream: true, url, event_types: ["transfer"], payload_kind: "enriched", region: solami.webhookRegion,
    });
    hookSecret = hook.secret ?? null;
  } else if (!hook.addresses.includes(address)) {
    hook = await solami.webhookUpdate({ id: hook.id, addresses: [...hook.addresses, address] });
  }
  const audit = { ...((await loadAudit(address)) as Audit), watching: true };
  live.set(address, audit);
  await saveAudit(address, audit);
  startHookStream();
  return { address, webhookId: hook.id, delivery: url ? "stream+post" : "stream" };
}

// POST delivery only. The signature is assumed to be a hex HMAC-SHA256 of the
// raw body (unverified: Solami documents "an HMAC of the body").
export async function onWebhookPost(raw: Buffer, signature: string | undefined): Promise<void> {
  if (!hookSecret) throw new Error("no webhook secret held by this process; POST delivery is not active");
  const expected = createHmac("sha256", hookSecret).update(raw).digest("hex");
  const given = (signature ?? "").replace(/^sha256=/, "");
  if (given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) throw new Error("bad webhook signature");
  const body = JSON.parse(raw.toString()) as solami.WebhookEvent | solami.WebhookEvent[];
  for (const ev of Array.isArray(body) ? body : [body]) enqueue(ev);
}
