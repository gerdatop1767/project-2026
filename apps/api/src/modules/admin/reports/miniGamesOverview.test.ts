import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createSeededTestDb } from '@zybrilka/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolvePeriod } from '../period.js';
import { ReportCache } from '../reportCache.js';
import { fixtures } from '../testFixtures.js';
import { miniGameQuestions } from './miniGameQuestions.js';
import { compareTotals, gameTotals, miniGamesOverview } from './miniGamesOverview.js';

// Moscow "today" = 2026-03-30; «7d» = 03-24…03-30, previous = 03-17…03-23.
const NOW = new Date('2026-03-30T09:00:00Z');
const at = (iso: string, plusSeconds = 0) => new Date(Date.parse(iso) + plusSeconds * 1000);
const Q = Array.from({ length: 8 }, () => randomUUID());

describe('admin mini-games: overview, per game, questions', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;

  /** A round with its first answers: [question, firstCorrect, attempts]. */
  async function round(
    userId: string | null,
    gameId: string,
    started: string,
    answers: [number, boolean, number?][],
    finishedAfterSeconds: number | null,
  ) {
    const [s] = await testDb.db
      .insert(schema.miniGameSessions)
      .values({
        gameId,
        mode: 'all',
        userId,
        questionCount: 10,
        answeredCount: answers.reduce((n, a) => n + (a[2] ?? 1), 0),
        correctCount: answers.filter((a) => a[1]).length,
        firstTryCorrect: finishedAfterSeconds === null ? null : answers.filter((a) => a[1]).length,
        startedAt: at(started),
        finishedAt: finishedAfterSeconds === null ? null : at(started, finishedAfterSeconds),
      })
      .returning();
    for (const [i, firstCorrect, attempts] of answers) {
      await testDb.db.insert(schema.miniGameRoundAnswers).values({
        sessionId: s!.id,
        gameId,
        itemId: Q[i]!,
        userId,
        firstCorrect,
        attempts: attempts ?? 1,
        answeredAt: at(started, 10),
      });
    }
  }

  beforeAll(async () => {
    testDb = await createSeededTestDb();
    const f = fixtures(testDb.db);
    const a = await f.user('2026-01-01T00:00:00Z');
    const b = await f.user('2026-01-01T00:00:00Z');
    // In «7d»:
    await round(
      a,
      'nn',
      '2026-03-28T10:00:00Z',
      [
        [0, false],
        [1, true],
        [2, true],
      ],
      120,
    );
    await round(
      a,
      'nn',
      '2026-03-29T10:00:00Z',
      [
        [0, false],
        [1, true],
      ],
      60,
    ); // a: 2 rounds
    await round(b, 'nn', '2026-03-29T12:00:00Z', [[0, true]], null); // left open
    await round(
      null,
      'nn',
      '2026-03-30T08:00:00Z',
      [
        [0, false],
        [3, true],
      ],
      90,
    ); // a guest
    await round(
      b,
      'stress',
      '2026-03-24T09:00:00Z',
      [
        [5, false, 2],
        [6, true],
      ],
      30,
    );
    // 23:30 UTC on 03-23 = 02:30 MSK on 03-24 → in «7d».
    await round(b, 'stress', '2026-03-23T23:30:00Z', [[5, true]], 40);
    // Previous period only:
    await round(a, 'nn', '2026-03-20T10:00:00Z', [[0, true]], 50);
  });
  afterAll(async () => {
    await testDb.close();
  });

  const period = () => resolvePeriod({ period: '7d' }, NOW);

  it('totals: launches with guests, players without, finished only when finished, questions once', async () => {
    const t = (await gameTotals(testDb.db, period())).get(null)!;
    expect(t).toMatchObject({
      launches: 6,
      guestLaunches: 1,
      players: 2, // a and b; the guest is not a player
      finished: 5, // b's open round is not finished
      solved: 11,
      correct: 7,
      wrong: 4,
      correctPercent: 63.6,
    });
    // Repeat players: a (2 nn rounds) and b (3 rounds over two games).
    expect(t.repeatPlayers).toBe(2);
    expect(t.avgQuestions).toBe(Math.round((11 / 6) * 10) / 10);
    const nn = (await gameTotals(testDb.db, period(), 'nn')).get('nn')!;
    expect(nn).toMatchObject({ launches: 4, players: 2, finished: 3, solved: 8, correct: 5 });
    expect(nn.repeatPlayers).toBe(1);
  });

  it('the previous period is compared; a share changes in points', async () => {
    const p = period();
    const cur = (await gameTotals(testDb.db, p, 'nn')).get('nn')!;
    const prev = (await gameTotals(testDb.db, p.previous, 'nn')).get('nn')!;
    expect(prev).toMatchObject({ launches: 1, solved: 1, correct: 1, correctPercent: 100 });
    const c = compareTotals(cur, prev);
    expect(c.launches).toEqual({ previous: 1, changePercent: 300 });
    expect(c.correctPercent).toEqual({ previous: 100, changePercent: -37.5 });
  });

  it('overview: per game, popular, success ranking only with enough answers, series by Moscow days', async () => {
    const o = await miniGamesOverview(testDb.db, period());
    const nn = o.games.find((g) => g.id === 'nn')!;
    expect(nn.launches).toBe(4);
    expect(o.popular[0]).toMatchObject({ id: 'nn', launches: 4 });
    expect(o.popular.map((g) => g.id)).toEqual(['nn', 'stress']);
    expect(o.bestSuccess).toEqual([]); // fewer than 20 answered questions each
    expect(o.series).toHaveLength(7);
    const day24 = o.series.find((s) => s.bucket === '2026-03-24')!;
    expect(day24).toMatchObject({ launches: 2, solved: 3, correct: 2 });
    const day30 = o.series.find((s) => s.bucket === '2026-03-30')!;
    expect(day30).toMatchObject({ launches: 1, guestLaunches: 1, players: 0 });
    expect(o.series.reduce((n, s) => n + s.launches, 0)).toBe(6);
    expect(o.questionsSince).not.toBeNull();
  });

  it('«Сегодня», «15 дней» and «Всё время» resolve to their own ranges', () => {
    expect(resolvePeriod({ period: 'today' }, NOW)).toMatchObject({
      from: '2026-03-30',
      to: '2026-03-30',
    });
    expect(resolvePeriod({ period: '15d' }, NOW)).toMatchObject({ from: '2026-03-16', days: 15 });
    expect(resolvePeriod({ period: 'all' }, NOW, { allFrom: '2026-03-20' })).toMatchObject({
      from: '2026-03-20',
      to: '2026-03-30',
    });
  });

  it('questions: hardest and easiest only with enough answers, mistakes and difficulties', async () => {
    const q = await miniGameQuestions(testDb.db, period(), 'nn');
    expect(q.questionsInRange).toBe(4);
    // Nothing reaches 5 answers in this small fixture.
    expect(q.hardest).toEqual([]);
    expect(q.mostMistakes[0]).toMatchObject({ itemId: Q[0], wrong: 3, answered: 4 });
    // a got Q0 wrong in two different rounds: a difficulty.
    expect(q.struggling[0]).toMatchObject({ itemId: Q[0], stuckPlayers: 1 });
    const stress = await miniGameQuestions(testDb.db, period(), 'stress');
    expect(stress.struggling.find((x) => x.itemId === Q[5])).toMatchObject({ retried: 1 });
  });
});

describe('admin report cache', () => {
  it('serves the same value within the ttl, rebuilds after, forgets failures', async () => {
    let t = 0;
    let builds = 0;
    const cache = new ReportCache(1000, 10, () => t);
    const build = async () => ++builds;
    expect(await cache.get('k', build)).toBe(1);
    t = 500;
    expect(await cache.get('k', build)).toBe(1);
    t = 1500;
    expect(await cache.get('k', build)).toBe(2);
    await expect(cache.get('x', async () => Promise.reject(new Error('no')))).rejects.toThrow();
    expect(await cache.get('x', build)).toBe(3);
  });
});
