CREATE TABLE "seo_agent_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"agent" text NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"action" text NOT NULL,
	"message" text NOT NULL,
	"task_id" uuid,
	"article_id" uuid,
	"actor_user_id" uuid,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "seo_ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"agent" text NOT NULL,
	"purpose" text NOT NULL,
	"model" text NOT NULL,
	"task_id" uuid,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"web_searches" integer DEFAULT 0 NOT NULL,
	"images" integer DEFAULT 0 NOT NULL,
	"cost_usd" jsonb NOT NULL,
	"ok" boolean DEFAULT true NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "seo_article_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" text NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'idea' NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"seo_title" text,
	"meta_description" text,
	"h1" text,
	"format" text,
	"subject_id" text,
	"body_md" text DEFAULT '' NOT NULL,
	"faq" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"og_title" text,
	"og_description" text,
	"primary_keyword" text,
	"secondary_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cta_path" text DEFAULT '/' NOT NULL,
	"cover_media_id" uuid,
	"topic_id" uuid,
	"campaign_id" uuid,
	"priority" jsonb,
	"word_count" integer DEFAULT 0 NOT NULL,
	"quality_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_notes" jsonb,
	"fact_check_passed" boolean,
	"generated_by" text,
	"scheduled_for" timestamp with time zone,
	"published_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"last_check" jsonb,
	"error" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_audit_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"url" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"impact" text NOT NULL,
	"fix" text NOT NULL,
	"auto_fixable" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "seo_audit_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"pages_checked" integer DEFAULT 0 NOT NULL,
	"issues_found" integer DEFAULT 0 NOT NULL,
	"summary" jsonb
);
--> statement-breakpoint
CREATE TABLE "seo_competitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"notes" text,
	"analysis" jsonb,
	"analyzed_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_external_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid,
	"platform_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"link" text NOT NULL,
	"campaign_id" uuid,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_url" text,
	"external_id" text,
	"similarity_max" jsonb,
	"published_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_index_status" (
	"engine" text NOT NULL,
	"date" date NOT NULL,
	"page" text DEFAULT '' NOT NULL,
	"indexed_count" integer,
	"excluded_count" integer,
	"state" text,
	"details" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seo_index_status_engine_date_page_pk" PRIMARY KEY("engine","date","page")
);
--> statement-breakpoint
CREATE TABLE "seo_insights" (
	"dimension" text NOT NULL,
	"value" text NOT NULL,
	"window_days" integer NOT NULL,
	"sample_size" integer NOT NULL,
	"metrics" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seo_insights_dimension_value_window_days_pk" PRIMARY KEY("dimension","value","window_days")
);
--> statement-breakpoint
CREATE TABLE "seo_integrations" (
	"kind" text PRIMARY KEY NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_enc" text,
	"status" text DEFAULT 'not_configured' NOT NULL,
	"last_check_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_keyword_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"subject_id" text,
	"intent" text,
	"article_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query" text NOT NULL,
	"normalized" text NOT NULL,
	"cluster_id" uuid,
	"subject_id" text,
	"intent" text,
	"frequency" integer,
	"frequency_source" text,
	"demand_estimate" integer,
	"competition" integer,
	"position_yandex" jsonb,
	"position_google" jsonb,
	"positions_updated_at" timestamp with time zone,
	"article_id" uuid,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_learning_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"evidence" jsonb,
	"related_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"outcome" text,
	"evaluated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "seo_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid,
	"kind" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"alt" text NOT NULL,
	"description" text,
	"origin" text NOT NULL,
	"license" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_platforms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"mode" text DEFAULT 'manual' NOT NULL,
	"format" text NOT NULL,
	"rules" text NOT NULL,
	"audience" text,
	"reach_estimate" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"research" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_research_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_search_metrics" (
	"engine" text NOT NULL,
	"date" date NOT NULL,
	"page" text DEFAULT '' NOT NULL,
	"query" text DEFAULT '' NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"position" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seo_search_metrics_engine_date_page_query_pk" PRIMARY KEY("engine","date","page","query")
);
--> statement-breakpoint
CREATE TABLE "seo_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"agent" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"priority" integer DEFAULT 50 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"locked_by" text,
	"parent_id" uuid,
	"article_id" uuid,
	"cost_usd" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "seo_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"normalized" text NOT NULL,
	"angle" text,
	"format" text,
	"subject_id" text,
	"primary_keyword" text,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"factors" jsonb,
	"reasoning" text,
	"priority" jsonb,
	"status" text DEFAULT 'new' NOT NULL,
	"source" text NOT NULL,
	"article_id" uuid,
	"duplicate_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_traffic_daily" (
	"date" date NOT NULL,
	"source" text NOT NULL,
	"page" text DEFAULT '' NOT NULL,
	"visits" integer DEFAULT 0 NOT NULL,
	"users" integer DEFAULT 0 NOT NULL,
	"goal_reaches" integer,
	"avg_visit_seconds" jsonb,
	"bounce_rate" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seo_traffic_daily_date_source_page_pk" PRIMARY KEY("date","source","page")
);
--> statement-breakpoint
ALTER TABLE "seo_agent_log" ADD CONSTRAINT "seo_agent_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_article_revisions" ADD CONSTRAINT "seo_article_revisions_article_id_seo_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."seo_articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_articles" ADD CONSTRAINT "seo_articles_topic_id_seo_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."seo_topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_articles" ADD CONSTRAINT "seo_articles_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_audit_issues" ADD CONSTRAINT "seo_audit_issues_run_id_seo_audit_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."seo_audit_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_external_posts" ADD CONSTRAINT "seo_external_posts_article_id_seo_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."seo_articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_external_posts" ADD CONSTRAINT "seo_external_posts_platform_id_seo_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."seo_platforms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_external_posts" ADD CONSTRAINT "seo_external_posts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_keywords" ADD CONSTRAINT "seo_keywords_cluster_id_seo_keyword_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."seo_keyword_clusters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_media" ADD CONSTRAINT "seo_media_article_id_seo_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."seo_articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_settings" ADD CONSTRAINT "seo_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_tasks" ADD CONSTRAINT "seo_tasks_parent_id_seo_tasks_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."seo_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "seo_agent_log_at_idx" ON "seo_agent_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "seo_agent_log_agent_at_idx" ON "seo_agent_log" USING btree ("agent","at");--> statement-breakpoint
CREATE INDEX "seo_agent_log_article_idx" ON "seo_agent_log" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "seo_ai_usage_at_idx" ON "seo_ai_usage" USING btree ("at");--> statement-breakpoint
CREATE INDEX "seo_article_revisions_article_idx" ON "seo_article_revisions" USING btree ("article_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_articles_slug_idx" ON "seo_articles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "seo_articles_status_idx" ON "seo_articles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "seo_articles_published_idx" ON "seo_articles" USING btree ("published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_audit_issues_code_url_idx" ON "seo_audit_issues" USING btree ("code","url");--> statement-breakpoint
CREATE INDEX "seo_audit_issues_status_idx" ON "seo_audit_issues" USING btree ("status","severity");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_competitors_domain_idx" ON "seo_competitors" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_external_posts_article_platform_idx" ON "seo_external_posts" USING btree ("article_id","platform_id");--> statement-breakpoint
CREATE INDEX "seo_external_posts_status_idx" ON "seo_external_posts" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_keyword_clusters_name_idx" ON "seo_keyword_clusters" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_keywords_normalized_idx" ON "seo_keywords" USING btree ("normalized");--> statement-breakpoint
CREATE INDEX "seo_keywords_cluster_idx" ON "seo_keywords" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "seo_keywords_article_idx" ON "seo_keywords" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "seo_learning_log_at_idx" ON "seo_learning_log" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_media_file_name_idx" ON "seo_media" USING btree ("file_name");--> statement-breakpoint
CREATE INDEX "seo_media_article_idx" ON "seo_media" USING btree ("article_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_platforms_slug_idx" ON "seo_platforms" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "seo_research_cache_expires_idx" ON "seo_research_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "seo_search_metrics_date_idx" ON "seo_search_metrics" USING btree ("date");--> statement-breakpoint
CREATE INDEX "seo_search_metrics_page_idx" ON "seo_search_metrics" USING btree ("page","date");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_tasks_idempotency_idx" ON "seo_tasks" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "seo_tasks_queue_idx" ON "seo_tasks" USING btree ("status","run_after","priority");--> statement-breakpoint
CREATE INDEX "seo_tasks_created_idx" ON "seo_tasks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "seo_tasks_article_idx" ON "seo_tasks" USING btree ("article_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seo_topics_normalized_idx" ON "seo_topics" USING btree ("normalized");--> statement-breakpoint
CREATE INDEX "seo_topics_status_idx" ON "seo_topics" USING btree ("status");--> statement-breakpoint
CREATE INDEX "seo_traffic_daily_page_idx" ON "seo_traffic_daily" USING btree ("page","date");--> statement-breakpoint
INSERT INTO "seo_settings" ("id", "value") VALUES (1, '{}'::jsonb) ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "seo_competitors" ("name", "domain", "notes") VALUES
  ('ФИПИ', 'fipi.ru', 'Официальный источник: демоверсии, спецификации, кодификаторы. Не конкурент по смыслу — первоисточник фактов.'),
  ('Решу ЕГЭ', 'ege.sdamgia.ru', 'Каталог заданий и варианты.'),
  ('Фоксфорд', 'foxford.ru', 'Онлайн-школа, блог и вебинары.'),
  ('Умскул', 'umschool.net', 'Онлайн-школа, блог, соцсети.'),
  ('Сотка', 'sotkaonline.ru', 'Онлайн-школа.'),
  ('Максимум', 'maximumtest.ru', 'Онлайн-школа, статьи о ЕГЭ.')
ON CONFLICT DO NOTHING;
