CREATE TABLE "slot_stats" (
	"slot" bigint PRIMARY KEY NOT NULL,
	"leader" text,
	"count" integer NOT NULL,
	"beam_count" integer NOT NULL,
	"p25" bigint NOT NULL,
	"p50" bigint NOT NULL,
	"p75" bigint NOT NULL,
	"p90" bigint NOT NULL,
	"max" bigint NOT NULL,
	"heat" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
