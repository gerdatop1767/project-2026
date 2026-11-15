CREATE TABLE "task_answer_reveals" (
	"user_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"revealed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_answer_reveals_user_id_task_id_pk" PRIMARY KEY("user_id","task_id")
);
--> statement-breakpoint
ALTER TABLE "task_answer_reveals" ADD CONSTRAINT "task_answer_reveals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_answer_reveals" ADD CONSTRAINT "task_answer_reveals_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;