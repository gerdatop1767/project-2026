ALTER TABLE "mini_game_sessions" ADD COLUMN "item_ids" text[];--> statement-breakpoint
ALTER TABLE "mini_game_sessions" ADD COLUMN "score" integer;--> statement-breakpoint
ALTER TABLE "mini_game_sessions" ADD COLUMN "abandoned_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "mini_game_sessions_active_idx" ON "mini_game_sessions" USING btree ("user_id","game_id") WHERE "mini_game_sessions"."finished_at" is null and "mini_game_sessions"."abandoned_at" is null;