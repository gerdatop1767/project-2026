ALTER TABLE "collections" ADD COLUMN "in_all_sources" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "exam_format" text;--> statement-breakpoint
ALTER TABLE "learning_sessions" ADD COLUMN "scoring" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "source_task_number" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "max_primary_score" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "review_note" text;