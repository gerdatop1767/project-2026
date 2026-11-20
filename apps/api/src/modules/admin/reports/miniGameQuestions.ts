import type { Database } from '@zybrilka/db';
import { sql } from 'drizzle-orm';
import { miniGameItemLabels } from '../../games/itemLabels.js';
import type { Range } from '../period.js';
import { rows } from '../sql.js';

/** A question ranks as hard/easy only with this many answers in the range. */
export const MIN_ANSWERS_FOR_RANK = 5;

interface QuestionRow {
  itemId: string;
  answered: number;
  correct: number;
  wrong: number;
  /** Rounds where the question was answered more than once («Повторить слово»). */
  retried: number;
  /** Registered players who got it wrong in 2+ different rounds of the range. */
  stuckPlayers: number;
}

/**
 * Questions of one game in a range, from the first answer of each round
 * (`mini_game_round_answers`): hardest / easiest by the share of right first
 * answers (with at least MIN_ANSWERS_FOR_RANK answers), most mistakes, and
 * difficulties — players wrong in two or more rounds, or rounds with a retry.
 */
export async function miniGameQuestions(db: Database, range: Range, gameId: string) {
  const start = range.startUtc.toISOString();
  const end = range.endUtc.toISOString();
  const all = await rows<QuestionRow>(
    db,
    sql`WITH r AS (
        SELECT * FROM mini_game_round_answers
        WHERE game_id = ${gameId} AND answered_at >= ${start}::timestamptz AND answered_at < ${end}::timestamptz
      ), stuck AS (
        SELECT item_id, count(*)::int AS n FROM (
          SELECT item_id, user_id FROM r
          WHERE user_id IS NOT NULL AND NOT first_correct
          GROUP BY item_id, user_id HAVING count(DISTINCT session_id) >= 2
        ) x GROUP BY item_id
      )
      SELECT r.item_id::text AS "itemId", count(*)::int AS answered,
        count(*) FILTER (WHERE r.first_correct)::int AS correct,
        count(*) FILTER (WHERE NOT r.first_correct)::int AS wrong,
        count(*) FILTER (WHERE r.attempts > 1)::int AS retried,
        coalesce(max(stuck.n), 0)::int AS "stuckPlayers"
      FROM r LEFT JOIN stuck ON stuck.item_id = r.item_id
      GROUP BY r.item_id`,
  );
  const share = (q: QuestionRow) => q.correct / q.answered;
  const ranked = all.filter((q) => q.answered >= MIN_ANSWERS_FOR_RANK);
  const hardest = [...ranked]
    .sort((a, b) => share(a) - share(b) || b.answered - a.answered)
    .slice(0, 10);
  const easiest = [...ranked]
    .sort((a, b) => share(b) - share(a) || b.answered - a.answered)
    .slice(0, 10);
  const mostMistakes = [...all]
    .filter((q) => q.wrong > 0)
    .sort((a, b) => b.wrong - a.wrong || a.itemId.localeCompare(b.itemId))
    .slice(0, 10);
  const struggling = [...all]
    .filter((q) => q.stuckPlayers > 0 || q.retried > 0)
    .sort((a, b) => b.stuckPlayers - a.stuckPlayers || b.retried - a.retried)
    .slice(0, 10);
  const ids = [
    ...new Set([...hardest, ...easiest, ...mostMistakes, ...struggling].map((q) => q.itemId)),
  ];
  const labels = await miniGameItemLabels(db, gameId, ids);
  const view = (q: QuestionRow) => ({
    ...q,
    correctPercent: Math.round((q.correct / q.answered) * 1000) / 10,
    text: labels.get(q.itemId)?.text ?? null,
    answer: labels.get(q.itemId)?.answer ?? null,
  });
  return {
    questionsInRange: all.length,
    minAnswersForRank: MIN_ANSWERS_FOR_RANK,
    hardest: hardest.map(view),
    easiest: easiest.map(view),
    mostMistakes: mostMistakes.map(view),
    struggling: struggling.map(view),
  };
}
