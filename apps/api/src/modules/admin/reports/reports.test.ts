import { randomUUID } from 'node:crypto';
import { createSeededTestDb } from '@zybrilka/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolvePeriod } from '../period.js';
import { fixtures } from '../testFixtures.js';
import { growthReport } from './growth.js';
import { overviewReport } from './overview.js';

// "Today" is 2026-03-11 in Moscow. Period 7d = 03-05..03-11, previous 02-26..03-04.
const NOW = new Date('2026-03-11T09:00:00Z');

describe('admin reports: overview & growth', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;
  let f: ReturnType<typeof fixtures>;
  let t: { id: string }[];

  beforeAll(async () => {
    testDb = await createSeededTestDb();
    f = fixtures(testDb.db);
    t = await f.publishedTasks('math', 3);
    // Previous period: 1 registration, 1 answer.
    const old = await f.user('2026-02-27T10:00:00Z', 'email');
    await f.attempt(old, t[0]!.id, true, '2026-02-27T10:05:00Z');
    // Current period.
    const a = await f.user('2026-03-05T10:00:00Z', 'vk');
    const b = await f.user('2026-03-10T22:30:00Z', 'telegram'); // = 03-11 01:30 Moscow
    await f.attempt(a, t[0]!.id, false, '2026-03-05T10:01:00Z');
    await f.attempt(a, t[0]!.id, true, '2026-03-05T10:02:00Z');
    await f.attempt(a, t[1]!.id, true, '2026-03-06T10:00:00Z');
    await f.attempt(b, t[2]!.id, false, '2026-03-10T22:40:00Z'); // Moscow 03-11
    await f.attempt(old, t[1]!.id, true, '2026-03-11T08:00:00Z'); // returning user
    // A legacy anonymous row with an attempt: excluded everywhere.
    const legacy = await f.legacyAnonymous('2026-03-06T00:00:00Z');
    await f.attempt(legacy, t[0]!.id, true, '2026-03-06T00:10:00Z');
    // Guests (events).
    const v1 = randomUUID();
    const v2 = randomUUID();
    await f.guestAnswer(v1, t[0]!.id, true, '2026-03-09T12:00:00Z');
    await f.guestAnswer(v1, t[1]!.id, false, '2026-03-09T12:01:00Z');
    await f.guestAnswer(v2, t[0]!.id, false, '2026-03-11T05:00:00Z');
  });
  afterAll(async () => {
    await testDb.close();
  });

  it('overview counts registrations, answers, actives and solved tasks by its definitions', async () => {
    const r = await overviewReport(testDb.db, resolvePeriod({ period: '7d' }, NOW));
    expect(r.users.totalRegistered).toBe(3);
    expect(r.users.legacyAnonymousUsers).toBe(1);
    expect(r.users.registrations).toEqual({ current: 2, previous: 1, changePercent: 100 });
    expect(r.answers.registered.current).toBe(5);
    expect(r.answers.registered.previous).toBe(1);
    expect(r.answers.registeredCorrect.current).toBe(3);
    expect(r.answers.guests.current).toBe(3);
    expect(r.answers.guestsCorrect.current).toBe(1);
    // distinct (user, task) correct: a/t0, a/t1, old/t1
    expect(r.answers.solvedTasks.current).toBe(3);
    expect(r.answers.uniqueSolvers.current).toBe(3);
    expect(r.activeInPeriod.guests.current).toBe(2);
    // DAU = Moscow 03-11: b (22:40Z on 03-10) and old; guest v2.
    expect(r.active.dau).toMatchObject({ registered: 2, guests: 1, from: '2026-03-11' });
    expect(r.active.wau).toMatchObject({ registered: 3, guests: 2 });
    expect(r.series).toHaveLength(7);
    expect(r.guestData).toBe('partial'); // tracking started on 03-09
    const day = (d: string) => r.series.find((p) => p.bucket === d)!;
    expect(day('2026-03-05')).toMatchObject({ registrations: 1, correct: 1, incorrect: 1 });
    expect(day('2026-03-11')).toMatchObject({
      registrations: 1,
      activeRegistered: 2,
      activeGuests: 1,
    });
    expect(day('2026-03-07')).toMatchObject({ registrations: 0, correct: 0, activeGuests: 0 });
    expect(r.bySubject.find((s) => s.subjectId === 'math')).toMatchObject({
      answers: 5,
      correct: 3,
      guestAnswers: 3,
    });
    expect(r.bySource).toEqual([{ source: 'unknown', registrations: 2 }]);
  });

  it('reports a zero base as "no comparison", not 0% or ∞', async () => {
    const r = await overviewReport(
      testDb.db,
      resolvePeriod({ period: 'custom', from: '2026-01-01', to: '2026-01-31' }, NOW),
    );
    expect(r.users.registrations).toEqual({ current: 0, previous: 0, changePercent: null });
    // Events only exist from 03-09: January has no guest data at all.
    expect(r.guestData).toBe('none');
  });

  it('growth: cumulative totals, first training/solve, returning users', async () => {
    const r = await growthReport(testDb.db, resolvePeriod({ period: '7d' }, NOW));
    expect(r.totals).toMatchObject({
      registrations: 2,
      previousRegistrations: 1,
      totalUsersAtStart: 1,
      totalUsersAtEnd: 3,
    });
    const day = (d: string) => r.series.find((p) => p.bucket === d)!;
    expect(day('2026-03-05')).toMatchObject({ totalUsers: 2, firstTraining: 1, firstSolve: 1 });
    expect(day('2026-03-11')).toMatchObject({
      totalUsers: 3,
      activeRegistered: 2,
      returning: 1, // old was first active 02-27
      firstTraining: 1,
      firstSolve: 0,
    });
    expect(day('2026-03-09')).toMatchObject({ activeGuests: 1 });
    expect(r.byMethod).toEqual(
      expect.arrayContaining([
        { method: 'vk', registrations: 1 },
        { method: 'telegram', registrations: 1 },
      ]),
    );
  });
});
