import { randomUUID } from 'node:crypto';
import { importStressDictionary, schema } from '@zybrilka/db';
import { createTestDb } from '@zybrilka/db/testing';
import type {
  MiniGamesResponse,
  StressAnswerResponse,
  StressProgressResponse,
  StressRoundResponse,
} from '@zybrilka/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';

describe('mini-games — «Ударения»', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let stressIndexOf: Map<string, number>;

  beforeAll(async () => {
    testDb = await createTestDb();
    await importStressDictionary(testDb.db);
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test', WEB_BASE_URL: 'https://zybrilka.test' }),
    });
    const words = await testDb.db.select().from(schema.stressWords);
    stressIndexOf = new Map(words.map((w) => [w.id, w.stressIndex]));
  });
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  async function player() {
    const [user] = await testDb.db.insert(schema.users).values({}).returning();
    const id = randomUUID();
    await testDb.db
      .insert(schema.authSessions)
      .values({ id, userId: user!.id, expiresAt: new Date(Date.now() + 3_600_000) });
    return { id: user!.id, cookie: `session_id=${id}` };
  }
  const get = (url: string, cookie?: string) =>
    app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });
  const round = async (cookie?: string, q = 'mode=all&size=20') =>
    (await get(`/api/v1/games/stress/round?${q}`, cookie)).json() as StressRoundResponse;
  const answer = (
    cookie: string | undefined,
    wordId: string,
    right: boolean,
    clientAnswerId: string = randomUUID(),
  ) => {
    const correct = stressIndexOf.get(wordId)!;
    return app.inject({
      method: 'POST',
      url: '/api/v1/games/stress/answer',
      headers: cookie ? { cookie } : {},
      payload: { wordId, index: right ? correct : correct === 0 ? 1 : 0, clientAnswerId },
    });
  };

  it('the hub lists the game with its subject; progress only for a player', async () => {
    const guest = (await get('/api/v1/games')).json() as MiniGamesResponse;
    expect(guest.games[0]).toMatchObject({
      id: 'stress',
      subjectName: 'Русский язык',
      progress: null,
    });
    const me = await player();
    const mine = (await get('/api/v1/games', me.cookie)).json() as MiniGamesResponse;
    expect(mine.games[0]!.progress).toEqual({ learned: 0, total: stressIndexOf.size });
  });

  it('a round is shuffled, never carries the answer, and shows «ё» as «е»', async () => {
    const a = await round();
    const b = await round();
    expect(a.questions).toHaveLength(20);
    expect(a.dictionarySize).toBe(stressIndexOf.size);
    const text = JSON.stringify(a);
    expect(text).not.toMatch(/stressIndex|marked|correct/);
    expect(text).not.toContain('ё');
    for (const q of a.questions) {
      expect(q.vowels.length).toBeGreaterThanOrEqual(2);
      expect(q.display).toBe(q.display.toLowerCase());
    }
    expect(a.questions.map((q) => q.wordId)).not.toEqual(b.questions.map((q) => q.wordId));
    const ids = a.questions.map((q) => q.wordId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('checks on the server; a guest is told the answer but nothing is saved', async () => {
    const wordId = (await round()).questions[0]!.wordId;
    const res = await answer(undefined, wordId, false);
    expect(res.statusCode).toBe(200);
    const body = res.json() as StressAnswerResponse;
    expect(body).toMatchObject({ correct: false, recorded: false });
    expect(body.correctIndex).toBe(stressIndexOf.get(wordId));
    expect(body.marked).toMatch(/[А-ЯЁ]/);
    expect(await testDb.db.select().from(schema.miniGameAnswers)).toHaveLength(0);
    // Personal modes and progress need an account.
    expect((await get('/api/v1/games/stress/round?mode=mistakes')).statusCode).toBe(401);
    expect((await get('/api/v1/games/stress/progress')).statusCode).toBe(401);
  });

  it('records progress; a re-sent answer counts once; mistakes and hard words follow', async () => {
    const me = await player();
    const [w1, w2, w3] = (await round(me.cookie)).questions.map((q) => q.wordId);
    const retry = randomUUID();
    await answer(me.cookie, w1!, false, retry);
    await answer(me.cookie, w1!, false, retry); // double tap / network retry
    await answer(me.cookie, w1!, false);
    await answer(me.cookie, w2!, true);
    await answer(me.cookie, w2!, true);
    await answer(me.cookie, w3!, false);
    await answer(me.cookie, w3!, true);

    const progress = (
      await get('/api/v1/games/stress/progress', me.cookie)
    ).json() as StressProgressResponse;
    expect(progress).toMatchObject({
      learned: 1, // w2: two right in a row
      seen: 3,
      answers: 6,
      correct: 3,
      wrong: 3,
      accuracyPercent: 50,
      mistakes: 1, // w1 (w3's last answer was right)
    });
    expect(progress.hardWords.map((h) => h.wordId)).toEqual([w1, w3]);
    expect(progress.daily).toHaveLength(1);
    expect(progress.daily[0]).toMatchObject({ answers: 6, correct: 3 });

    const mistakes = await round(me.cookie, 'mode=mistakes&size=20');
    expect(mistakes.questions.map((q) => q.wordId)).toEqual([w1]);
    const hard = await round(me.cookie, 'mode=hard&size=20');
    expect(hard.questions.map((q) => q.wordId).sort()).toEqual([w1, w3].sort());

    // «Все слова» puts what is not learned yet first: w2 is not in a
    // round smaller than the not-yet-learned pool.
    for (let i = 0; i < 5; i++) {
      const next = await round(me.cookie, 'mode=all&size=40');
      expect(next.questions.map((q) => q.wordId)).not.toContain(w2);
    }
    // Another player's progress is separate.
    const other = await player();
    const theirs = (
      await get('/api/v1/games/stress/progress', other.cookie)
    ).json() as StressProgressResponse;
    expect(theirs.answers).toBe(0);
  });

  it('only playable words: a deactivated or disputed one is never asked or graded', async () => {
    const [word] = await testDb.db.select().from(schema.stressWords).limit(1);
    await testDb.db
      .update(schema.stressWords)
      .set({ stressStatus: 'disputed' })
      .where(eq(schema.stressWords.id, word!.id));
    for (let i = 0; i < 3; i++) {
      const r = await round(undefined, 'mode=all&size=40');
      expect(r.questions.map((q) => q.wordId)).not.toContain(word!.id);
      expect(r.dictionarySize).toBe(stressIndexOf.size - 1);
    }
    expect((await answer(undefined, word!.id, true)).statusCode).toBe(404);
    await testDb.db
      .update(schema.stressWords)
      .set({ stressStatus: 'confirmed' })
      .where(eq(schema.stressWords.id, word!.id));
  });

  it('rejects malformed input and cross-site posts', async () => {
    const wordId = [...stressIndexOf.keys()][0]!;
    for (const payload of [
      { wordId, index: -1, clientAnswerId: randomUUID() },
      { wordId: 'x', index: 1, clientAnswerId: randomUUID() },
      { wordId, index: 1 },
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/games/stress/answer',
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
    for (const q of ['mode=x', 'size=1000', 'size=1']) {
      expect((await get(`/api/v1/games/stress/round?${q}`)).statusCode, q).toBe(400);
    }
    const forged = await app.inject({
      method: 'POST',
      url: '/api/v1/games/stress/answer',
      headers: { 'sec-fetch-site': 'cross-site' },
      payload: { wordId, index: 1, clientAnswerId: randomUUID() },
    });
    expect(forged.statusCode).toBe(403);
  });
});
