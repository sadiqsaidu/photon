import {
  bigint,
  doublePrecision,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const lifecycles = pgTable("lifecycles", {
  signature: text("signature").primaryKey(),
  source: text("source").notNull(),
  payload: text("payload").notNull(),
  slot: bigint("slot", { mode: "number" }),
  tip: bigint("tip", { mode: "number" }).notNull().default(0),
  failure: text("failure"),
  stages: jsonb("stages").notNull(),
  deltas: jsonb("deltas").notNull(),
  trace: jsonb("trace"),
  sealedAt: timestamp("sealed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const decisions = pgTable("decisions", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  context: jsonb("context").notNull(),
  output: jsonb("output").notNull(),
  reasoning: text("reasoning").notNull(),
  confidence: doublePrecision("confidence").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
