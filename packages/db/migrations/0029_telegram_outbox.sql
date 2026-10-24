CREATE TABLE "telegram_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"dedup_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_outbox_dedup_idx" ON "telegram_outbox" USING btree ("dedup_key");--> statement-breakpoint
CREATE INDEX "telegram_outbox_status_next_idx" ON "telegram_outbox" USING btree ("status","next_attempt_at");