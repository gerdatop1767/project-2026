CREATE TABLE "task_difficulty_ratings" (
	"user_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_difficulty_ratings_user_id_task_id_pk" PRIMARY KEY("user_id","task_id"),
	CONSTRAINT "task_difficulty_ratings_range" CHECK ("task_difficulty_ratings"."rating" BETWEEN 1 AND 10)
);
--> statement-breakpoint
ALTER TABLE "task_difficulty_ratings" ADD CONSTRAINT "task_difficulty_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_difficulty_ratings" ADD CONSTRAINT "task_difficulty_ratings_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_difficulty_ratings_task_idx" ON "task_difficulty_ratings" USING btree ("task_id");