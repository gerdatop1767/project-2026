import { createHash } from 'node:crypto';
import { schema, type Database } from '@zybrilka/db';
import {
  MINI_GAME_LEARNED_STREAK,
  orderRoundItems,
  expressionDrillItems,
  checkQuizAnswer,
  commaItems,
  dedupeItems,
  expressiveItems,
  findInTextItems,
  formErrorItems,
  gapWordItems,
  grammarItems,
  hyphenItems,
  inputItems,
  neItems,
  nnItems,
  oneCommaItems,
  paronymItems,
  quizRoundScore,
  rowItems,
  wordMeaningItems,
  type QuizAnswerRequest,
  type QuizAnswerResponse,
  type QuizItem,
  type QuizMode,
  type QuizProgressResponse,
  type QuizQuestion,
  type QuizRoundResponse,
  type QuizTaskRow,
} from '@zybrilka/shared';
import { and, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { shuffle } from './stress.js';

/**
 * Quiz mini-games (docs/MINI_GAMES.md § Игры-викторины): questions cut out
 * of real published tasks by the parsers in packages/shared/quizGames.ts.
 * Answers, progress and rounds use the shared mini-game tables — never
 * `attempts`, XP or the ЕГЭ statistics.
 */
interface Source {
  readonly subjectId: 'russian' | 'math';
  /** Task numbers (Russian) … */
  readonly numbers?: readonly number[];
  /** … or a skill (math: every edition numbers it differently). */
  readonly skills?: readonly string[];
  readonly toItems: (row: QuizTaskRow) => QuizItem[];
  /** Questions not taken from tasks (computed, checked by tests). */
  readonly extra?: () => QuizItem[];
}

const SOURCES: Readonly<Record<string, Source>> = {
  'root-vowels': { subjectId: 'russian', numbers: [9], toItems: rowItems },
  prefixes: { subjectId: 'russian', numbers: [10], toItems: rowItems },
  'suffixes-endings': { subjectId: 'russian', numbers: [11, 12], toItems: rowItems },
  'ne-together': { subjectId: 'russian', numbers: [13], toItems: neItems },
  hyphen: { subjectId: 'russian', numbers: [14], toItems: hyphenItems },
  nn: { subjectId: 'russian', numbers: [15], toItems: nnItems },
  'one-comma': { subjectId: 'russian', numbers: [16], toItems: oneCommaItems },
  commas: { subjectId: 'russian', numbers: [17, 18, 19, 20], toItems: commaItems },
  'grammar-detective': { subjectId: 'russian', numbers: [8], toItems: grammarItems },
  paronyms: { subjectId: 'russian', numbers: [5], toItems: paronymItems },
  'word-errors': { subjectId: 'russian', numbers: [7], toItems: formErrorItems },
  'gap-word': { subjectId: 'russian', numbers: [1], toItems: gapWordItems },
  'word-meaning': { subjectId: 'russian', numbers: [2], toItems: wordMeaningItems },
  expressive: { subjectId: 'russian', numbers: [22], toItems: expressiveItems },
  'find-in-text': { subjectId: 'russian', numbers: [25], toItems: findInTextItems },
  'probability-blitz': {
    subjectId: 'math',
    skills: ['math.probability-basic', 'math.probability-rules'],
    toItems: inputItems,
  },
  'expressions-blitz': {
    subjectId: 'math',
    skills: ['math.expressions'],
    toItems: inputItems,
    extra: expressionDrillItems,
  },
};

export const isQuizGame = (id: string): boolean => id in SOURCES;
export const QUIZ_GAME_IDS = Object.keys(SOURCES);

/** A stable UUID for a question (sha1 of game + key, in UUID form). */
export function quizItemId(gameId: string, key: string): string {
  const h = createHash('sha1').update(`${gameId}:${key}`).digest('hex');
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

interface Bank {
  readonly items: readonly (QuizItem & { readonly id: string })[];
  readonly byId: ReadonlyMap<string, QuizItem & { readonly id: string }>;
}

const CACHE_MS = 5 * 60 * 1000;
const banks = new Map<string, { at: number; bank: Bank }>();
const building = new Map<string, Promise<Bank>>();

/** Forget cached banks (tests, a content sync). */
export function resetQuizBanks(): void {
  banks.clear();
  building.clear();
}

/**
 * The game's questions from the published tasks it is built on. Cached:
 * a bank older than 5 minutes is still served at once and rebuilt in the
 * background (content changes only with an import), so no player waits
 * for a rebuild; concurrent builds of one game are shared.
 */
export async function quizBank(db: Database, gameId: string, now = Date.now()): Promise<Bank> {
  const cached = banks.get(gameId);
  if (cached) {
    if (now - cached.at >= CACHE_MS && !building.has(gameId)) {
      void rebuildBank(db, gameId).catch(() => undefined);
    }
    return cached.bank;
  }
  return rebuildBank(db, gameId);
}

function rebuildBank(db: Database, gameId: string): Promise<Bank> {
  const running = building.get(gameId);
  if (running) return running;
  const job = buildBank(db, gameId)
    .then((bank) => {
      banks.set(gameId, { at: Date.now(), bank });
      return bank;
    })
    .finally(() => building.delete(gameId));
  building.set(gameId, job);
  return job;
}

/** Builds every game's bank (server start): the first player never waits. */
export async function warmQuizBanks(db: Database): Promise<void> {
  await Promise.all(QUIZ_GAME_IDS.map((id) => quizBank(db, id)));
}

async function buildBank(db: Database, gameId: string): Promise<Bank> {
  const source = SOURCES[gameId]!;
  const t = schema.tasks;
  const base = db
    .select({
      id: t.id,
      taskNumber: t.taskNumber,
      conditionMd: t.conditionMd,
      correctAnswer: t.correctAnswer,
      acceptedAnswers: t.acceptedAnswers,
      explanationMd: t.explanationMd,
      imageUrl: t.imageUrl,
      passageMd: schema.passages.bodyMd,
    })
    .from(t)
    .leftJoin(schema.passages, eq(schema.passages.id, t.passageId));
  const published = and(eq(t.subjectId, source.subjectId), eq(t.status, 'published'));
  const rows = source.numbers
    ? await base.where(and(published, inArray(t.taskNumber, [...source.numbers])))
    : await base
        .innerJoin(schema.taskSkills, eq(schema.taskSkills.taskId, t.id))
        .innerJoin(schema.skills, eq(schema.skills.id, schema.taskSkills.skillId))
        .where(and(published, inArray(schema.skills.slug, [...source.skills!]), isNotNull(t.id)));
  rows.sort((a, b) => a.id.localeCompare(b.id));
  // A task linked to two of the game's skills is read once.
  const unique = rows.filter((r, i) => i === 0 || rows[i - 1]!.id !== r.id);
  const items = dedupeItems([
    ...unique.flatMap((r) => source.toItems({ ...r, passageMd: r.passageMd ?? null })),
    ...(source.extra?.() ?? []),
  ]).map((it) => ({ ...it, id: quizItemId(gameId, it.key) }));
  return { items, byId: new Map(items.map((it) => [it.id, it])) };
}

const toQuestion = (it: QuizItem & { id: string }): QuizQuestion => ({
  itemId: it.id,
  kind: it.kind,
  text: it.text,
  ...(it.options ? { options: shuffleOptions(it.options) } : {}),
  ...(it.slots ? { slots: it.slots } : {}),
  ...(it.prompt ? { prompt: it.prompt } : {}),
});

/** Да/Нет, Н/НН, слитно/раздельно keep their order; longer lists are shuffled. */
const shuffleOptions = (options: readonly string[]) =>
  options.length <= 2 ? [...options] : shuffle(options);

async function progressRows(db: Database, userId: string, gameId: string) {
  const p = schema.miniGameItemProgress;
  return db
    .select()
    .from(p)
    .where(and(eq(p.userId, userId), eq(p.gameId, gameId)));
}

/**
 * A round: `all` — questions not learned yet first, learned ones only to
 * fill up; `mistakes` — the questions whose last answer was wrong (needs
 * an account; the caller checks). Shuffled.
 */
export async function quizRound(
  db: Database,
  userId: string | null,
  gameId: string,
  mode: QuizMode,
  size: number,
): Promise<QuizRoundResponse> {
  const bank = await quizBank(db, gameId);
  const state = new Map(
    (userId ? await progressRows(db, userId, gameId) : []).map((p) => [p.itemId, p]),
  );
  let picked: (QuizItem & { id: string })[];
  if (mode === 'mistakes') {
    picked = shuffle(bank.items.filter((it) => state.get(it.id)?.lastCorrect === false)).slice(
      0,
      size,
    );
  } else {
    picked = orderRoundItems(bank.items, state).slice(0, size);
  }
  const questions = shuffle(picked).map(toQuestion);
  let sessionId: string | null = null;
  if (questions.length > 0) {
    const [row] = await db
      .insert(schema.miniGameSessions)
      .values({ gameId, mode, userId, questionCount: questions.length })
      .returning({ id: schema.miniGameSessions.id });
    sessionId = row!.id;
  }
  return { gameId, mode, questions, bankSize: bank.items.length, sessionId };
}

function ownSession(gameId: string, sessionId: string, userId: string | null) {
  const s = schema.miniGameSessions;
  return and(
    eq(s.id, sessionId),
    eq(s.gameId, gameId),
    userId ? eq(s.userId, userId) : isNull(s.userId),
  );
}

/**
 * Checks one answer on the server. Signed in: recorded with its progress
 * in one transaction; the same `clientAnswerId` again is recorded once,
 * and a second answer to the same question in the same round is not
 * recorded at all (the first answer counts). `null` for an unknown item.
 */
export async function answerQuiz(
  db: Database,
  userId: string | null,
  gameId: string,
  input: QuizAnswerRequest,
  now = new Date(),
): Promise<QuizAnswerResponse | null> {
  const bank = await quizBank(db, gameId);
  const item = bank.byId.get(input.itemId);
  if (!item) return null;
  const correct = checkQuizAnswer(item, input.answer);
  let recorded = false;
  if (userId) {
    recorded = await db.transaction(async (tx) => {
      const s = schema.miniGameSessions;
      const a = schema.miniGameAnswers;
      let session: { startedAt: Date } | undefined;
      if (input.sessionId) {
        [session] = await tx
          .select({ startedAt: s.startedAt })
          .from(s)
          .where(ownSession(gameId, input.sessionId, userId));
        if (session) {
          // The first answer to this question in this round is the one that counts.
          const [earlier] = await tx
            .select({ id: a.id })
            .from(a)
            .where(
              and(
                eq(a.userId, userId),
                eq(a.gameId, gameId),
                eq(a.itemId, item.id),
                gte(a.createdAt, session.startedAt),
              ),
            )
            .limit(1);
          if (earlier) return false;
        }
      }
      const inserted = await tx
        .insert(a)
        .values({
          userId,
          gameId,
          itemId: item.id,
          correct,
          answer: input.answer,
          clientAnswerId: input.clientAnswerId,
          createdAt: now,
        })
        .onConflictDoNothing({ target: [a.userId, a.clientAnswerId] })
        .returning({ id: a.id });
      if (inserted.length === 0) return false; // the same answer, re-sent
      if (session) {
        await tx
          .update(s)
          .set({
            answeredCount: sql`${s.answeredCount} + 1`,
            correctCount: correct ? sql`${s.correctCount} + 1` : s.correctCount,
            lastAnswerAt: now,
          })
          .where(ownSession(gameId, input.sessionId!, userId));
      }
      const p = schema.miniGameItemProgress;
      await tx
        .insert(p)
        .values({
          userId,
          gameId,
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
    // A guest's answer is not stored; only the round's counters move.
    const s = schema.miniGameSessions;
    await db
      .update(s)
      .set({
        answeredCount: sql`${s.answeredCount} + 1`,
        correctCount: correct ? sql`${s.correctCount} + 1` : s.correctCount,
        lastAnswerAt: now,
      })
      .where(ownSession(gameId, input.sessionId, null));
  }
  return {
    correct,
    display: item.display,
    ...(item.kind === 'choice' ? { correctOption: item.correct } : {}),
    ...(item.kind === 'slots' ? { correctSlots: [...item.correct].map(Number) } : {}),
    ...(item.explanation
      ? { explanation: item.explanation, explanationSource: item.explanationSource ?? 'task' }
      : {}),
    ...(item.kind === 'choice' && item.accepted?.length ? { alsoCorrect: item.accepted } : {}),
    recorded,
    taskId: item.taskId,
  };
}

/** The player reached the summary. Idempotent; false for someone else's round. */
export async function finishQuiz(
  db: Database,
  userId: string | null,
  gameId: string,
  sessionId: string,
  firstTryCorrect: number | null,
  now = new Date(),
): Promise<boolean> {
  const s = schema.miniGameSessions;
  const [own] = await db
    .select({ id: s.id })
    .from(s)
    .where(ownSession(gameId, sessionId, userId));
  if (!own) return false;
  await db
    .update(s)
    .set({
      finishedAt: now,
      firstTryCorrect:
        firstTryCorrect === null ? null : sql`least(${firstTryCorrect}, ${s.questionCount})`,
    })
    .where(and(ownSession(gameId, sessionId, userId), isNull(s.finishedAt)));
  return true;
}

export async function quizProgress(
  db: Database,
  userId: string,
  gameId: string,
): Promise<QuizProgressResponse> {
  const [bank, progress] = await Promise.all([
    quizBank(db, gameId),
    progressRows(db, userId, gameId),
  ]);
  const live = progress.filter((p) => bank.byId.has(p.itemId));
  const correct = live.reduce((n, p) => n + p.correctCount, 0);
  const answers = correct + live.reduce((n, p) => n + p.wrongCount, 0);
  const s = schema.miniGameSessions;
  const rounds = await db
    .select({ questions: s.questionCount, right: s.firstTryCorrect })
    .from(s)
    .where(
      and(
        eq(s.userId, userId),
        eq(s.gameId, gameId),
        isNotNull(s.finishedAt),
        isNotNull(s.firstTryCorrect),
      ),
    );
  const scores = rounds.map((r) => quizRoundScore(r.right ?? 0, r.questions));
  return {
    gameId,
    bankSize: bank.items.length,
    learned: live.filter((p) => p.streak >= MINI_GAME_LEARNED_STREAK).length,
    seen: live.length,
    answers,
    correct,
    accuracyPercent: answers > 0 ? Math.round((correct / answers) * 100) : null,
    mistakes: live.filter((p) => !p.lastCorrect).length,
    bestScore: scores.length > 0 ? Math.max(...scores) : null,
    rounds: rounds.length,
  };
}

/**
 * Learned / total of every quiz game for the hub, in ONE query of the
 * player's progress (instead of one per game).
 */
export async function quizSummaries(
  db: Database,
  userId: string,
): Promise<Map<string, { learned: number; total: number }>> {
  const p = schema.miniGameItemProgress;
  const [rows, bankList] = await Promise.all([
    db
      .select({ gameId: p.gameId, itemId: p.itemId, streak: p.streak })
      .from(p)
      .where(and(eq(p.userId, userId), inArray(p.gameId, QUIZ_GAME_IDS))),
    Promise.all(QUIZ_GAME_IDS.map(async (id) => [id, await quizBank(db, id)] as const)),
  ]);
  const out = new Map<string, { learned: number; total: number }>();
  for (const [id, bank] of bankList) out.set(id, { learned: 0, total: bank.items.length });
  for (const r of rows) {
    const bank = bankList.find(([id]) => id === r.gameId)?.[1];
    if (bank?.byId.has(r.itemId) && r.streak >= MINI_GAME_LEARNED_STREAK) {
      out.get(r.gameId)!.learned += 1;
    }
  }
  return out;
}
