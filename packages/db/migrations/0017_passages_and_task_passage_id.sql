CREATE TABLE "passages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text,
	"body_md" text NOT NULL,
	"source_author" text,
	"source_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "passage_id" uuid;--> statement-breakpoint
ALTER TABLE "passages" ADD CONSTRAINT "passages_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "passages_subject_slug_idx" ON "passages" USING btree ("subject_id","slug");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_passage_id_passages_id_fk" FOREIGN KEY ("passage_id") REFERENCES "public"."passages"("id") ON DELETE no action ON UPDATE no action;