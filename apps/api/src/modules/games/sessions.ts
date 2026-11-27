import { schema, type Database } from '@zybrilka/db';
import { quizRoundScore, type MiniGameFinishResponse } from '@zybrilka/shared';
import { and, count, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';

/**
 * A mini-game round as a saved session (docs/MINI_GAMES.md § Сессии): its
 * questions in order (`item_ids`), its first answers
 * (`mini_game_round_answers`, one row per question) and, once finished,
 * the points the SERVER counted from those answers. That is what
 * «Продолжить игру» restores on any device, and why a re-sent answer or a
 * replayed «finish» can never add points twice.
 */

type Tx = Pick<Database, 'select' | 'insert' | 'update'>;
type SessionRow = typeof schema.miniGameSessions.$inferSelect;

const s = schema.miniGameSessions;
const r = schema.miniGameRoundAnswers;

/** The round is still being played: not finished, not given up. */
const live = and(isNull(s.finishedAt), isNull(s.abandonedAt));

/** Only the player's own round — or, for a guest, a guest round. */
export function ownSession(gameId: string, sessionId: string, userId: string | null) {
  return and(
    eq(s.id, sessionId),
    eq(s.gameId, gameId),
    userId ? eq(s.userId, userId) : isNull(s.userId),
  );
}

/**
 * Starts a round. For a signed-in player any unfinished round of the same
 * game is closed as given up first («Новая игра»): one game, one round in
 * progress — so «Продолжить игру» is never ambiguous.
 */
export async function startGameSession(
  db: Database,
  input: { gameId: string; mode: string; userId: string | null; itemIds: readonly string[] },
  now = new Date(),
): Promise<string> {
  return db.transaction(async (tx) => {
    if (input.userId) {
      await tx
        .update(s)
        .set({ abandonedAt: now })
        .where(and(eq(s.userId, input.userId), eq(s.gameId, input.gameId), live));
    }
    const [row] = await tx
      .insert(s)
      .values({
        gameId: input.gameId,
        mode: input.mode,
        userId: input.userId,
        questionCount: input.itemIds.length,
        itemIds: [...input.itemIds],
        startedAt: now,
      })
      .returning({ id: s.id });
    return row!.id;
  });
}

/** The signed-in player's round in progress of this game, if any. */
export async function activeSession(
  db: Database,
  userId: string,
  gameId: string,
): Promise<SessionRow | null> {
  const [row] = await db
    .select()
    .from(s)
    .where(and(eq(s.userId, userId), eq(s.gameId, gameId), live, isNotNull(s.itemIds)))
    .orderBy(desc(s.startedAt))
    .limit(1);
  return row ?? null;
}

/** A round in progress by its id — the player's own, or a guest round. */
export async function liveSessionById(
  db: Database,
  gameId: string,
  sessionId: string,
  userId: string | null,
): Promise<SessionRow | null> {
  const [row] = await db
    .select()
    .from(s)
    .where(and(ownSession(gameId, sessionId, userId), live, isNotNull(s.itemIds)));
  return row ?? null;
}

/** The round's questions answered so far, with their first answers. */
export async function sessionAnswers(
  db: Database,
  sessionId: string,
): Promise<{ itemId: string; firstCorrect: boolean }[]> {
  return db
    .select({ itemId: r.itemId, firstCorrect: r.firstCorrect })
    .from(r)
    .where(eq(r.sessionId, sessionId))
    .orderBy(r.answeredAt);
}

/** «Новая игра» over this round: it stays in the history, never resumed. */
export async function abandonSession(
  db: Database,
  gameId: string,
  sessionId: string,
  userId: string | null,
  now = new Date(),
): Promise<boolean> {
  const rows = await db
    .update(s)
    .set({ abandonedAt: now })
    .where(and(ownSession(gameId, sessionId, userId), live))
    .returning({ id: s.id });
  return rows.length > 0;
}

/**
 * Where an answer stands in its round: `none` — no round to count it in
 * (none given, someone else's, finished, given up, or the question is not
 * in it); `answered` — this question already has its first answer here
 * (any later one is a retry that never counts); `new` — the first answer.
 */
export async function roundAnswerState(
  tx: Tx,
  gameId: string,
  sessionId: string,
  userId: string | null,
  itemId: string,
): Promise<'none' | 'answered' | 'new'> {
  const [session] = await tx
    .select({ itemIds: s.itemIds })
    .from(s)
    .where(and(ownSession(gameId, sessionId, userId), live));
  if (!session || (session.itemIds && !session.itemIds.includes(itemId))) return 'none';
  const [row] = await tx
    .select({ itemId: r.itemId })
    .from(r)
    .where(and(eq(r.sessionId, sessionId), eq(r.itemId, itemId)));
  return row ? 'answered' : 'new';
}

/**
 * Counts an answer in its round — only when the round is the player's own,
 * still being played, and the question belongs to it. The first answer to
 * a question makes its row (its correctness is the question's result in
 * this round); a retry or a re-sent request only raises `attempts` and
 * moves no counter. Returns whether this was the question's first answer.
 */
export async function countRoundAnswer(
  tx: Tx,
  input: {
    gameId: string;
    sessionId: string;
    userId: string | null;
    itemId: string;
    correct: boolean;
    now: Date;
  },
): Promise<boolean> {
  const [session] = await tx
    .select({ itemIds: s.itemIds })
    .from(s)
    .where(and(ownSession(input.gameId, input.sessionId, input.userId), live));
  if (!session) return false;
  if (session.itemIds && !session.itemIds.includes(input.itemId)) return false;
  const inserted = await tx
    .insert(r)
    .values({
      sessionId: input.sessionId,
      gameId: input.gameId,
      itemId: input.itemId,
      userId: input.userId,
      firstCorrect: input.correct,
      answeredAt: input.now,
    })
    .onConflictDoNothing({ target: [r.sessionId, r.itemId] })
    .returning({ itemId: r.itemId });
  if (inserted.length === 0) {
    await tx
      .update(r)
      .set({ attempts: sql`${r.attempts} + 1` })
      .where(and(eq(r.sessionId, input.sessionId), eq(r.itemId, input.itemId)));
    return false;
  }
  await tx
    .update(s)
    .set({
      answeredCount: sql`${s.answeredCount} + 1`,
      correctCount: input.correct ? sql`${s.correctCount} + 1` : s.correctCount,
      lastAnswerAt: input.now,
    })
    .where(eq(s.id, input.sessionId));
  return true;
}

/**
 * The player reached the summary. The SERVER counts the result from the
 * round's first answers (10 points each right one, +20 for a round with
 * every question right) — whatever the client says. Idempotent: a second
 * «finish» returns the same numbers and changes nothing. Null when the
 * round is not this player's.
 */
export async function finishGameSession(
  db: Database,
  gameId: string,
  sessionId: string,
  userId: string | null,
  now = new Date(),
): Promise<MiniGameFinishResponse | null> {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(s)
      .where(ownSession(gameId, sessionId, userId))
      .for('update');
    if (!session) return null;
    const [stats] = await tx
      .select({
        answered: count(),
        right: sql<number>`count(*) filter (where ${r.firstCorrect})::int`,
      })
      .from(r)
      .where(eq(r.sessionId, sessionId));
    const answered = Number(stats?.answered ?? 0);
    const right = Number(stats?.right ?? 0);
    if (session.finishedAt) {
      return {
        questionCount: session.questionCount,
        answered,
        firstTryCorrect: session.firstTryCorrect ?? right,
        score:
          session.score ?? quizRoundScore(session.firstTryCorrect ?? right, session.questionCount),
      };
    }
    const score = quizRoundScore(right, session.questionCount);
    await tx
      .update(s)
      .set({ finishedAt: now, firstTryCorrect: right, score })
      .where(eq(s.id, sessionId));
    // The game's ratings: once per round, in this same transaction.
    if (session.userId) {
      await recordScore(tx, {
        userId: session.userId,
        gameId,
        sessionId,
        score,
        correct: right,
        questions: session.questionCount,
        now,
      });
    }
    return { questionCount: session.questionCount, answered, firstTryCorrect: right, score };
  });
}

