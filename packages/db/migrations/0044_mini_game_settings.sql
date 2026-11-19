CREATE TABLE "mini_game_settings" (
	"user_id" uuid NOT NULL,
	"game_id" text NOT NULL,
	"round_size" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mini_game_settings_user_id_game_id_pk" PRIMARY KEY("user_id","game_id")
);
--> statement-breakpoint
ALTER TABLE "mini_game_settings" ADD CONSTRAINT "mini_game_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;