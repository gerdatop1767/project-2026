CREATE TABLE "broadcast_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"broadcast_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"telegram_file_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast_deliveries" (
	"broadcast_id" uuid NOT NULL,
	"chat_id" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_code" text,
	"sent_at" timestamp with time zone,
	CONSTRAINT "broadcast_deliveries_broadcast_id_chat_id_pk" PRIMARY KEY("broadcast_id","chat_id")
);
--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_user_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"media_mode" text DEFAULT 'caption' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by_user_id" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"recipients_total" integer,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"blocked_count" integer DEFAULT 0 NOT NULL,
	"test_requested_at" timestamp with time zone,
	"test_status" text
);
--> statement-breakpoint
ALTER TABLE "broadcast_attachments" ADD CONSTRAINT "broadcast_attachments_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_deliveries" ADD CONSTRAINT "broadcast_deliveries_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "broadcast_attachments_position_idx" ON "broadcast_attachments" USING btree ("broadcast_id","position");--> statement-breakpoint
CREATE INDEX "broadcast_deliveries_status_idx" ON "broadcast_deliveries" USING btree ("broadcast_id","status");--> statement-breakpoint
CREATE INDEX "broadcasts_status_created_idx" ON "broadcasts" USING btree ("status","created_at");