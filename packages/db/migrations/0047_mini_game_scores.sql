CREATE TABLE "mini_game_scores" (
	"user_id" uuid NOT NULL,
	"game_id" text NOT NULL,
	"best_score" integer NOT NULL,
	"best_correct" integer NOT NULL,
	"best_questions" integer NOT NULL,
	"best_session_id" uuid,
	"best_at" timestamp with time zone NOT NULL,
	"total_points" integer DEFAULT 0 NOT NULL,
	"rounds" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mini_game_scores_user_id_game_id_pk" PRIMARY KEY("user_id","game_id")
);
--> statement-breakpoint
ALTER TABLE "mini_game_scores" ADD CONSTRAINT "mini_game_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mini_game_scores_best_idx" ON "mini_game_scores" USING btree ("game_id","best_score");--> statement-breakpoint
CREATE INDEX "mini_game_scores_total_idx" ON "mini_game_scores" USING btree ("game_id","total_points");--> statement-breakpoint
-- Existing finished rounds of signed-in players whose first answers the
-- server has (mini_game_round_answers): their points are recounted here,
-- never taken from the client's number. Older rounds without those rows
-- cannot be verified and are not ranked.
WITH counted AS (
	SELECT s.id, s.user_id, s.game_id, s.question_count, s.finished_at,
		count(*) FILTER (WHERE r.first_correct)::int AS correct
	FROM mini_game_sessions s
	JOIN mini_game_round_answers r ON r.session_id = s.id
	WHERE s.user_id IS NOT NULL AND s.finished_at IS NOT NULL
	GROUP BY s.id
), scored AS (
	SELECT *, correct * 10 + CASE WHEN correct = question_count AND question_count > 0 THEN 20 ELSE 0 END AS score
	FROM counted
), best AS (
	SELECT DISTINCT ON (user_id, game_id) user_id, game_id, id, score, correct, question_count, finished_at
	FROM scored
	ORDER BY user_id, game_id, score DESC, finished_at ASC
), totals AS (
	SELECT user_id, game_id, sum(score)::int AS total, count(*)::int AS rounds
	FROM scored
	GROUP BY user_id, game_id
)
INSERT INTO "mini_game_scores" ("user_id", "game_id", "best_score", "best_correct", "best_questions", "best_session_id", "best_at", "total_points", "rounds")
SELECT b.user_id, b.game_id, b.score, b.correct, b.question_count, b.id, b.finished_at, t.total, t.rounds
FROM best b JOIN totals t USING (user_id, game_id)
ON CONFLICT ("user_id", "game_id") DO NOTHING;
