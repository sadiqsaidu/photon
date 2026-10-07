CREATE TABLE "receipts" (
	"signature" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"sent_slot" bigint NOT NULL,
	"landed_slot" bigint,
	"tip" bigint NOT NULL,
	"fee" bigint,
	"bucket" integer,
	"percentile" double precision,
	"predicted" double precision,
	"failure" text,
	"error" text,
	"stages" jsonb NOT NULL,
	"beam" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
