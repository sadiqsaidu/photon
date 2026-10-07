import { drizzle } from "drizzle-orm/node-postgres";
import { bigint, doublePrecision, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import pg from "pg";
import { config } from "./config.js";
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

export function closeDb(): Promise<void> {
  return pool.end();
}
