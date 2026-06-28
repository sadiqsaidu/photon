CREATE TABLE IF NOT EXISTS "decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"context" jsonb NOT NULL,
	"output" jsonb NOT NULL,
	"reasoning" text NOT NULL,
	"confidence" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lifecycles" (
	"signature" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"payload" text NOT NULL,
	"slot" bigint,
	"tip" bigint DEFAULT 0 NOT NULL,
	"failure" text,
	"stages" jsonb NOT NULL,
	"deltas" jsonb NOT NULL,
	"trace" jsonb,
	"sealed_at" timestamp with time zone DEFAULT now() NOT NULL
);
