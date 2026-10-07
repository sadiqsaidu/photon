CREATE TABLE "audits" (
	"address" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leader_skips" (
	"slot" bigint PRIMARY KEY NOT NULL,
	"leader" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "slot_stats" ADD COLUMN "source" text DEFAULT 'stream' NOT NULL;