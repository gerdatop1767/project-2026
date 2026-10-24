import { createHash } from 'node:crypto';
import { schema, type Database } from '@zybrilka/db';
import {
  levelForXp,
  type LeaderboardEntry,
  type LeaderboardPeriod,
  type LeaderboardQuery,
  type LeaderboardResponse,
} from '@zybrilka/shared';
import { and, asc, count, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import { moscowDate } from '../admin/period.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Where a period starts: «Сегодня» = since midnight Moscow time (the zone
 * streaks and daily statistics use), «Неделя» = the last 7 days (rolling,
 * so it never resets to empty on a Monday), «Всё время» = no bound.
 */
export function periodStart(period: LeaderboardPeriod, now: Date): Date | null {
  if (period === 'all') return null;
  if (period === 'week') return new Date(now.getTime() - 7 * DAY_MS);
  return new Date(`${moscowDate(now)}T00:00:00+03:00`);
}

/**
 * The name others see: the user's own display name, else the first name
 * with the last name cut to an initial («Анна С.»), else «Участник».
 * Never an email, a full last name or an id.
 */
export function publicName(u: {
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
}): string {
  if (u.displayName) return u.displayName;
  if (u.firstName) {
    const initial = u.lastName ? [...u.lastName.trim()][0] : undefined;
    return initial ? `${u.firstName} ${initial}.` : u.firstName;
  }
  return 'Участник';
}

/** A stable avatar colour that does not reveal the id it comes from. */
export function avatarHue(userId: string): number {
  return createHash('sha256').update(`avatar:${userId}`).digest().readUInt16BE(0) % 360;
}

const percent = (correct: number, total: number) =>
  total === 0 ? null : Math.round((correct / total) * 100);

/**
 * GET /leaderboard. Points = XP earned in the period (and subject); equal
 * points share a rank. Everyone with points > 0 takes part; `me` is
 * always returned, with `rank: null` while the user has no points yet.
 */
export async function getLeaderboard(
  db: Database,
  userId: string,
  query: LeaderboardQuery,
  now: Date = new Date(),
): Promise<LeaderboardResponse> {
  const since = periodStart(query.period, now);
  const subject = query.subject ?? null;

  const xpWhere: SQL[] = [];
  if (since) xpWhere.push(gte(schema.xpEvents.createdAt, since));
  const xpSource = db
    .select({
      userId: schema.xpEvents.userId,
      points: sql<number>`sum(${schema.xpEvents.amount})::int`.as('points'),
    })
    .from(schema.xpEvents);
  const points = (
    subject
      ? xpSource.innerJoin(
          schema.tasks,
          and(eq(schema.tasks.id, schema.xpEvents.sourceId), eq(schema.tasks.subjectId, subject)),
        )
      : xpSource
  )
    .where(and(...xpWhere))
    .groupBy(schema.xpEvents.userId)
    .having(sql`sum(${schema.xpEvents.amount}) > 0`)
    .as('points');

  const ranked = db
    .select({
      userId: points.userId,
      points: points.points,
      rank: sql<number>`rank() over (order by ${points.points} desc)::int`.as('rank'),
    })
    .from(points)
    .as('ranked');

  const [top, mine, total] = await Promise.all([
    query.limit === 0
      ? Promise.resolve([])
      : db.select().from(ranked).orderBy(asc(ranked.rank), asc(ranked.userId)).limit(query.limit),
    db.select().from(ranked).where(eq(ranked.userId, userId)),
    db.select({ n: count() }).from(ranked),
  ]);

  const ids = [...new Set([...top.map((r) => r.userId), userId])];
  const attemptWhere: SQL[] = [inArray(schema.attempts.userId, ids)];
  if (since) attemptWhere.push(gte(schema.attempts.createdAt, since));
  if (subject) attemptWhere.push(eq(schema.tasks.subjectId, subject));
  const [stats, people] = await Promise.all([
    db
      .select({
        userId: schema.attempts.userId,
        answers: count(),
        correct: count(sql`case when ${schema.attempts.isCorrect} then 1 end`),
        solved: sql<number>`count(distinct ${schema.attempts.taskId}) filter (where ${schema.attempts.isCorrect})::int`,
      })
      .from(schema.attempts)
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.attempts.taskId))
      .where(and(...attemptWhere))
      .groupBy(schema.attempts.userId),
    db
      .select({
        id: schema.users.id,
        displayName: schema.users.displayName,
        firstName: schema.users.firstName,
        lastName: schema.users.lastName,
        totalXp: schema.userXp.totalXp,
      })
      .from(schema.users)
      .leftJoin(schema.userXp, eq(schema.userXp.userId, schema.users.id))
      .where(inArray(schema.users.id, ids)),
  ]);
  const statsOf = new Map(stats.map((s) => [s.userId, s]));
  const personOf = new Map(people.map((p) => [p.id, p]));
  const statFields = (id: string) => {
    const s = statsOf.get(id);
    return {
      level: levelForXp(personOf.get(id)?.totalXp ?? 0),
      solved: s?.solved ?? 0,
      accuracyPercent: percent(s?.correct ?? 0, s?.answers ?? 0),
    };
  };

  const entries: LeaderboardEntry[] = top.map((row) => {
    const person = personOf.get(row.userId);
    return {
      rank: row.rank,
      name: person ? publicName(person) : 'Участник',
      points: row.points,
      ...statFields(row.userId),
      isMe: row.userId === userId,
      avatarHue: avatarHue(row.userId),
    };
  });

  return {
    period: query.period,
    subjectId: subject,
    since: since ? since.toISOString() : null,
    participants: total[0]?.n ?? 0,
    entries,
    me: {
      rank: mine[0]?.rank ?? null,
      points: mine[0]?.points ?? 0,
      ...statFields(userId),
    },
  };
}
