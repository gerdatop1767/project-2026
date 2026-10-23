CREATE TABLE "telegram_bot_chats" (
	"chat_id" bigint PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"start_count" integer DEFAULT 1 NOT NULL,
	"first_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "telegram_bot_chats" ADD CONSTRAINT "telegram_bot_chats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telegram_bot_chats_user_idx" ON "telegram_bot_chats" USING btree ("user_id");