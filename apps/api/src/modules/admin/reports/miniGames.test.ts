import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createSeededTestDb } from '@zybrilka/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolvePeriod } from '../period.js';
import { fixtures } from '../testFixtures.js';
import { miniGamesReport } from './miniGames.js';

// Moscow "today" = 2026-03-30; «7d» = 2026-03-24 … 2026-03-30.
const NOW = new Date('2026-03-30T09:00:00Z');
const at = (iso: string, plusSeconds = 0) => new Date(Date.parse(iso) + plusSeconds * 1000);

describe('admin mini-game statistics', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;

  async function session(
    userId: string | null,
    started: string,
    q: number,
    answered: number,
    correct: number,
    finishedAfterSeconds: number | null,
    gameId = 'stress',
  ) {
    await testDb.db.insert(schema.miniGameSessions).values({
      gameId,
      mode: 'all',
      userId,
      questionCount: q,
      answeredCount: answered,
      correctCount: correct,
      // In these fixtures the first-try result equals the right answers.
      firstTryCorrect: finishedAfterSeconds === null ? null : correct,
      startedAt: at(started),
      finishedAt: finishedAfterSeconds === null ? null : at(started, finishedAfterSeconds),
    });
  }
  async function answer(userId: string, when: string, correct: boolean) {
    await testDb.db.insert(schema.miniGameAnswers).values({
      userId,
      gameId: 'stress',
      itemId: randomUUID(),
      correct,
      answer: '1',
      clientAnswerId: randomUUID(),
      createdAt: at(when),
    });
  }

  beforeAll(async () => {
    testDb = await createSeededTestDb();
    const f = fixtures(testDb.db);
    const a = await f.user('2026-01-01T00:00:00Z');
    const b = await f.user('2026-01-01T00:00:00Z');
    const c = await f.user('2026-01-01T00:00:00Z');
    const legacy = await f.legacyAnonymous('2026-01-01T00:00:00Z');

    await session(a, '2026-03-01T10:00:00Z', 10, 10, 10, 30); // before the period
    await session(a, '2026-03-28T10:00:00Z', 10, 10, 8, 120); // 80 %
    await session(a, '2026-03-29T10:00:00Z', 10, 10, 3, 60); // 30 %
    await session(b, '2026-03-29T12:00:00Z', 10, 2, 1, null); // left open
    await session(null, '2026-03-30T08:00:00Z', 5, 5, 5, 90); // a guest, 100 %
    await session(a, '2026-03-29T10:00:00Z', 10, 10, 10, 30, 'other-game'); // another game

    await answer(a, '2026-03-01T10:00:00Z', true); // a's first day, before the period
    await answer(a, '2026-03-23T22:30:00Z', false); // 01:30 MSK on 03-24: in the period
    await answer(a, '2026-03-28T10:00:00Z', true);
    await answer(a, '2026-03-28T10:01:00Z', false);
    await answer(a, '2026-03-29T10:00:00Z', true);
    await answer(b, '2026-03-29T10:00:00Z', false); // b's first day
    await answer(b, '2026-03-30T07:00:00Z', true);
    await answer(c, '2026-03-20T10:00:00Z', true); // c's first day
    await answer(c, '2026-03-22T10:00:00Z', true);
    await answer(c, '2026-03-23T20:00:00Z', true); // 23:00 MSK on 03-23: outside 7d
    await answer(legacy, '2026-03-29T10:00:00Z', true); // never counted
  });
  afterAll(async () => {
    await testDb.close();
  });

  it('rounds: launches, players, repeats, finished, results, time — from the session log', async () => {
    const r = await miniGamesReport(testDb.db, resolvePeriod({ period: '7d' }, NOW), 'stress', NOW);
    expect(r.sessionsSince).toMatch(/^2026-03-01/);
    expect(r.rounds).toMatchObject({
      launches: 4,
      guestLaunches: 1,
      players: 2,
      repeatPlayers: 1,
      repeatPlayersPercent: 50,
      launchesPerPlayer: 1.5,
      finished: 3,
      finishedPercent: 75,
      avgCorrect: 5.3, // (8 + 3 + 5) / 3
      avgQuestions: 8.3,
      correctPercent: 63, // 17 of 27 answers
      avgSeconds: 90,
      medianSeconds: 90,
    });
    expect(r.rounds.results.map((b) => b.rounds)).toEqual([0, 1, 0, 0, 2]);
    expect(r.rounds.modes).toEqual([{ mode: 'all', launches: 4, finished: 3 }]);
  });

  it('answers: players, new players, accuracy, multi-day players — Moscow days, registered only', async () => {
    const r = await miniGamesReport(testDb.db, resolvePeriod({ period: '7d' }, NOW), 'stress', NOW);
    expect(r.answersSince).toMatch(/^2026-03-01/);
    expect(r.answers).toMatchObject({
      players: 2,
      newPlayers: 1,
      answers: 6,
      correctPercent: 50,
      multiDayPlayers: 2,
      multiDayPercent: 100,
    });
    const day = (d: string) => r.daily.find((x) => x.day === d)!;
    expect(r.daily).toHaveLength(7);
    expect(day('2026-03-24')).toMatchObject({ launches: 0, players: 1, answers: 1, correct: 0 });
    expect(day('2026-03-29')).toMatchObject({
      launches: 2,
      finished: 1,
      sessionPlayers: 2,
      players: 2,
      answers: 2,
      correct: 1,
    });
    expect(day('2026-03-30')).toMatchObject({
      launches: 1,
      finished: 1,
      sessionPlayers: 0,
      players: 1,
    });
  });

  it('returning: next day and within 7 days, only for first-timers who had 7 days to come back', async () => {
    const r = await miniGamesReport(
      testDb.db,
      resolvePeriod({ period: 'custom', from: '2026-03-01', to: '2026-03-30' }, NOW),
      'stress',
      NOW,
    );
    expect(r.answers.returning).toEqual({
      cohort: 3,
      d1: 1, // b
      d1Percent: 33.3,
      eligible7: 2, // a, c (b started 03-29)
      d7: 1, // c
      d7Percent: 50,
    });
  });

  it('an empty game reports zeros and no history, not invented numbers', async () => {
    const r = await miniGamesReport(
      testDb.db,
      resolvePeriod({ period: '7d' }, NOW),
      'nothing',
      NOW,
    );
    expect(r.sessionsSince).toBeNull();
    expect(r.answersSince).toBeNull();
    expect(r.rounds).toMatchObject({
      launches: 0,
      players: 0,
      finishedPercent: null,
      correctPercent: null,
      avgSeconds: null,
      launchesPerPlayer: null,
    });
    expect(r.answers.returning.d1Percent).toBeNull();
  });
});
