import { createHash } from 'node:crypto';
import { schema, type Database } from '@zybrilka/db';
import {
  LEADERBOARD_AVATAR_VARIANTS,
  levelForXp,
  type LeaderboardEntry,
  type LeaderboardPeriod,
  type LeaderboardQuery,
  type LeaderboardResponse,
} from '@zybrilka/shared';
import { and, asc, count, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import { moscowDate } from '../admin/period.js';
import { getAvatarById, listAvatarMeta, listAvatarMetaOf } from '../profile/repo.js';
import { chooseAvatar } from '../profile/service.js';

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

/** A stable generated-avatar picture, from other bits of the same hash —
 * so colour and picture vary independently. */
export function avatarVariant(userId: string): number {
  return (
    createHash('sha256').update(`avatar:${userId}`).digest().readUInt16BE(2) %
    LEADERBOARD_AVATAR_VARIANTS
  );
}

/** URL of a stored avatar image as others may load it. The `v` hash
 * prefix versions it, so it can be cached for good. */
export function publicAvatarUrl(avatarId: string, sha256: string): string {
  return `/api/v1/leaderboard/avatars/${avatarId}?v=${sha256.slice(0, 12)}`;
}

const percent = (correct: number, total: number) =>
  total === 0 ? null : Math.round((correct / total) * 100);

/**
 * An avatar image a rating row points to — served only while it is still
 * the picture that user's profile shows (a replaced or removed one is
 * gone), and only under the exact `v` it was announced with.
 */
export async function readPublicAvatar(db: Database, avatarId: string, version: string) {
  const image = await getAvatarById(db, avatarId);
  if (!image || image.sha256.slice(0, 12) !== version) return null;
  const [person] = await db
    .select({
      profileSource: schema.users.profileSource,
      hasProviderUrl: sql<boolean>`${schema.users.avatarUrl} is not null`,
    })
    .from(schema.users)
    .where(eq(schema.users.id, image.userId));
  const chosen = chooseAvatar(
    await listAvatarMeta(db, image.userId),
    person?.profileSource ?? null,
    Boolean(person?.hasProviderUrl),
  );
  if (!chosen || chosen === 'external' || chosen.id !== avatarId) return null;
  return { contentType: image.contentType, data: image.data };
}

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
        profileSource: schema.users.profileSource,
        hasProviderUrl: sql<boolean>`${schema.users.avatarUrl} is not null`,
      })
      .from(schema.users)
      .leftJoin(schema.userXp, eq(schema.userXp.userId, schema.users.id))
      .where(inArray(schema.users.id, ids)),
  ]);
  const avatarsOf = new Map<string, Awaited<ReturnType<typeof listAvatarMetaOf>>>();
  for (const a of await listAvatarMetaOf(
    db,
    top.map((r) => r.userId),
  )) {
    avatarsOf.set(a.userId, [...(avatarsOf.get(a.userId) ?? []), a]);
  }
  /** The same picture as the user's profile — only when it is stored here. */
  const avatarUrlOf = (id: string) => {
    const person = personOf.get(id);
    const chosen = chooseAvatar(
      avatarsOf.get(id) ?? [],
      person?.profileSource ?? null,
      Boolean(person?.hasProviderUrl),
    );
    return chosen && chosen !== 'external' ? publicAvatarUrl(chosen.id, chosen.sha256) : null;
  };
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
      avatarVariant: avatarVariant(row.userId),
      avatarUrl: avatarUrlOf(row.userId),
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
