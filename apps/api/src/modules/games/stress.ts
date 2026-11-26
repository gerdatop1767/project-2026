import { randomInt } from 'node:crypto';
import { schema, type Database } from '@zybrilka/db';
import {
  MINI_GAME_LEARNED_STREAK,
  orderRoundItems,
  type MiniGameFinishResponse,
  type MiniGameResume,
  unstressedDisplay,
  vowelIndices,
  type StressAnswerRequest,
  type StressAnswerResponse,
  type StressMode,
  type StressProgressResponse,
  type StressQuestion,
  type StressRoundResponse,
} from '@zybrilka/shared';
import { and, eq, gt, gte, sql } from 'drizzle-orm';
import { moscowDate } from '../admin/period.js';
import {
  NotEnoughQuestionsError,
  activeSession,
  countRoundAnswer,
  finishGameSession,
  liveSessionById,
  roundAnswerState,
  sessionAnswers,
  startGameSession,
} from './sessions.js';

export const STRESS_GAME_ID = 'stress';
const DAY_MS = 24 * 60 * 60 * 1000;

type WordRow = typeof schema.stressWords.$inferSelect;

/** Fisher–Yates with a CSPRNG: the order can't be learned or predicted. */
export function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Only words the game may ask: in use and with one confirmed stress. */
const playable = and(
  eq(schema.stressWords.active, true),
  eq(schema.stressWords.stressStatus, 'confirmed'),
);

async function playableWords(db: Database): Promise<WordRow[]> {
  return db.select().from(schema.stressWords).where(playable);
}

function toQuestion(w: WordRow): StressQuestion {
  const display = unstressedDisplay(w.word);
  return {
    wordId: w.id,
    display,
    vowels: vowelIndices(display),
    partOfSpeech: w.partOfSpeech,
    formNote: w.formNote,
  };
}

async function progressRows(db: Database, userId: string) {
  return db
    .select()
    .from(schema.miniGameItemProgress)
    .where(
      and(
        eq(schema.miniGameItemProgress.userId, userId),
        eq(schema.miniGameItemProgress.gameId, STRESS_GAME_ID),
      ),
    );
}

/**
 * A round of questions. `all`: words not learned yet first (never-seen
 * and half-learned mixed), learned ones only to fill up; `mistakes`: the
 * words whose last answer was wrong; `hard`: the ones confused most often.
 * Always shuffled. `mistakes`/`hard` need an account (caller checks).
 */
export async function stressRound(
  db: Database,
  userId: string | null,
  mode: StressMode,
  size: number,
): Promise<StressRoundResponse> {
  const words = await playableWords(db);
  const progress = userId ? await progressRows(db, userId) : [];
  const stateOf = new Map(progress.map((p) => [p.itemId, p]));
  // A whole game is never padded with repeats: more than the game has is refused.
  if (mode === 'all' && size > words.length) throw new NotEnoughQuestionsError(words.length);
  let picked: WordRow[];
  if (mode === 'all') {
    picked = orderRoundItems(words, stateOf).slice(0, size);
  } else if (mode === 'mistakes') {
    picked = shuffle(words.filter((w) => stateOf.get(w.id)?.lastCorrect === false)).slice(0, size);
  } else {
    const hardness = (w: WordRow) => {
      const s = stateOf.get(w.id);
      return s ? s.wrongCount / (s.wrongCount + s.correctCount) : 0;
    };
    picked = words
      .filter((w) => (stateOf.get(w.id)?.wrongCount ?? 0) > 0)
      .sort((a, b) => hardness(b) - hardness(a))
      .slice(0, size);
  }
  const questions = shuffle(picked).map(toQuestion);
  return {
    mode,
    questions,
    dictionarySize: words.length,
    sessionId:
      questions.length > 0
        ? await startGameSession(db, {
            gameId: STRESS_GAME_ID,
            mode,
            userId,
            itemIds: questions.map((q) => q.wordId),
          })
        : null,
  };
}

