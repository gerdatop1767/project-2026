import { randomInt } from 'node:crypto';
import { schema, type Database } from '@zybrilka/db';
import {
  MINI_GAME_LEARNED_STREAK,
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
  let picked: WordRow[];
  if (mode === 'all') {
    const learned = (w: WordRow) => (stateOf.get(w.id)?.streak ?? 0) >= MINI_GAME_LEARNED_STREAK;
    const fresh = shuffle(words.filter((w) => !learned(w)));
    const known = shuffle(words.filter(learned));
    picked = [...fresh, ...known].slice(0, size);
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
  return {
    mode,
    questions: shuffle(picked).map(toQuestion),
    dictionarySize: words.length,
  };
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
