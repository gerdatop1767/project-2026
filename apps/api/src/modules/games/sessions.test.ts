import { randomUUID } from 'node:crypto';
import { importStressDictionary, schema } from '@zybrilka/db';
import { createFullContentTestDb } from '@zybrilka/db/testing';
import type {
  MiniGameActiveResponse,
  MiniGameFinishResponse,
  QuizQuestion,
  QuizRoundResponse,
} from '@zybrilka/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { QUIZ_GAME_IDS, quizBank, resetQuizBanks } from './quiz.js';

/**
 * Saved rounds (docs/MINI_GAMES.md § Сессии): long games, «Продолжить
 * игру» on another device, «Новая игра», and the server's own count of
 * points — never the client's, never twice.
 */
describe('mini-games — saved sessions', { timeout: 120_000 }, () => {
  let testDb: Awaited<ReturnType<typeof createFullContentTestDb>>;
  let app: ReturnType<typeof buildApp>;

  /** One account signed in on two devices (two sessions). */
  async function player() {
    const [user] = await testDb.db.insert(schema.users).values({}).returning();
    const login = async () => {
      const id = randomUUID();
      await testDb.db
        .insert(schema.authSessions)
        .values({ id, userId: user!.id, expiresAt: new Date(Date.now() + 3_600_000) });
      return `session_id=${id}`;
    };
    return { id: user!.id, phone: await login(), laptop: await login() };
  }
  const get = (url: string, cookie?: string) =>
    app.inject({ method: 'GET', url: `/api/v1${url}`, headers: cookie ? { cookie } : {} });
  const post = (url: string, payload: unknown, cookie?: string) =>
    app.inject({
      method: 'POST',
      url: `/api/v1${url}`,
      payload: payload as object,
      headers: cookie ? { cookie } : {},
    });
  const answer = (sessionId: string | null, q: QuizQuestion, text: string, cookie?: string) =>
    post(
      '/games/quiz/nn/answer',
      { itemId: q.itemId, answer: text, clientAnswerId: randomUUID(), sessionId },
      cookie,
    );

  beforeAll(async () => {
    testDb = await createFullContentTestDb();
    await importStressDictionary(testDb.db);
    resetQuizBanks();
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test', WEB_BASE_URL: 'https://zybrilka.test' }),
    });
  }, 300_000);
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  it('a long game: as many questions as asked, each once, when the bank has them', async () => {
    // The largest quiz bank of the test content.
    let gameId = '';
    let bankSize = 0;
    for (const id of QUIZ_GAME_IDS) {
      const n = (await quizBank(testDb.db, id)).items.length;
      if (n > bankSize) [gameId, bankSize] = [id, n];
    }
    const size = Math.min(500, bankSize);
    expect(size).toBeGreaterThanOrEqual(100);
    const round = (
      await get(`/games/quiz/${gameId}/round?size=${size}`)
    ).json() as QuizRoundResponse;
    expect(round.questions).toHaveLength(size);
    expect(new Set(round.questions.map((q) => q.itemId)).size).toBe(size);
    const [row] = await testDb.db
      .select()
      .from(schema.miniGameSessions)
      .where(eq(schema.miniGameSessions.id, round.sessionId!));
    // The order is kept on the server — what «Продолжить игру» restores.
    expect(row!.itemIds).toEqual(round.questions.map((q) => q.itemId));

    // «Ударения» — a 100+ word game too, each word once.
    const words = (await get('/games/stress/round?size=100')).json() as {
      questions: { wordId: string }[];
    };
    expect(words.questions).toHaveLength(100);
    expect(new Set(words.questions.map((q) => q.wordId)).size).toBe(100);
  });

  it('«Продолжить игру» on another device: the same order, the answers given, the points', async () => {
    const me = await player();
    const round = (await get('/games/quiz/nn/round?size=5', me.phone)).json() as QuizRoundResponse;
    const [q1, q2] = round.questions;
    await answer(round.sessionId, q1!, 'НН', me.phone);
    await answer(round.sessionId, q2!, 'Н', me.phone);

    const resumed = (
      await get('/games/quiz/nn/active', me.laptop)
    ).json() as MiniGameActiveResponse<QuizQuestion>;
    expect(resumed.session).not.toBeNull();
    expect(resumed.session!.sessionId).toBe(round.sessionId);
    expect(resumed.session!.questions.map((q) => q.itemId)).toEqual(
      round.questions.map((q) => q.itemId),
    );
    expect(resumed.session!.answered.map((a) => a.itemId)).toEqual([q1!.itemId, q2!.itemId]);

    // Someone else sees nothing of it; a guest neither.
    const other = await player();
    expect(
      (
        (
          await get('/games/quiz/nn/active', other.phone)
        ).json() as MiniGameActiveResponse<QuizQuestion>
      ).session,
    ).toBeNull();
    expect(
      ((await get('/games/quiz/nn/active')).json() as MiniGameActiveResponse<QuizQuestion>).session,
    ).toBeNull();
  });

  it('a guest continues by the round id; nobody signed in can take it over', async () => {
    const round = (await get('/games/quiz/nn/round?size=3')).json() as QuizRoundResponse;
    await answer(round.sessionId, round.questions[0]!, 'Н');
    const resumed = (
      await get(`/games/quiz/nn/active?sessionId=${round.sessionId}`)
    ).json() as MiniGameActiveResponse<QuizQuestion>;
    expect(resumed.session?.answered).toHaveLength(1);
    const someone = await player();
    expect(
      (
        (
          await get(`/games/quiz/nn/active?sessionId=${round.sessionId}`, someone.phone)
        ).json() as MiniGameActiveResponse<QuizQuestion>
      ).session,
    ).toBeNull();
  });

  it('«Новая игра» closes the unfinished one: one round in progress per game', async () => {
    const me = await player();
    const first = (await get('/games/quiz/nn/round?size=5', me.phone)).json() as QuizRoundResponse;
    const second = (
      await get('/games/quiz/nn/round?size=5', me.laptop)
    ).json() as QuizRoundResponse;
    const active = (
      await get('/games/quiz/nn/active', me.phone)
    ).json() as MiniGameActiveResponse<QuizQuestion>;
    expect(active.session!.sessionId).toBe(second.sessionId);
    // The closed round takes no more answers.
    await answer(first.sessionId, first.questions[0]!, 'Н', me.phone);
    const [closed] = await testDb.db
      .select()
      .from(schema.miniGameSessions)
      .where(eq(schema.miniGameSessions.id, first.sessionId!));
    expect(closed!.abandonedAt).not.toBeNull();
    expect(closed!.answeredCount).toBe(0);
    // An explicit «Новая игра»: the round is given up, nothing to continue.
    expect(
      (await post('/games/quiz/nn/abandon', { sessionId: second.sessionId }, me.phone)).statusCode,
    ).toBe(204);
    expect(
      (
        (
          await get('/games/quiz/nn/active', me.phone)
        ).json() as MiniGameActiveResponse<QuizQuestion>
      ).session,
    ).toBeNull();
  });

  it('a question from outside the round, a re-sent answer, a replayed finish: no extra points', async () => {
    const me = await player();
    const round = (await get('/games/quiz/nn/round?size=3', me.phone)).json() as QuizRoundResponse;
    const outsider = (await quizBank(testDb.db, 'nn')).items.find(
      (it) => !round.questions.some((q) => q.itemId === it.id),
    )!;
    await post(
      '/games/quiz/nn/answer',
      {
        itemId: outsider.id,
        answer: outsider.correct,
        clientAnswerId: randomUUID(),
        sessionId: round.sessionId,
      },
      me.phone,
    );
    const items = (await quizBank(testDb.db, 'nn')).byId;
    const q = round.questions[0]!;
    const right = items.get(q.itemId)!.correct;
    const body = {
      itemId: q.itemId,
      answer: right,
      clientAnswerId: randomUUID(),
      sessionId: round.sessionId,
    };
    await post('/games/quiz/nn/answer', body, me.phone);
    await post('/games/quiz/nn/answer', body, me.laptop); // the network retried it
    const finished = (
      await post(
        '/games/quiz/nn/finish',
        { sessionId: round.sessionId, firstTryCorrect: 3 },
        me.phone,
      )
    ).json() as MiniGameFinishResponse;
    expect(finished).toEqual({ questionCount: 3, answered: 1, firstTryCorrect: 1, score: 10 });
    const again = (
      await post('/games/quiz/nn/finish', { sessionId: round.sessionId }, me.laptop)
    ).json() as MiniGameFinishResponse;
    expect(again).toEqual(finished);
    // A finished round is not continued.
    expect(
      (
        (
          await get('/games/quiz/nn/active', me.phone)
        ).json() as MiniGameActiveResponse<QuizQuestion>
      ).session,
    ).toBeNull();
  });

  it('«Ударения» keeps its rounds the same way', async () => {
    const me = await player();
    const round = (await get('/games/stress/round?size=5', me.phone)).json() as {
      sessionId: string;
      questions: { wordId: string }[];
    };
    await post(
      '/games/stress/answer',
      {
        wordId: round.questions[0]!.wordId,
        index: 0,
        clientAnswerId: randomUUID(),
        sessionId: round.sessionId,
      },
      me.phone,
    );
    const resumed = (
      await get('/games/stress/active', me.laptop)
    ).json() as MiniGameActiveResponse<{ wordId: string }>;
    expect(resumed.session!.questions.map((q) => q.wordId)).toEqual(
      round.questions.map((q) => q.wordId),
    );
    expect(resumed.session!.answered).toHaveLength(1);
  });
});
