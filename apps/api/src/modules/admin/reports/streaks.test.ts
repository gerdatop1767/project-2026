import { schema } from '@zybrilka/db';
import { createSeededTestDb } from '@zybrilka/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, resolvePeriod } from '../period.js';
import { fixtures } from '../testFixtures.js';
import { streaksReport } from './streaks.js';

// Moscow "today" = 2026-03-30.
const NOW = new Date('2026-03-30T09:00:00Z');
const TODAY = '2026-03-30';

describe('admin streak analytics (from user_daily_activity, the app’s own source)', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;

  async function activeDays(userId: string, lastDay: string, count: number) {
    for (let i = 0; i < count; i++) {
      await testDb.db
        .insert(schema.userDailyActivity)
        .values({ userId, activityDate: addDays(lastDay, -i) });
    }
  }

  beforeAll(async () => {
    testDb = await createSeededTestDb();
    const f = fixtures(testDb.db);
    // a: 5 days ending today → tier 2. Earlier 12-day run (best).
    const a = await f.user('2026-01-01T00:00:00Z');
    await activeDays(a, TODAY, 5);
    await activeDays(a, '2026-03-10', 12);
    // b: 1 day ending yesterday → still holds a streak of 1 (tier 1).
    const b = await f.user('2026-01-01T00:00:00Z');
    await activeDays(b, addDays(TODAY, -1), 1);
    // c: 60 days ending today → tier 6.
    const c = await f.user('2026-01-01T00:00:00Z');
    await activeDays(c, TODAY, 60);
    // d: last active 3 days ago → no current streak.
    const d = await f.user('2026-01-01T00:00:00Z');
    await activeDays(d, addDays(TODAY, -3), 4);
    // A legacy anonymous row never counts.
    const legacy = await f.legacyAnonymous('2026-01-01T00:00:00Z');
    await activeDays(legacy, TODAY, 30);
  });
  afterAll(async () => {
    await testDb.close();
  });

  it('current streaks follow the app rule; tiers, avg, median, max', async () => {
    const r = await streaksReport(testDb.db, resolvePeriod({ period: '7d' }, NOW), NOW);
    expect(r.totals).toEqual({
      trackedUsers: 4,
      activeStreaks: 3,
      averageCurrent: 22, // (5 + 1 + 60) / 3
      medianCurrent: 5,
      longestCurrent: 60,
      longestEver: 60,
    });
    const users = Object.fromEntries(r.tiers.map((t) => [t.label, t.users]));
    expect(users).toEqual({ '1–4': 1, '5–14': 1, '15–29': 0, '30–39': 0, '40–59': 0, '60+': 1 });
    expect(r.top.map((t) => [t.current, t.best])).toEqual([
      [60, 60],
      [5, 12],
      [1, 1],
    ]);
  });

  it('daily dynamics: streak held on each day of the period', async () => {
    const r = await streaksReport(testDb.db, resolvePeriod({ period: '7d' }, NOW), NOW);
    expect(r.daily).toHaveLength(7);
    const day = (d: string) => r.daily.find((x) => x.day === d)!;
    // 03-30: a(5), b(1, yesterday), c(60) → 3 holders, 2 with 5+.
    expect(day(TODAY)).toMatchObject({ active: 3, fivePlus: 2 });
    // 03-27: a not yet (run starts 03-26? 5 days ending 03-30 = 03-26..30 → 2), c(57), d(4 ending 03-27).
    expect(day('2026-03-27')).toMatchObject({ active: 3 });
  });

  it('an empty database gives zeros and nulls, never invented numbers', async () => {
    const empty = await createSeededTestDb();
    const r = await streaksReport(empty.db, resolvePeriod({ period: '7d' }, NOW), NOW);
    expect(r.totals).toEqual({
      trackedUsers: 0,
      activeStreaks: 0,
      averageCurrent: null,
      medianCurrent: null,
      longestCurrent: null,
      longestEver: null,
    });
    expect(r.historySince).toBeNull();
    expect(r.top).toEqual([]);
    await empty.close();
  });
});
