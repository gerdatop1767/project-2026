CREATE TABLE "mini_game_round_answers" (
	"session_id" uuid NOT NULL,
	"game_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"user_id" uuid,
	"first_correct" boolean NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mini_game_round_answers_session_id_item_id_pk" PRIMARY KEY("session_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "mini_game_round_answers" ADD CONSTRAINT "mini_game_round_answers_session_id_mini_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."mini_game_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mini_game_round_answers" ADD CONSTRAINT "mini_game_round_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mini_game_round_answers_game_time_idx" ON "mini_game_round_answers" USING btree ("game_id","answered_at");--> statement-breakpoint
CREATE INDEX "mini_game_round_answers_game_item_idx" ON "mini_game_round_answers" USING btree ("game_id","item_id");--> statement-breakpoint
CREATE INDEX "mini_game_answers_game_time_idx" ON "mini_game_answers" USING btree ("game_id","created_at");--> statement-breakpoint
CREATE INDEX "mini_game_sessions_started_idx" ON "mini_game_sessions" USING btree ("started_at");