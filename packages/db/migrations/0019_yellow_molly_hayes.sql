CREATE TABLE "essay_acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "sample_essay_md" text;--> statement-breakpoint
ALTER TABLE "essay_acknowledgements" ADD CONSTRAINT "essay_acknowledgements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "essay_acknowledgements" ADD CONSTRAINT "essay_acknowledgements_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "essay_acknowledgements_user_task_idx" ON "essay_acknowledgements" USING btree ("user_id","task_id");