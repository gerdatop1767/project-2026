CREATE TABLE "mini_game_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" text NOT NULL,
	"mode" text NOT NULL,
	"user_id" uuid,
	"question_count" integer NOT NULL,
	"answered_count" integer DEFAULT 0 NOT NULL,
	"correct_count" integer DEFAULT 0 NOT NULL,
	"first_try_correct" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"last_answer_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "mini_game_sessions" ADD CONSTRAINT "mini_game_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mini_game_sessions_game_started_idx" ON "mini_game_sessions" USING btree ("game_id","started_at");--> statement-breakpoint
CREATE INDEX "mini_game_sessions_user_idx" ON "mini_game_sessions" USING btree ("user_id","game_id");