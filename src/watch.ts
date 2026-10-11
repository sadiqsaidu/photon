import { createHmac, timingSafeEqual } from "node:crypto";
import { analyze, summarize, tipSet, TX_VERSION, type Audit, type RpcTx } from "./audit.js";
import { bus, config, LEGACY_LABELS, WATCH_TTL_MS, WEBHOOK_LABEL } from "./config.js";
import { loadAudit, saveAudit, slotRows } from "./db.js";
import * as solami from "./solami.js";
import { supervise, wsSession, type StreamHealth } from "./stream.js";
import { confirmedRow, type SlotStats } from "./tips.js";


// Live audits: one stream-mode webhook (enriched transfer events) covers every
// watched wallet. Events are deduplicated by signature (one arrives per
// transfer leg), fetched a few at a time, and applied to in-memory audits that
// are saved every few seconds. A busy wallet can outrun the queue; overflow is
// counted, not processed.
const FETCH_CONCURRENCY = 4;
const MAX_QUEUE = 500;
const LIVE_TXS = 1_000;
const SEEN_KEEP = 20_000;

const live = new Map<string, Audit>();
const watchedUntil = new Map<string, number>();
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
    const tx = await solami
      .rpc<RpcTx | null>("getTransaction", [signature, { encoding: "json", maxSupportedTransactionVersion: TX_VERSION, commitment: "confirmed" }])
      .catch(() => null);
    if (tx) return tx;
  }
  return null;
}

async function applyEvent(ev: solami.WebhookEvent): Promise<void> {
  const involved = new Set((ev.transfers ?? []).flatMap((t) => [t.from_owner, t.to_owner]));
  const addresses = [...live.keys()].filter((a) => involved.has(a));
  if (!addresses.length) return;
  const fetched = await fetchTx(ev.signature);
  if (!fetched) return;
  // Confirmed transactions can come back before their block time is known.
  const tx = { ...fetched, blockTime: fetched.blockTime ?? Math.floor(Date.now() / 1000) };
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
  hookStream = supervise(
    "webhooks",
    (health, signal) => wsSession(solami.webhookStreamUrl(hook?.id ?? id), health, signal, (data) => enqueue(JSON.parse(data.toString()) as solami.WebhookEvent)),
    () => hook !== null,
  );
}

export function webhookHealth(): StreamHealth | null {
  return hookStream;
}

export function watchedCount(): number {
  return live.size;
}

export async function resumeWebhook(): Promise<void> {
  const hooks = await solami.webhookList();
  for (const old of hooks.filter((h) => h.label === LEGACY_LABELS.webhook)) {
    await solami.webhookDelete(old.id);
    console.log(`[webhooks] deleted legacy webhook ${old.id}`);
  }
  hook = hooks.find((h) => h.label === WEBHOOK_LABEL) ?? null;
  for (const address of hook?.addresses ?? []) {
    const audit = (await loadAudit(address)) as Audit | null;
    if (audit) live.set(address, { ...audit, watching: true });
    watchedUntil.set(address, Date.now() + WATCH_TTL_MS);
  }
  startHookStream();
}

export async function watchWallet(address: string) {
  if (!(await loadAudit(address))) throw new Error("run POST /audit for this address first");
  const url = config.webhookPublicUrl ? `${config.webhookPublicUrl.replace(/\/$/, "")}/webhooks/solami` : "";
  if (!hook) {
    hook = await solami.webhookCreate({
      label: WEBHOOK_LABEL, addresses: [address], stream: true, url, event_types: ["transfer"], payload_kind: "enriched", region: solami.webhookRegion,
    });
    hookSecret = hook.secret ?? null;
  } else if (!hook.addresses.includes(address)) {
    hook = await solami.webhookUpdate({ id: hook.id, addresses: [...hook.addresses, address] });
  }
  const audit = { ...((await loadAudit(address)) as Audit), watching: true };
  live.set(address, audit);
  watchedUntil.set(address, Date.now() + WATCH_TTL_MS);
  await saveAudit(address, audit);
  startHookStream();
  return { address, until: watchedUntil.get(address), delivery: url ? "stream+post" : "stream" };
}

// Expired wallets leave the webhook; Solami refuses an empty address list, so
// the last one deletes the webhook and the stream idles until the next watch.
async function expireWatches(): Promise<void> {
  const now = Date.now();
  const expired = [...watchedUntil].filter(([, until]) => until < now).map(([a]) => a);
  if (!expired.length || !hook) return;
  const keep = hook.addresses.filter((a) => !expired.includes(a));
  if (keep.length) hook = await solami.webhookUpdate({ id: hook.id, addresses: keep });
  else {
    await solami.webhookDelete(hook.id);
    hook = null;
  }
  for (const address of expired) {
    watchedUntil.delete(address);
    const audit = live.get(address);
    live.delete(address);
    if (audit) await saveAudit(address, { ...audit, watching: false });
  }
  console.log(`[webhooks] stopped watching ${expired.length} wallet(s); ${keep.length} left`);
}

setInterval(() => expireWatches().catch((e: Error) => console.error(`[webhooks] expire: ${e.message}`)), 60_000).unref();

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

// A fresh POST /audit replaces the in-memory copy of a watched wallet.
export function auditRefreshed(audit: Audit): void {
  if (live.has(audit.address)) live.set(audit.address, { ...audit, watching: true });
}
