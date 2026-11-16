CREATE TABLE "learning_plan_days" (
	"plan_id" uuid NOT NULL,
	"day_index" integer NOT NULL,
	"date" date NOT NULL,
	"skill_key" text,
	"activity" text NOT NULL,
	"target_tasks" integer NOT NULL,
	"difficulty" integer NOT NULL,
	"skipped" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_plan_days_plan_id_day_index_pk" PRIMARY KEY("plan_id","day_index"),
	CONSTRAINT "learning_plan_days_target_range" CHECK ("learning_plan_days"."target_tasks" BETWEEN 0 AND 8),
	CONSTRAINT "learning_plan_days_difficulty_range" CHECK ("learning_plan_days"."difficulty" BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE TABLE "learning_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subject_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"start_date" date NOT NULL,
	"timezone" text DEFAULT 'Europe/Moscow' NOT NULL,
	"focus" jsonb NOT NULL,
	"moves_used" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"progress_enabled" boolean DEFAULT true NOT NULL,
	"plan_reminders_enabled" boolean DEFAULT true NOT NULL,
	"frequency" text DEFAULT 'normal' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progress_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"dedup_key" text NOT NULL,
	"chat_id" bigint NOT NULL,
	"local_date" date NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'sending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "progress_notifications_dedup_key_unique" UNIQUE("dedup_key")
);
--> statement-breakpoint
ALTER TABLE "learning_plan_days" ADD CONSTRAINT "learning_plan_days_plan_id_learning_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."learning_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_plans" ADD CONSTRAINT "learning_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_plans" ADD CONSTRAINT "learning_plans_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_notifications" ADD CONSTRAINT "progress_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_plan_days_plan_date_idx" ON "learning_plan_days" USING btree ("plan_id","date");--> statement-breakpoint
CREATE INDEX "learning_plans_user_status_idx" ON "learning_plans" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_plans_one_active_idx" ON "learning_plans" USING btree ("user_id","subject_id") WHERE "learning_plans"."status" = 'active';--> statement-breakpoint
CREATE INDEX "progress_notifications_user_date_idx" ON "progress_notifications" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX "progress_notifications_status_idx" ON "progress_notifications" USING btree ("status","next_attempt_at");