/** «Продолжить игру» — see quizResume: the same, for «Ударения». */
export async function stressResume(
  db: Database,
  userId: string | null,
  sessionId: string | null,
): Promise<MiniGameResume<StressQuestion> | null> {
  const session = sessionId
    ? await liveSessionById(db, STRESS_GAME_ID, sessionId, userId)
    : userId
      ? await activeSession(db, userId, STRESS_GAME_ID)
      : null;
  if (!session?.itemIds) return null;
  const words = new Map((await playableWords(db)).map((w) => [w.id, w]));
  const questions = session.itemIds
    .map((id) => words.get(id))
    .filter((w): w is WordRow => w !== undefined)
    .map(toQuestion);
  const kept = new Set(questions.map((q) => q.wordId));
  const answered = (await sessionAnswers(db, session.id)).filter((a) => kept.has(a.itemId));
  return {
    sessionId: session.id,
    gameId: STRESS_GAME_ID,
    mode: session.mode,
    questions,
    answered,
    startedAt: session.startedAt.toISOString(),
    lastAnswerAt: session.lastAnswerAt?.toISOString() ?? null,
  };
}

/** The player reached the summary: the server counts the result (sessions.ts). */
export function finishStressSession(
  db: Database,
  userId: string | null,
  sessionId: string,
  now = new Date(),
): Promise<MiniGameFinishResponse | null> {
  return finishGameSession(db, STRESS_GAME_ID, sessionId, userId, now);
}

/**
 * Checks one answer on the server (the question never carries it). For a
 * signed-in player it is recorded with its progress in one transaction;
 * the same `clientAnswerId` again (a double tap, a retry) is recorded
 * once. `null` when the word is not playable.
 */
export async function answerStress(
  db: Database,
  userId: string | null,
  input: StressAnswerRequest,
  now = new Date(),
): Promise<StressAnswerResponse | null> {
  const [word] = await db
    .select()
    .from(schema.stressWords)
    .where(and(eq(schema.stressWords.id, input.wordId), playable));
  if (!word) return null;
  const correct = input.index === word.stressIndex;
  if (userId) {
    await db.transaction(async (tx) => {
      const round = input.sessionId
        ? await roundAnswerState(tx, STRESS_GAME_ID, input.sessionId, userId, word.id)
        : 'none';
      const inserted = await tx
        .insert(schema.miniGameAnswers)
        .values({
          userId,
          gameId: STRESS_GAME_ID,
          itemId: word.id,
          correct,
          answer: String(input.index),
          clientAnswerId: input.clientAnswerId,
          createdAt: now,
        })
        .onConflictDoNothing({
          target: [schema.miniGameAnswers.userId, schema.miniGameAnswers.clientAnswerId],
        })
        .returning({ id: schema.miniGameAnswers.id });
      if (inserted.length === 0) return; // already counted
      if (round !== 'none') {
        // A word's first answer in the round is its result; «Повторить
        // слово» answers it again — kept in the history, not in the score.
        await countRoundAnswer(tx, {
          gameId: STRESS_GAME_ID,
          sessionId: input.sessionId!,
          userId,
          itemId: word.id,
          correct,
          now,
        });
      }
      const p = schema.miniGameItemProgress;
      await tx
        .insert(p)
        .values({
          userId,
          gameId: STRESS_GAME_ID,
          itemId: word.id,
          correctCount: correct ? 1 : 0,
          wrongCount: correct ? 0 : 1,
          streak: correct ? 1 : 0,
          lastCorrect: correct,
          lastAnsweredAt: now,
        })
        .onConflictDoUpdate({
          target: [p.userId, p.gameId, p.itemId],
          set: correct
            ? {
                correctCount: sql`${p.correctCount} + 1`,
                streak: sql`${p.streak} + 1`,
                lastCorrect: true,
                lastAnsweredAt: now,
              }
            : {
                wrongCount: sql`${p.wrongCount} + 1`,
                streak: 0,
                lastCorrect: false,
                lastAnsweredAt: now,
              },
        });
    });
  } else if (input.sessionId) {
    // A guest's answer is not stored; only the round's first answers move.
    await db.transaction((tx) =>
      countRoundAnswer(tx, {
        gameId: STRESS_GAME_ID,
        sessionId: input.sessionId!,
        userId: null,
        itemId: word.id,
        correct,
        now,
      }),
    );
  }
  return {
    correct,
    correctIndex: word.stressIndex,
    marked: word.marked,
    formNote: word.formNote,
    note: word.note,
    recorded: userId !== null,
  };
}

