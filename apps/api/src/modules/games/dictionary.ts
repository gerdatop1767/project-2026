import { schema, type Database } from '@zybrilka/db';
import {
  DICTIONARY_GAME_ID,
  DICTIONARY_TASKS,
  MINI_GAME_LEARNED_STREAK,
  allDictionaryItems,
  orderRoundItems,
  writtenForm,
  type DictionaryAnswerRequest,
  type DictionaryAnswerResponse,
  type DictionaryItem,
  type DictionaryQuestion,
  type DictionaryRoundQuery,
  type DictionaryRoundResponse,
  type DictionarySummaryResponse,
  type MiniGameFinishResponse,
  type MiniGameResume,
} from '@zybrilka/shared';
import { and, eq, isNotNull, like, max, sql } from 'drizzle-orm';
import { quizItemId } from './quiz.js';
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
import { shuffle } from './stress.js';

/**
 * «Словарные слова и исключения» (docs/DICTIONARY_GAME.md): one game, the
 * task number chosen inside it. The questions are built from the checked
 * word lists in packages/shared (dictionaryWords.ts) — no tasks are read,
 * nothing is generated. Answers, progress, rounds and ratings use the
 * shared mini-game tables under the game id `dictionary`.
 */
const GAME = DICTIONARY_GAME_ID;

type Item = DictionaryItem & { readonly id: string };

let bank: { items: readonly Item[]; byId: ReadonlyMap<string, Item> } | null = null;
function dictionaryBank() {
  if (!bank) {
    const items = allDictionaryItems().map((it) => ({ ...it, id: quizItemId(GAME, it.key) }));
    bank = { items, byId: new Map(items.map((it) => [it.id, it])) };
  }
  return bank;
}

export const dictionaryItemCount = (): number => dictionaryBank().items.length;

const toQuestion = (it: Item): DictionaryQuestion => ({
  itemId: it.id,
  mechanic: it.mechanic,
  prompt: it.prompt,
  text: it.text,
  options: it.options,
});

/** The session mode keeps the choice: `9:all:all`, `15:nn:mistakes`. */
const sessionMode = (q: Pick<DictionaryRoundQuery, 'task' | 'category' | 'mode'>) =>
  `${q.task}:${q.category ?? 'all'}:${q.mode}`;

const inScope = (it: Item, task: number, category?: string | null) =>
  it.taskNumber === task && (!category || it.categoryId === category);

async function progressRows(db: Database, userId: string) {
  const p = schema.miniGameItemProgress;
  return db
    .select()
    .from(p)
    .where(and(eq(p.userId, userId), eq(p.gameId, GAME)));
}

/**
 * Not the same word twice while there are other words to ask: a round of
 * 15 asks 15 different words; only a round longer than the words left
 * comes back to a word (with another kind of question).
 */
function spreadWords(ordered: readonly Item[], size: number): Item[] {
  const picked: Item[] = [];
  const words = new Set<string>();
  const rest: Item[] = [];
  for (const it of ordered) {
    if (picked.length >= size) break;
    if (words.has(it.word.key)) rest.push(it);
    else {
      words.add(it.word.key);
      picked.push(it);
    }
  }
  return [...picked, ...rest].slice(0, size);
}

export function dictionaryKnown(task: number, category?: string): 'ok' | 'task' | 'category' {
  const t = DICTIONARY_TASKS.find((x) => x.taskNumber === task);
  if (!t) return 'task';
  if (category && !t.categories.some((c) => c.id === category)) return 'category';
  return 'ok';
}

/**
 * A round of one task (or one of its groups): `all` — questions not learned
 * yet first, different words first; `mistakes` — the questions whose last
 * answer was wrong (needs an account; the caller checks). Asking for more
 * than the task has is refused with the real number — never padded.
 */
export async function dictionaryRound(
  db: Database,
  userId: string | null,
  query: DictionaryRoundQuery,
): Promise<DictionaryRoundResponse> {
  const scope = dictionaryBank().items.filter((it) => inScope(it, query.task, query.category));
  const state = new Map((userId ? await progressRows(db, userId) : []).map((p) => [p.itemId, p]));
  if (query.mode === 'all' && query.size > scope.length) {
    throw new NotEnoughQuestionsError(scope.length);
  }
  const picked =
    query.mode === 'mistakes'
      ? shuffle(scope.filter((it) => state.get(it.id)?.lastCorrect === false)).slice(0, query.size)
      : spreadWords(orderRoundItems(scope, state), query.size);
  const questions = shuffle(picked).map(toQuestion);
  const sessionId =
    questions.length > 0
      ? await startGameSession(db, {
          gameId: GAME,
          mode: sessionMode(query),
          userId,
          itemIds: questions.map((q) => q.itemId),
        })
      : null;
  return {
    task: query.task,
    category: query.category ?? null,
    mode: query.mode,
    questions,
    bankSize: scope.length,
    sessionId,
  };
}

/** «Продолжить игру»: the round in progress, in its order, with its answers. */
export async function dictionaryResume(
  db: Database,
  userId: string | null,
  sessionId: string | null,
): Promise<MiniGameResume<DictionaryQuestion> | null> {
  const session = sessionId
    ? await liveSessionById(db, GAME, sessionId, userId)
    : userId
      ? await activeSession(db, userId, GAME)
      : null;
  if (!session?.itemIds) return null;
  const { byId } = dictionaryBank();
  const questions = session.itemIds
    .map((id) => byId.get(id))
    .filter((it): it is Item => it !== undefined)
    .map(toQuestion);
  const kept = new Set(questions.map((q) => q.itemId));
  const answered = (await sessionAnswers(db, session.id)).filter((a) => kept.has(a.itemId));
  return {
    sessionId: session.id,
    gameId: GAME,
    mode: session.mode,
    questions,
    answered,
    startedAt: session.startedAt.toISOString(),
    lastAnswerAt: session.lastAnswerAt?.toISOString() ?? null,
  };
}

