CREATE TABLE "task_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"task_updated_at" timestamp with time zone NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_complaints" ADD COLUMN "report_number" serial NOT NULL;--> statement-breakpoint
ALTER TABLE "task_complaints" ADD COLUMN "context" jsonb;--> statement-breakpoint
ALTER TABLE "task_complaints" ADD COLUMN "snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "task_complaints" ADD COLUMN "duplicate_of_id" uuid;--> statement-breakpoint
ALTER TABLE "task_complaints" ADD COLUMN "handled_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "task_snapshots" ADD CONSTRAINT "task_snapshots_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_snapshots_task_version_idx" ON "task_snapshots" USING btree ("task_id","task_updated_at");--> statement-breakpoint
ALTER TABLE "task_complaints" ADD CONSTRAINT "task_complaints_snapshot_id_task_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."task_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_complaints" ADD CONSTRAINT "task_complaints_duplicate_of_id_task_complaints_id_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."task_complaints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_complaints" ADD CONSTRAINT "task_complaints_handled_by_user_id_users_id_fk" FOREIGN KEY ("handled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_complaints_report_number_idx" ON "task_complaints" USING btree ("report_number");--> statement-breakpoint
CREATE INDEX "task_complaints_created_idx" ON "task_complaints" USING btree ("created_at");