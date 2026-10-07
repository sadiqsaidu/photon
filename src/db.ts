import { desc, eq } from "drizzle-orm";
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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

export async function saveSlot(row: SlotStats): Promise<void> {
  await db.insert(slotStats).values(row).onConflictDoUpdate({ target: slotStats.slot, set: { heat: row.heat, leader: row.leader } });
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

export function probeRows(): Promise<ReceiptRow[]> {
  return db.select().from(receipts).where(eq(receipts.kind, "probe")).orderBy(desc(receipts.createdAt));
}

export function closeDb(): Promise<void> {
  return pool.end();
}
