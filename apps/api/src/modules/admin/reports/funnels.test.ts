import { createSeededTestDb } from '@zybrilka/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolvePeriod } from '../period.js';
import { fixtures } from '../testFixtures.js';
import { funnelReport, retentionReport } from './funnels.js';

// Moscow "today" = 2026-03-30.
const NOW = new Date('2026-03-30T09:00:00Z');

describe('funnels and retention', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;
  let f: ReturnType<typeof fixtures>;

  beforeAll(async () => {
    testDb = await createSeededTestDb();
    f = fixtures(testDb.db);
    const [t] = await f.publishedTasks('math', 1);
    const task = t!.id;
    // Visitor A: full guest path, 5 answers, comes back the next day, registers.
    const a = await f.visitor('2026-03-20T10:00:00Z');
    await f.event('visit', '2026-03-20T10:00:00Z', { visitorId: a });
    await f.event('subject_selected', '2026-03-20T10:01:00Z', { visitorId: a, subjectId: 'math' });
    await f.event('task_started', '2026-03-20T10:02:00Z', { visitorId: a, taskId: task });
    for (let i = 0; i < 5; i++) await f.guestAnswer(a, task, i > 2, `2026-03-20T10:0${3 + i}:00Z`);
    await f.event('visit', '2026-03-21T10:00:00Z', { visitorId: a });
    await f.event('registration_completed', '2026-03-21T10:05:00Z', { visitorId: a });
    // Visitor B: visits only.
    const b = await f.visitor('2026-03-25T10:00:00Z');
    await f.event('visit', '2026-03-25T10:00:00Z', { visitorId: b });
    // Visitor C: before the period.
    const c = await f.visitor('2026-01-05T10:00:00Z');
    await f.event('visit', '2026-01-05T10:00:00Z', { visitorId: c });

    // Registered cohort: u1 registered 03-02, active 03-02, 03-03 (D1), 03-09 (D7).
    const u1 = await f.user('2026-03-02T07:00:00Z');
    await f.attempt(u1, task, true, '2026-03-02T08:00:00Z');
    await f.attempt(u1, task, true, '2026-03-03T08:00:00Z');
    await f.attempt(u1, task, false, '2026-03-09T08:00:00Z');
    // u2 registered 03-03, single day.
    const u2 = await f.user('2026-03-03T07:00:00Z');
    await f.attempt(u2, task, false, '2026-03-03T08:00:00Z');
    // u3 registered 03-28: too young for D7.
    await f.user('2026-03-28T07:00:00Z');
  });
  afterAll(async () => {
    await testDb.close();
  });

  it('visitor funnel: cohort = browsers first seen in the period', async () => {
    const r = await funnelReport(testDb.db, resolvePeriod({ period: '30d' }, NOW));
    const steps = Object.fromEntries(r.visitors.map((s) => [s.key, s.count]));
    expect(steps).toEqual({
      visit: 2,
      subject: 1,
      task: 1,
      a1: 1,
      a5: 1,
      a10: 0,
      registered: 1,
      returned: 1,
    });
    expect(r.visitors[1]).toMatchObject({ fromPrevious: 0.5, fromStart: 0.5, dropOff: 1 });
    expect(r.visitors[5]!.fromPrevious).toBe(0);
    expect(r.guests).toEqual({ visitors: 1, answered: 0, returned: 0 });
  });

  it('registered funnel uses full history', async () => {
    const r = await funnelReport(testDb.db, resolvePeriod({ period: '30d' }, NOW));
    const steps = Object.fromEntries(r.registered.map((s) => [s.key, s.count]));
    expect(steps).toMatchObject({ registered: 3, a1: 2, a5: 0, returned: 1 });
  });

  it('retention: classic D1/D7 per user, unknown while the cohort is too young', async () => {
    const r = await retentionReport(
      testDb.db,
      { cohort: 'week', basis: 'registration', count: 8 },
      NOW,
    );
    const week = r.cohorts.find((c) => c.cohort === '2026-03-02')!;
    expect(week.size).toBe(2);
    expect(week.d1).toBe(0.5);
    expect(week.d7).toBe(0.5);
    expect(week.d30).toBeNull(); // 03-08 + 30 is in the future
    const young = r.cohorts.find((c) => c.cohort === '2026-03-23')!;
    expect(young.size).toBe(1);
    expect(young.d7).toBeNull();
  });
});
