import { schema, type Database } from '@zybrilka/db';
import {
  ACTIVITY_MAX_AGE_HOURS,
  ACTIVITY_SLOT_SECONDS,
  type ActivityDay,
  type ActivityStatsResponse,
} from '@zybrilka/shared';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { moscowDate } from '../admin/period.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Slots are only needed to spot a repeat; older ones are dropped. */
const KEEP_SLOTS_MS = 3 * DAY_MS;

/** YYYY-MM-DD `n` days before `date`. */
export function daysBefore(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Records the slots a client was active in. Only real slot starts are
 * taken (multiples of 30 s, not in the future, not older than 48 h); a
 * slot already counted — from another tab, another device or a re-sent
 * request — counts nothing. Each new slot adds 30 s to its Moscow day.
 * Returns how many slots were new.
 */
export async function recordActiveSlots(
  db: Database,
  userId: string,
  slots: readonly number[],
  now = new Date(),
): Promise<number> {
  const nowS = Math.floor(now.getTime() / 1000);
  const oldest = nowS - ACTIVITY_MAX_AGE_HOURS * 3600;
  const valid = [
    ...new Set(slots.filter((s) => s % ACTIVITY_SLOT_SECONDS === 0 && s <= nowS && s >= oldest)),
  ];
  if (valid.length === 0) return 0;
  const t = schema.userActiveSlots;
  const d = schema.userActivityDays;
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(t)
      .values(valid.map((s) => ({ userId, slot: new Date(s * 1000) })))
      .onConflictDoNothing()
      .returning({ slot: t.slot });
    const perDay = new Map<string, number>();
    for (const r of inserted) {
      const day = moscowDate(r.slot);
      perDay.set(day, (perDay.get(day) ?? 0) + ACTIVITY_SLOT_SECONDS);
    }
    for (const [day, seconds] of perDay) {
      await tx
        .insert(d)
        .values({ userId, day, activeSeconds: seconds, updatedAt: now })
        .onConflictDoUpdate({
          target: [d.userId, d.day],
          set: { activeSeconds: sql`${d.activeSeconds} + ${seconds}`, updatedAt: now },
        });
    }
    await tx
      .delete(t)
      .where(and(eq(t.userId, userId), lt(t.slot, new Date(now.getTime() - KEEP_SLOTS_MS))));
    return inserted.length;
  });
}

/** Today, 7 and 30 days (today included), all time, and the last 30 days. */
export async function activityStats(
  db: Database,
  userId: string,
  now = new Date(),
): Promise<ActivityStatsResponse> {
  const d = schema.userActivityDays;
  const today = moscowDate(now);
  const from = daysBefore(today, 29);
  const [recent, all] = await Promise.all([
    db
      .select({ day: d.day, seconds: d.activeSeconds })
      .from(d)
      .where(and(eq(d.userId, userId), gte(d.day, from))),
    db
      .select({
        seconds: sql<number>`coalesce(sum(${d.activeSeconds}), 0)::int`,
        days: sql<number>`count(*) filter (where ${d.activeSeconds} > 0)::int`,
      })
      .from(d)
      .where(eq(d.userId, userId)),
  ]);
  const byDay = new Map(recent.map((r) => [String(r.day), r.seconds]));
  const days: ActivityDay[] = Array.from({ length: 30 }, (_, i) => {
    const date = daysBefore(today, 29 - i);
    return { date, seconds: byDay.get(date) ?? 0 };
  });
  const sumLast = (n: number) => days.slice(-n).reduce((s, x) => s + x.seconds, 0);
  return {
    todaySeconds: sumLast(1),
    last7Seconds: sumLast(7),
    last30Seconds: sumLast(30),
    allSeconds: Number(all[0]?.seconds ?? 0),
    days,
    activeDays: Number(all[0]?.days ?? 0),
  };
}

/** Everyone's active time (admin): totals and active users per window. */
export async function activityOverview(db: Database, now = new Date()) {
  const d = schema.userActivityDays;
  const today = moscowDate(now);
  const window = async (from: string | null) => {
    const [row] = await db
      .select({
        seconds: sql<number>`coalesce(sum(${d.activeSeconds}), 0)::int`,
        users: sql<number>`count(distinct ${d.userId})::int`,
      })
      .from(d)
      .where(from ? gte(d.day, from) : undefined);
    const seconds = Number(row?.seconds ?? 0);
    const users = Number(row?.users ?? 0);
    return { seconds, users, perUserSeconds: users > 0 ? Math.round(seconds / users) : 0 };
  };
  const [todayW, week, month, all, series] = await Promise.all([
    window(today),
    window(daysBefore(today, 6)),
    window(daysBefore(today, 29)),
    window(null),
    db
      .select({
        day: d.day,
        seconds: sql<number>`sum(${d.activeSeconds})::int`,
        users: sql<number>`count(*)::int`,
      })
      .from(d)
      .where(gte(d.day, daysBefore(today, 29)))
      .groupBy(d.day),
  ]);
  const byDay = new Map(series.map((r) => [String(r.day), r]));
  return {
    today: todayW,
    last7: week,
    last30: month,
    all,
    days: Array.from({ length: 30 }, (_, i) => {
      const date = daysBefore(today, 29 - i);
      const r = byDay.get(date);
      return { date, seconds: Number(r?.seconds ?? 0), users: Number(r?.users ?? 0) };
    }),
  };
}
