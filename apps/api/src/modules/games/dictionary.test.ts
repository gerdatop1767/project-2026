import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createTestDb } from '@zybrilka/db/testing';
import type {
  DictionaryAnswerResponse,
  DictionaryQuestion,
  DictionaryReferenceResponse,
  DictionaryRoundResponse,
  DictionarySummaryResponse,
  MiniGameActiveResponse,
  MiniGameFinishResponse,
  MiniGameRatingResponse,
  MiniGamesResponse,
} from '@zybrilka/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { dictionaryItemById } from './dictionary.js';

/** «Словарные слова и исключения» (docs/DICTIONARY_GAME.md). */
describe('mini-game «Словарные слова и исключения»', { timeout: 120_000 }, () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let app: ReturnType<typeof buildApp>;

  async function player(firstName = 'Игрок') {
    const [user] = await testDb.db.insert(schema.users).values({ firstName }).returning();
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
  const post = (url: string, payload: object, cookie?: string) =>
    app.inject({
      method: 'POST',
      url: `/api/v1${url}`,
      payload,
      headers: cookie ? { cookie } : {},
    });
  const round = async (query: string, cookie?: string) =>
    (await get(`/games/dictionary/round?${query}`, cookie)).json() as DictionaryRoundResponse;
  const answer = async (
    r: DictionaryRoundResponse,
    q: DictionaryQuestion,
    right: boolean,
    cookie?: string,
  ) => {
    const item = dictionaryItemById(q.itemId)!;
    const text = right ? item.correct : q.options.find((o) => o !== item.correct)!;
    return (
      await post(
        '/games/dictionary/answer',
        { itemId: q.itemId, answer: text, clientAnswerId: randomUUID(), sessionId: r.sessionId },
        cookie,
      )
    ).json() as DictionaryAnswerResponse;
  };

  beforeAll(async () => {
    testDb = await createTestDb();
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test', WEB_BASE_URL: 'https://zybrilka.test' }),
    });
  });
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  it('is one game in the hub, with the task chosen inside it', async () => {
    const hub = (await get('/games')).json() as MiniGamesResponse;
    const card = hub.games.find((g) => g.id === 'dictionary')!;
    expect(card.questionCount).toBeGreaterThan(1000);
    const summary = (await get('/games/dictionary/summary')).json() as DictionarySummaryResponse;
    expect(summary.tasks.map((t) => t.taskNumber)).toEqual([9, 10, 12, 13, 14, 15]);
    expect(summary.tasks.every((t) => t.learned === null && t.categories.length > 1)).toBe(true);
  });

  it('a round of one task asks different words; the answer comes with the rule and a memory aid', async () => {
    const me = await player();
    const r = await round('task=9&size=20', me.phone);
    expect(r.questions).toHaveLength(20);
    const items = r.questions.map((q) => dictionaryItemById(q.itemId)!);
    expect(items.every((it) => it.taskNumber === 9)).toBe(true);
    expect(new Set(items.map((it) => it.word.key)).size).toBe(20);
    // The question carries no key.
    expect(JSON.stringify(r.questions[0])).not.toContain('correct');

    const res = await answer(r, r.questions[0]!, false, me.phone);
    expect(res.correct).toBe(false);
    expect(res.recorded).toBe(true);
    expect(res.correctOption).toBe(items[0]!.correct);
    expect(res.explanation.length).toBeGreaterThan(10);
    expect(res.word).toBe(items[0]!.word.word);
  });

  it('a group on its own; an unknown task or group is 404; more than there is — the real limit', async () => {
    const r = await round('task=15&category=nn&size=5');
    expect(r.questions.every((q) => dictionaryItemById(q.itemId)!.categoryId === 'nn')).toBe(true);
    expect((await get('/games/dictionary/round?task=11')).statusCode).toBe(404);
    expect((await get('/games/dictionary/round?task=9&category=nope')).statusCode).toBe(404);
    const tooMany = await get('/games/dictionary/round?task=14&category=apart&size=500');
    expect(tooMany.statusCode).toBe(409);
    expect((tooMany.json() as { available: number }).available).toBeLessThan(500);
    expect((await get('/games/dictionary/round?task=9&mode=mistakes')).statusCode).toBe(401);
  });

  it('«Мои ошибки» returns the questions answered wrong; «Продолжить» on another device', async () => {
    const me = await player();
    const r = await round('task=12&size=6', me.phone);
    await answer(r, r.questions[0]!, false, me.phone);
    await answer(r, r.questions[1]!, true, me.phone);
    const resumed = (
      await get('/games/dictionary/active', me.laptop)
    ).json() as MiniGameActiveResponse<DictionaryQuestion>;
    expect(resumed.session!.questions.map((q) => q.itemId)).toEqual(
      r.questions.map((q) => q.itemId),
    );
    expect(resumed.session!.answered.map((a) => a.firstCorrect)).toEqual([false, true]);
    expect(resumed.session!.mode).toBe('12:all:all');

    const mistakes = await round('task=12&mode=mistakes&size=10', me.phone);
    expect(mistakes.questions.map((q) => q.itemId)).toEqual([r.questions[0]!.itemId]);
  });

  it('points once per round, counted by the server; its own rating; the best round per task', async () => {
    const me = await player('Словарь');
    const r = await round('task=13&size=5', me.phone);
    for (const [i, q] of r.questions.entries()) await answer(r, q, i < 4, me.phone);
    // A retry of the wrong one, and a re-sent first answer: no extra points.
    await answer(r, r.questions[4]!, true, me.phone);
    const finish = (
      await post(
        '/games/dictionary/finish',
        { sessionId: r.sessionId, firstTryCorrect: 5 },
        me.phone,
      )
    ).json() as MiniGameFinishResponse;
    expect(finish).toEqual({ questionCount: 5, answered: 5, firstTryCorrect: 4, score: 40 });
    await post('/games/dictionary/finish', { sessionId: r.sessionId }, me.laptop);
    const rating = (
      await get('/games/dictionary/rating?kind=total', me.phone)
    ).json() as MiniGameRatingResponse;
    expect(rating.me).toMatchObject({ points: 40, rounds: 1 });

    const summary = (
      await get('/games/dictionary/summary', me.phone)
    ).json() as DictionarySummaryResponse;
    expect(summary.tasks.find((t) => t.taskNumber === 13)!.bestScore).toBe(40);
    expect(summary.tasks.find((t) => t.taskNumber === 9)!.bestScore).toBeNull();
  });

  it('a word is learned after two right answers in a row', async () => {
    const me = await player();
    const r1 = await round('task=10&size=3', me.phone);
    const q = r1.questions[0]!;
    await answer(r1, q, true, me.phone);
    const r2 = await round('task=10&size=3', me.phone);
    await post(
      '/games/dictionary/answer',
      {
        itemId: q.itemId,
        answer: dictionaryItemById(q.itemId)!.correct,
        clientAnswerId: randomUUID(),
        sessionId: r2.sessionId,
      },
      me.phone,
    );
    const [p] = await testDb.db
      .select()
      .from(schema.miniGameItemProgress)
      .where(
        and(
          eq(schema.miniGameItemProgress.userId, me.id),
          eq(schema.miniGameItemProgress.itemId, q.itemId),
        ),
      );
    expect(p!.streak).toBe(2);
    const summary = (
      await get('/games/dictionary/summary', me.phone)
    ).json() as DictionarySummaryResponse;
    expect(summary.tasks.find((t) => t.taskNumber === 10)!.learned).toBe(1);
  });

  it('«Справочник»: every word of a task by group, with its rule', async () => {
    const res = await get('/games/dictionary/reference/14');
    expect(res.statusCode).toBe(200);
    const ref = res.json() as DictionaryReferenceResponse;
    expect(ref.categories.length).toBeGreaterThan(1);
    expect(ref.categories.flatMap((c) => c.words.map((w) => w.word))).toContain('крест-накрест');
    expect((await get('/games/dictionary/reference/11')).statusCode).toBe(404);
  });

  it('a guest plays without anything stored', async () => {
    const r = await round('task=14&size=3');
    const res = await answer(r, r.questions[0]!, true);
    expect(res).toMatchObject({ correct: true, recorded: false });
  });
});
