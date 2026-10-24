CREATE TABLE "auth_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_token_hash" text NOT NULL,
	"start_token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_handoffs_claim_token_hash_unique" UNIQUE("claim_token_hash"),
	CONSTRAINT "auth_handoffs_start_token_hash_unique" UNIQUE("start_token_hash")
);
--> statement-breakpoint
ALTER TABLE "auth_handoffs" ADD CONSTRAINT "auth_handoffs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;