/**
 * Checks one answer on the server — the same rules as every quiz game: a
 * signed-in answer is recorded once (`clientAnswerId`), only the first
 * answer to a question counts in its round, a guest's answer is checked
 * but not stored. `null` for an unknown question.
 */
export async function answerDictionary(
  db: Database,
  userId: string | null,
  input: DictionaryAnswerRequest,
  now = new Date(),
): Promise<DictionaryAnswerResponse | null> {
  const item = dictionaryBank().byId.get(input.itemId);
  if (!item) return null;
  const correct = input.answer === item.correct;
  let recorded = false;
  if (userId) {
    recorded = await db.transaction(async (tx) => {
      const round = input.sessionId
        ? await roundAnswerState(tx, GAME, input.sessionId, userId, item.id)
        : 'none';
      if (round === 'answered') return false;
      const a = schema.miniGameAnswers;
      const inserted = await tx
        .insert(a)
        .values({
          userId,
          gameId: GAME,
          itemId: item.id,
          correct,
          answer: input.answer,
          clientAnswerId: input.clientAnswerId,
          createdAt: now,
        })
        .onConflictDoNothing({ target: [a.userId, a.clientAnswerId] })
        .returning({ id: a.id });
      if (inserted.length === 0) return false;
      if (round === 'new') {
        await countRoundAnswer(tx, {
          gameId: GAME,
          sessionId: input.sessionId!,
          userId,
          itemId: item.id,
          correct,
          now,
        });
      }
      const p = schema.miniGameItemProgress;
      await tx
        .insert(p)
        .values({
          userId,
          gameId: GAME,
          itemId: item.id,
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
      return true;
    });
  } else if (input.sessionId) {
    await db.transaction((tx) =>
      countRoundAnswer(tx, {
        gameId: GAME,
        sessionId: input.sessionId!,
        userId: null,
        itemId: item.id,
        correct,
        now,
      }),
    );
  }
  const task = DICTIONARY_TASKS.find((t) => t.taskNumber === item.taskNumber)!;
  const cat = task.categories.find((c) => c.id === item.categoryId)!;
  return {
    correct,
    correctOption: item.correct,
    word: cat.kind === 'letter' ? item.word.word : writtenForm(item.word.gap, item.word.answer),
    explanation: item.word.explanation,
    memo: item.word.memo ?? null,
    recorded,
  };
}

export function finishDictionary(
  db: Database,
  userId: string | null,
  sessionId: string,
  now = new Date(),
): Promise<MiniGameFinishResponse | null> {
  return finishGameSession(db, GAME, sessionId, userId, now);
}

/**
 * The tasks with their groups and word counts; signed in, also the words
 * learned per task (a word is learned once any of its questions was
 * answered right twice in a row) and the best finished round of the task.
 */
export async function dictionarySummary(
  db: Database,
  userId: string | null,
): Promise<DictionarySummaryResponse> {
  const { byId, items } = dictionaryBank();
  const asked = (task: number, category?: string) =>
    items.filter((it) => inScope(it, task, category)).length;
  const learnedWords = new Map<number, Set<string>>();
  const best = new Map<number, number>();
  if (userId) {
    for (const p of await progressRows(db, userId)) {
      const it = byId.get(p.itemId);
      if (!it || p.streak < MINI_GAME_LEARNED_STREAK) continue;
      const set = learnedWords.get(it.taskNumber) ?? new Set<string>();
      set.add(it.word.key);
      learnedWords.set(it.taskNumber, set);
    }
    const s = schema.miniGameSessions;
    const task = sql<string>`split_part(${s.mode}, ':', 1)`;
    const rows = await db
      .select({ task, best: max(s.score) })
      .from(s)
      .where(and(eq(s.userId, userId), eq(s.gameId, GAME), isNotNull(s.score), like(s.mode, '%:%')))
      .groupBy(task);
    for (const r of rows) if (r.best !== null) best.set(Number(r.task), r.best);
  }
  return {
    tasks: DICTIONARY_TASKS.map((t) => ({
      taskNumber: t.taskNumber,
      title: t.title,
      description: t.description,
      categories: t.categories.map((c) => ({
        id: c.id,
        title: c.title,
        words: c.words.length,
        questions: asked(t.taskNumber, c.id),
      })),
      words: t.categories.reduce((n, c) => n + c.words.length, 0),
      questions: asked(t.taskNumber),
      learned: userId ? (learnedWords.get(t.taskNumber)?.size ?? 0) : null,
      bestScore: userId ? (best.get(t.taskNumber) ?? null) : null,
    })),
  };
}

/** The hub card: words learned of all words (a word = learned as above). */
export async function dictionaryHubProgress(
  db: Database,
  userId: string,
): Promise<{ learned: number; total: number }> {
  const s = await dictionarySummary(db, userId);
  return {
    learned: s.tasks.reduce((n, t) => n + (t.learned ?? 0), 0),
    total: s.tasks.reduce((n, t) => n + t.words, 0),
  };
}

/** Exposed for tests: the item behind a question id. */
export const dictionaryItemById = (id: string): Item | undefined => dictionaryBank().byId.get(id);
