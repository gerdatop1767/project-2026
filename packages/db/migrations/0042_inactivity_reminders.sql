CREATE TABLE "inactivity_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"chat_id" bigint NOT NULL,
	"status" text DEFAULT 'sending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_active_at" timestamp with time zone,
	"days_to_exam" integer,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "inactivity_reminders" ADD CONSTRAINT "inactivity_reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inactivity_reminders_user_date_idx" ON "inactivity_reminders" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX "inactivity_reminders_user_created_idx" ON "inactivity_reminders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "inactivity_reminders_status_idx" ON "inactivity_reminders" USING btree ("status","next_attempt_at");