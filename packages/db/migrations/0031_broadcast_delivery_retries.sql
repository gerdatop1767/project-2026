ALTER TABLE "broadcast_deliveries" ADD COLUMN "error_detail" text;--> statement-breakpoint
ALTER TABLE "broadcast_deliveries" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;