export async function stressProgress(
  db: Database,
  userId: string,
  now = new Date(),
): Promise<StressProgressResponse> {
  const [words, progress] = await Promise.all([playableWords(db), progressRows(db, userId)]);
  const wordOf = new Map(words.map((w) => [w.id, w]));
  const live = progress.filter((p) => wordOf.has(p.itemId));
  const correct = live.reduce((n, p) => n + p.correctCount, 0);
  const wrong = live.reduce((n, p) => n + p.wrongCount, 0);
  const since = new Date(now.getTime() - 13 * DAY_MS);
  const moscowDay = sql<string>`to_char(${schema.miniGameAnswers.createdAt} at time zone 'Europe/Moscow', 'YYYY-MM-DD')`;
  const daily = await db
    .select({
      date: moscowDay,
      answers: sql<number>`count(*)::int`,
      correct: sql<number>`count(*) filter (where ${schema.miniGameAnswers.correct})::int`,
    })
    .from(schema.miniGameAnswers)
    .where(
      and(
        eq(schema.miniGameAnswers.userId, userId),
        eq(schema.miniGameAnswers.gameId, STRESS_GAME_ID),
        gte(schema.miniGameAnswers.createdAt, new Date(`${moscowDate(since)}T00:00:00+03:00`)),
      ),
    )
    .groupBy(moscowDay)
    .orderBy(moscowDay);
  return {
    dictionarySize: words.length,
    learned: live.filter((p) => p.streak >= MINI_GAME_LEARNED_STREAK).length,
    seen: live.length,
    answers: correct + wrong,
    correct,
    wrong,
    accuracyPercent: correct + wrong > 0 ? Math.round((correct / (correct + wrong)) * 100) : null,
    mistakes: live.filter((p) => !p.lastCorrect).length,
    hardWords: live
      .filter((p) => p.wrongCount > 0)
      .sort(
        (a, b) =>
          b.wrongCount / (b.wrongCount + b.correctCount) -
            a.wrongCount / (a.wrongCount + a.correctCount) || b.wrongCount - a.wrongCount,
      )
      .slice(0, 10)
      .map((p) => ({
        wordId: p.itemId,
        marked: wordOf.get(p.itemId)!.marked,
        wrong: p.wrongCount,
        correct: p.correctCount,
      })),
    daily,
  };
}

/** Learned / total for the hub card. */
export async function stressSummary(db: Database, userId: string) {
  const [total, learned] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.stressWords)
      .where(playable),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.miniGameItemProgress)
      .innerJoin(schema.stressWords, eq(schema.stressWords.id, schema.miniGameItemProgress.itemId))
      .where(
        and(
          playable,
          eq(schema.miniGameItemProgress.userId, userId),
          eq(schema.miniGameItemProgress.gameId, STRESS_GAME_ID),
          gt(schema.miniGameItemProgress.streak, MINI_GAME_LEARNED_STREAK - 1),
        ),
      ),
  ]);
  return { learned: learned[0]?.n ?? 0, total: total[0]?.n ?? 0 };
}

/** Playable words (the hub's question count for a guest). */
export async function stressWordCount(db: Database): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.stressWords)
    .where(playable);
  return row?.n ?? 0;
}
