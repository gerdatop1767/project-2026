CREATE TABLE "mini_game_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"game_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"correct" boolean NOT NULL,
	"answer" text NOT NULL,
	"client_answer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mini_game_item_progress" (
	"user_id" uuid NOT NULL,
	"game_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"correct_count" integer DEFAULT 0 NOT NULL,
	"wrong_count" integer DEFAULT 0 NOT NULL,
	"streak" integer DEFAULT 0 NOT NULL,
	"last_correct" boolean NOT NULL,
	"last_answered_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mini_game_item_progress_user_id_game_id_item_id_pk" PRIMARY KEY("user_id","game_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "stress_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"url" text,
	"verification" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stress_words" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"word" text NOT NULL,
	"marked" text NOT NULL,
	"stress_index" integer NOT NULL,
	"part_of_speech" text NOT NULL,
	"form_note" text,
	"source_id" text NOT NULL,
	"list_status" text NOT NULL,
	"stress_status" text NOT NULL,
	"note" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mini_game_answers" ADD CONSTRAINT "mini_game_answers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mini_game_item_progress" ADD CONSTRAINT "mini_game_item_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stress_words" ADD CONSTRAINT "stress_words_source_id_stress_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."stress_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mini_game_answers_client_idx" ON "mini_game_answers" USING btree ("user_id","client_answer_id");--> statement-breakpoint
CREATE INDEX "mini_game_answers_user_game_idx" ON "mini_game_answers" USING btree ("user_id","game_id","created_at");--> statement-breakpoint
CREATE INDEX "mini_game_item_progress_user_game_idx" ON "mini_game_item_progress" USING btree ("user_id","game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stress_words_key_idx" ON "stress_words" USING btree ("key");