import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createTestDb } from '@zybrilka/db/testing';
import type { ActivityStatsResponse } from '@zybrilka/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { activityOverview, activityStats, recordActiveSlots } from './service.js';

/** Active time (docs/ACTIVE_TIME.md): 30-second slots, unique per user. */
describe('active time', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let app: ReturnType<typeof buildApp>;

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
  const beat = (slots: number[], cookie?: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/activity/heartbeat',
      payload: { slots },
      headers: cookie ? { cookie } : {},
    });
  /** Slot starts ending at `at` (epoch s), `n` of them, 30 s apart. */
  const run = (at: number, n: number) =>
    Array.from({ length: n }, (_, i) => Math.floor(at / 30) * 30 - i * 30);

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

  it('two devices (or tabs) active at the same moment count it once', async () => {
    const me = await player();
    const now = Math.floor(Date.now() / 1000);
    const slots = run(now, 10); // 5 minutes
    expect((await beat(slots, me.phone)).json()).toEqual({ counted: 10 });
    // The laptop was open at the same time; a re-sent request too.
    expect((await beat(slots, me.laptop)).json()).toEqual({ counted: 0 });
    expect((await beat(slots.slice(0, 4), me.phone)).json()).toEqual({ counted: 0 });
    const stats = (
      await app.inject({
        method: 'GET',
        url: '/api/v1/progress/activity',
        headers: { cookie: me.phone },
      })
    ).json() as ActivityStatsResponse;
    expect(stats.todaySeconds + (stats.days.at(-2)?.seconds ?? 0)).toBe(300);
    expect(stats.allSeconds).toBe(300);
  });

  it('only real slots: multiples of 30 s, not in the future, not older than 48 h', async () => {
    const me = await player();
    const now = Math.floor(Date.now() / 1000);
    const slot = Math.floor(now / 30) * 30;
    const res = await beat([slot + 7, slot + 3600, slot - 49 * 3600, slot], me.phone);
    expect(res.json()).toEqual({ counted: 1 });
    expect((await beat([], me.phone)).statusCode).toBe(400);
    expect((await beat([slot])).statusCode).toBe(401);
  });

  it('today, 7 and 30 days, all time — by Moscow days, with each day listed', async () => {
    const me = await player();
    const now = new Date('2026-11-26T12:00:00Z'); // 15:00 in Moscow
    const at = (iso: string) => Date.parse(iso) / 1000;
    // 20:59 UTC on the 25th is 23:59 Moscow — the 25th; 21:00 UTC is the 26th.
    await recordActiveSlots(testDb.db, me.id, [at('2026-11-25T20:59:00Z')], now);
    await recordActiveSlots(testDb.db, me.id, [at('2026-11-25T21:00:00Z')], now);
    await recordActiveSlots(testDb.db, me.id, run(at('2026-11-26T11:00:00Z'), 4), now);
    // Ten days ago and 40 days ago (written straight: older than 48 h).
    await testDb.db.insert(schema.userActivityDays).values([
      { userId: me.id, day: '2026-11-16', activeSeconds: 600 },
      { userId: me.id, day: '2026-10-17', activeSeconds: 900 },
    ]);
    const s = await activityStats(testDb.db, me.id, now);
    expect(s.todaySeconds).toBe(150); // 21:00 UTC slot + 4 slots
    expect(s.last7Seconds).toBe(180); // + 30 s of the 25th
    expect(s.last30Seconds).toBe(780); // + 600 s of the 16th
    expect(s.allSeconds).toBe(1680); // + 900 s of October
    expect(s.days).toHaveLength(30);
    expect(s.days.at(-1)).toEqual({ date: '2026-11-26', seconds: 150 });
    expect(s.days.at(-2)).toEqual({ date: '2026-11-25', seconds: 30 });
    expect(s.days[0]!.date).toBe('2026-10-28');
    expect(s.activeDays).toBe(4);
  });

  it('old slots are dropped once they cannot repeat; the day totals stay', async () => {
    const me = await player();
    const now = new Date();
    const slot = Math.floor(now.getTime() / 1000 / 30) * 30;
    await testDb.db
      .insert(schema.userActiveSlots)
      .values({ userId: me.id, slot: new Date(now.getTime() - 5 * 24 * 3600 * 1000) });
    await recordActiveSlots(testDb.db, me.id, [slot], now);
    const left = await testDb.db
      .select()
      .from(schema.userActiveSlots)
      .where(eq(schema.userActiveSlots.userId, me.id));
    expect(left).toHaveLength(1);
  });

  it('admin: everyone’s time per window, active users and time per user', async () => {
    const o = await activityOverview(testDb.db, new Date());
    expect(o.all.seconds).toBeGreaterThan(0);
    expect(o.all.users).toBeGreaterThan(0);
    expect(o.all.perUserSeconds).toBe(Math.round(o.all.seconds / o.all.users));
    expect(o.days).toHaveLength(30);
    expect(o.today.seconds).toBeLessThanOrEqual(o.last7.seconds);
    expect(o.last7.seconds).toBeLessThanOrEqual(o.last30.seconds);
  });
});
