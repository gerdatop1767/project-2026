ALTER TABLE "broadcast_deliveries" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "broadcast_deliveries" ADD COLUMN "click_token" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcast_deliveries" ADD COLUMN "clicked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "broadcast_deliveries" ADD COLUMN "click_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "audience" jsonb;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "track_clicks" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "button_text" text;--> statement-breakpoint
ALTER TABLE "broadcast_deliveries" ADD CONSTRAINT "broadcast_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcast_deliveries_user_idx" ON "broadcast_deliveries" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "broadcast_deliveries_click_token_idx" ON "broadcast_deliveries" USING btree ("click_token");--> statement-breakpoint
CREATE INDEX "broadcasts_stage_idx" ON "broadcasts" USING btree ("stage");