import { schema, type Database } from '@zybrilka/db';
import { sql } from 'drizzle-orm';

/**
 * Records an answer to a question of a round in `mini_game_round_answers`:
 * the first answer creates the row (its correctness is the question's
 * result in this round), any later one — a retry, a re-sent request — only
 * raises `attempts`. Call it only for a round already checked to be the
 * player's own (or the guest's own guest round).
 */
export async function recordRoundAnswer(
  db: Pick<Database, 'insert'>,
  input: {
    sessionId: string;
    gameId: string;
    itemId: string;
    userId: string | null;
    correct: boolean;
    now: Date;
  },
): Promise<void> {
  const r = schema.miniGameRoundAnswers;
  await db
    .insert(r)
    .values({
      sessionId: input.sessionId,
      gameId: input.gameId,
      itemId: input.itemId,
      userId: input.userId,
      firstCorrect: input.correct,
      answeredAt: input.now,
    })
    .onConflictDoUpdate({
      target: [r.sessionId, r.itemId],
      set: { attempts: sql`${r.attempts} + 1` },
    });
}
