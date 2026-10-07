import { desc, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { bigint, doublePrecision, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import pg from "pg";
import { config } from "./config.js";
import type { Receipt } from "./lifecycle.js";
import type { SlotStats } from "./tips.js";

const lamports = (name: string) => bigint(name, { mode: "number" }).notNull();

export const slotStats = pgTable("slot_stats", {
  slot: bigint("slot", { mode: "number" }).primaryKey(),
  leader: text("leader"),
  count: integer("count").notNull(),
  beamCount: integer("beam_count").notNull(),
  p25: lamports("p25"),
  p50: lamports("p50"),
  p75: lamports("p75"),
  p90: lamports("p90"),
  max: lamports("max"),
  heat: doublePrecision("heat").notNull(),
  source: text("source").notNull().default("stream"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leaderSkips = pgTable("leader_skips", {
  slot: bigint("slot", { mode: "number" }).primaryKey(),
  leader: text("leader").notNull(),
});

export const audits = pgTable("audits", {
  address: text("address").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const receipts = pgTable("receipts", {
  signature: text("signature").primaryKey(),
  kind: text("kind").notNull(),
  sentSlot: bigint("sent_slot", { mode: "number" }).notNull(),
  landedSlot: bigint("landed_slot", { mode: "number" }),
  tip: lamports("tip"),
  fee: bigint("fee", { mode: "number" }),
  bucket: integer("bucket"),
  percentile: doublePrecision("percentile"),
  predicted: doublePrecision("predicted"),
  failure: text("failure"),
  error: text("error"),
  stages: jsonb("stages").notNull(),
  beam: jsonb("beam"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ReceiptRow = typeof receipts.$inferSelect;

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 8 });
export const db = drizzle(pool);

export async function checkDb(): Promise<void> {
  try {
    await pool.query("select 1 from slot_stats limit 1");
  } catch (e) {
    throw new Error(`Postgres at DATABASE_URL is not ready (${(e as Error).message}). Run: docker compose up -d db && npm run db:migrate`);
  }
}

export async function saveSlot(row: SlotStats, source: "stream" | "block" = "stream"): Promise<void> {
  await db
    .insert(slotStats)
    .values({ ...row, source })
    .onConflictDoUpdate({ target: slotStats.slot, set: { heat: row.heat, leader: row.leader } });
}

export function slotRows(slots: number[]) {
  return slots.length ? db.select().from(slotStats).where(inArray(slotStats.slot, slots)) : Promise.resolve([]);
}

export async function saveSkip(slot: number, leader: string): Promise<void> {
  await db.insert(leaderSkips).values({ slot, leader }).onConflictDoNothing();
}

export async function leaderStats(identities: string[]) {
  const out = new Map<string, { slotsObserved: number; medianTip: number | null; probesLanded: number; skipped: number }>();
  if (!identities.length) return out;
  const { rows } = await db.execute<{ leader: string; slots: string; median: string | null; landed: string; skipped: string }>(sql`
    select l.leader,
      (select count(*) from slot_stats s where s.leader = l.leader and s.count > 0) as slots,
      (select percentile_cont(0.5) within group (order by s.p50) from slot_stats s where s.leader = l.leader and s.count > 0) as median,
      (select count(*) from receipts r join slot_stats s on s.slot = r.landed_slot where s.leader = l.leader and r.kind = 'probe') as landed,
      (select count(*) from leader_skips k where k.leader = l.leader) as skipped
    from unnest(array[${sql.join(identities.map((i) => sql`${i}`), sql`, `)}]::text[]) as l(leader)`);
  for (const r of rows) {
    out.set(r.leader, {
      slotsObserved: Number(r.slots),
      medianTip: r.median === null ? null : Math.round(Number(r.median)),
      probesLanded: Number(r.landed),
      skipped: Number(r.skipped),
    });
  }
  return out;
}

export async function saveAudit(address: string, data: unknown): Promise<void> {
  await db.insert(audits).values({ address, data }).onConflictDoUpdate({ target: audits.address, set: { data, updatedAt: new Date() } });
}

export async function loadAudit(address: string): Promise<unknown | null> {
  const [row] = await db.select().from(audits).where(eq(audits.address, address));
  return row?.data ?? null;
}

export interface ProbeFields {
  fee: number;
  bucket: number;
  percentile: number;
  predicted: number;
}

export async function saveReceipt(r: Receipt, probe?: ProbeFields): Promise<void> {
  const row = {
    signature: r.signature,
    kind: r.kind,
    sentSlot: r.sentSlot,
    landedSlot: r.landedSlot,
    tip: r.tip,
    failure: r.failure,
    error: r.error,
    stages: r.stages,
    beam: r.beam,
    ...(probe ?? {}),
  };
  await db.insert(receipts).values(row).onConflictDoUpdate({
    target: receipts.signature,
    set: { landedSlot: r.landedSlot, failure: r.failure, error: r.error, stages: r.stages, beam: r.beam },
  });
}

export async function receiptBySignature(signature: string): Promise<ReceiptRow | null> {
  const [row] = await db.select().from(receipts).where(eq(receipts.signature, signature));
  return row ?? null;
}

export async function markLanded(signature: string, landedSlot: number, failed: boolean): Promise<void> {
  await db.update(receipts).set({ landedSlot, failure: failed ? "failed_onchain" : null }).where(eq(receipts.signature, signature));
}

export function latestReceipts(n: number): Promise<ReceiptRow[]> {
  return db.select().from(receipts).orderBy(desc(receipts.createdAt)).limit(n);
}

export function probeRows(): Promise<ReceiptRow[]> {
  return db.select().from(receipts).where(eq(receipts.kind, "probe")).orderBy(desc(receipts.createdAt));
}

export function closeDb(): Promise<void> {
  return pool.end();
}
