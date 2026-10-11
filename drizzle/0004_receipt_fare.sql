ALTER TABLE "receipts" ADD COLUMN "fare" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "quoted_probability" double precision;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "deadline_slots" integer;