/** More questions were asked for than the game has. */
export class NotEnoughQuestionsError extends Error {
  constructor(readonly available: number) {
    super(`only ${available} questions`);
  }
}

/**
 * A finished round into the game's ratings (mini_game_scores): its points
 * are added to the all-time total, and it becomes the best round only if
 * it beats it (a tie keeps the earlier record).
 */
async function recordScore(
  tx: Tx,
  input: {
    userId: string;
    gameId: string;
    sessionId: string;
    score: number;
    correct: number;
    questions: number;
    now: Date;
  },
): Promise<void> {
  const t = schema.miniGameScores;
  const better = sql`excluded.best_score > ${t.bestScore}`;
  await tx
    .insert(t)
    .values({
      userId: input.userId,
      gameId: input.gameId,
      bestScore: input.score,
      bestCorrect: input.correct,
      bestQuestions: input.questions,
      bestSessionId: input.sessionId,
      bestAt: input.now,
      totalPoints: input.score,
      rounds: 1,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [t.userId, t.gameId],
      set: {
        totalPoints: sql`${t.totalPoints} + excluded.total_points`,
        rounds: sql`${t.rounds} + 1`,
        bestScore: sql`case when ${better} then excluded.best_score else ${t.bestScore} end`,
        bestCorrect: sql`case when ${better} then excluded.best_correct else ${t.bestCorrect} end`,
        bestQuestions: sql`case when ${better} then excluded.best_questions else ${t.bestQuestions} end`,
        bestSessionId: sql`case when ${better} then excluded.best_session_id else ${t.bestSessionId} end`,
        bestAt: sql`case when ${better} then excluded.best_at else ${t.bestAt} end`,
        updatedAt: input.now,
      },
    });
}
