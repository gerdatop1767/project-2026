import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importStressDictionary, schema } from '@zybrilka/db';
import { createTestDb } from '@zybrilka/db/testing';
import type { MiniGameRatingResponse, StressRoundResponse } from '@zybrilka/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';

/**
 * A mini-game's own ratings (docs/MINI_GAMES.md § Рейтинги): the best
 * finished round and all-time points, counted by the server once per
 * round, never mixed between games.
 */
describe('mini-games — ratings', { timeout: 120_000 }, () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let stressOf: Map<string, number>;

  async function player(firstName: string) {
    const [user] = await testDb.db.insert(schema.users).values({ firstName }).returning();
    const id = randomUUID();
    await testDb.db
      .insert(schema.authSessions)
      .values({ id, userId: user!.id, expiresAt: new Date(Date.now() + 3_600_000) });
    return { id: user!.id, cookie: `session_id=${id}` };
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

  /** A finished «Ударения» round of `size` words, `right` of them right. */
  async function playRound(cookie: string, size: number, right: number) {
    const round = (
      await get(`/games/stress/round?size=${size}`, cookie)
    ).json() as StressRoundResponse;
    for (const [i, q] of round.questions.entries()) {
      const stress = stressOf.get(q.wordId)!;
      const index = i < right ? stress : q.vowels.find((v) => v !== stress)!;
      await post(
        '/games/stress/answer',
        { wordId: q.wordId, index, clientAnswerId: randomUUID(), sessionId: round.sessionId },
        cookie,
      );
    }
    const finish = await post('/games/stress/finish', { sessionId: round.sessionId }, cookie);
    return { sessionId: round.sessionId!, result: finish.json() as { score: number } };
  }
  const rating = async (kind: 'best' | 'total', cookie?: string, game = 'stress') =>
    (await get(`/games/${game}/rating?kind=${kind}`, cookie)).json() as MiniGameRatingResponse;

  beforeAll(async () => {
    testDb = await createTestDb();
    await importStressDictionary(testDb.db);
    const words = await testDb.db
      .select({ id: schema.stressWords.id, stressIndex: schema.stressWords.stressIndex })
      .from(schema.stressWords);
    stressOf = new Map(words.map((w) => [w.id, w.stressIndex]));
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

  it('the best round and the all-time total are two separate ratings', async () => {
    const anna = await player('Анна');
    const boris = await player('Борис');
    expect((await playRound(anna.cookie, 5, 5)).result.score).toBe(70); // 5×10 + 20 perfect
    expect((await playRound(anna.cookie, 5, 2)).result.score).toBe(20);
    expect((await playRound(boris.cookie, 5, 3)).result.score).toBe(30);
    expect((await playRound(boris.cookie, 10, 6)).result.score).toBe(60);

    const best = await rating('best', anna.cookie);
    expect(best.entries.map((e) => [e.rank, e.name, e.points])).toEqual([
      [1, 'Анна', 70],
      [2, 'Борис', 60],
    ]);
    expect(best.entries[0]).toMatchObject({
      bestCorrect: 5,
      bestQuestions: 5,
      bestAccuracyPercent: 100,
      rounds: 2,
      isMe: true,
    });
    expect(best.me).toMatchObject({ rank: 1, points: 70 });

    const total = await rating('total', boris.cookie);
    // 70 + 20 = 90 and 30 + 60 = 90: one place; the earlier record first.
    expect(total.entries.map((e) => [e.rank, e.name, e.points])).toEqual([
      [1, 'Анна', 90],
      [1, 'Борис', 90],
    ]);
    expect(total.me).toMatchObject({ rank: 1, points: 90, isMe: true });
  });

  it('equal values share a place', async () => {
    const total = await rating('total');
    // Анна 70+20 = 90, Борис 30+60 = 90: both first.
    expect(total.entries.map((e) => e.rank)).toEqual([1, 1]);
    expect(total.players).toBe(2);
    expect(total.me).toBeNull(); // a guest
  });

  it('a replayed «finish» or a re-sent answer adds nothing', async () => {
    const vera = await player('Вера');
    const { sessionId } = await playRound(vera.cookie, 5, 4);
    await post('/games/stress/finish', { sessionId }, vera.cookie);
    await post('/games/stress/finish', { sessionId, firstTryCorrect: 5 }, vera.cookie);
    const [row] = await testDb.db
      .select()
      .from(schema.miniGameScores)
      .where(eq(schema.miniGameScores.userId, vera.id));
    expect(row).toMatchObject({ bestScore: 40, totalPoints: 40, rounds: 1 });
  });

  it('a game’s ratings are its own: another game shows none of these points', async () => {
    const other = await rating('best', undefined, 'nn');
    expect(other.entries).toEqual([]);
    expect(other.players).toBe(0);
    expect((await get('/games/no-such-game/rating')).statusCode).toBe(404);
    expect((await get('/games/stress/rating?kind=week')).statusCode).toBe(400);
  });

  it('a player with no finished round is not ranked but sees an empty «me»', async () => {
    const newbie = await player('Новичок');
    expect((await rating('best', newbie.cookie)).me).toBeNull();
  });

  it('migration 0047 ranks earlier rounds from their recorded first answers only', async () => {
    const gleb = await player('Глеб');
    // A round finished before the ratings existed: first answers on record,
    // and a client-sent number (9) that must not be believed.
    const [session] = await testDb.db
      .insert(schema.miniGameSessions)
      .values({
        gameId: 'stress',
        mode: 'all',
        userId: gleb.id,
        questionCount: 3,
        firstTryCorrect: 9,
        finishedAt: new Date('2026-11-01T10:00:00Z'),
      })
      .returning();
    const words = [...stressOf.keys()].slice(0, 3);
    await testDb.db.insert(schema.miniGameRoundAnswers).values(
      words.map((itemId, i) => ({
        sessionId: session!.id,
        gameId: 'stress',
        itemId,
        userId: gleb.id,
        firstCorrect: i < 2,
      })),
    );
    const file = fileURLToPath(
      new URL('../../../../../packages/db/migrations/0047_mini_game_scores.sql', import.meta.url),
    );
    const backfill = readFileSync(file, 'utf8').split('--> statement-breakpoint').at(-1)!;
    await testDb.db.execute(sql.raw(backfill));
    const [row] = await testDb.db
      .select()
      .from(schema.miniGameScores)
      .where(eq(schema.miniGameScores.userId, gleb.id));
    expect(row).toMatchObject({ bestScore: 20, bestCorrect: 2, bestQuestions: 3, totalPoints: 20 });
  });
});
