import { schema, type Database } from '@zybrilka/db';
import type {
  MiniGameRatingEntry,
  MiniGameRatingKind,
  MiniGameRatingResponse,
} from '@zybrilka/shared';
import { count, eq, inArray, sql } from 'drizzle-orm';
import { listAvatarMetaOf } from '../profile/repo.js';
import { chooseAvatar } from '../profile/service.js';
import { avatarHue, avatarVariant, publicAvatarUrl, publicName } from '../leaderboard/service.js';

/**
 * A mini-game's own two ratings (docs/MINI_GAMES.md § Рейтинги), all time:
 * «Лучший результат» — the most points in one finished round; «Всего
 * очков» — the points of every finished round. Both come from
 * mini_game_scores, which only the server writes when it counts a round.
 * Equal values share a rank; the earlier record is listed first.
 */
export async function miniGameRating(
  db: Database,
  gameId: string,
  kind: MiniGameRatingKind,
  limit: number,
  userId: string | null,
): Promise<MiniGameRatingResponse> {
  const t = schema.miniGameScores;
  const value = kind === 'best' ? t.bestScore : t.totalPoints;
  const ranked = db
    .select({
      userId: t.userId,
      points: sql<number>`${value}`.as('points'),
      bestScore: t.bestScore,
      bestCorrect: t.bestCorrect,
      bestQuestions: t.bestQuestions,
      bestAt: t.bestAt,
      rounds: t.rounds,
      rank: sql<number>`rank() over (order by ${value} desc)::int`.as('rank'),
    })
    .from(t)
    .where(sql`${t.gameId} = ${gameId} and ${value} > 0`)
    .as('ranked');

  const order = sql`${ranked.rank} asc, ${ranked.bestAt} asc, ${ranked.userId} asc`;
  const [top, mine, total] = await Promise.all([
    db.select().from(ranked).orderBy(order).limit(limit),
    userId
      ? db.select().from(ranked).where(eq(ranked.userId, userId))
      : Promise.resolve([] as never[]),
    db
      .select({ n: count() })
      .from(t)
      .where(sql`${t.gameId} = ${gameId} and ${value} > 0`),
  ]);

  const ids = [...new Set([...top.map((r) => r.userId), ...mine.map((r) => r.userId)])];
  const people =
    ids.length === 0
      ? []
      : await db
          .select({
            id: schema.users.id,
            displayName: schema.users.displayName,
            firstName: schema.users.firstName,
            lastName: schema.users.lastName,
            profileSource: schema.users.profileSource,
          })
          .from(schema.users)
          .where(inArray(schema.users.id, ids));
  const personOf = new Map(people.map((p) => [p.id, p]));
  const avatars = new Map<string, Awaited<ReturnType<typeof listAvatarMetaOf>>>();
  for (const a of ids.length > 0 ? await listAvatarMetaOf(db, ids) : []) {
    avatars.set(a.userId, [...(avatars.get(a.userId) ?? []), a]);
  }
  /** Only a picture we store ourselves — never a third-party URL. */
  const avatarUrlOf = (id: string) => {
    const chosen = chooseAvatar(
      avatars.get(id) ?? [],
      personOf.get(id)?.profileSource ?? null,
      false,
      {
        storedOnly: true,
      },
    );
    return chosen && chosen !== 'external' ? publicAvatarUrl(chosen.id, chosen.sha256) : null;
  };

  const toEntry = (r: (typeof top)[number]): MiniGameRatingEntry => {
    const person = personOf.get(r.userId);
    return {
      rank: r.rank,
      name: person ? publicName(person) : 'Участник',
      isMe: r.userId === userId,
      avatarHue: avatarHue(r.userId),
      avatarVariant: avatarVariant(r.userId),
      avatarUrl: avatarUrlOf(r.userId),
      points: Number(r.points),
      bestCorrect: r.bestCorrect,
      bestQuestions: r.bestQuestions,
      bestAccuracyPercent:
        r.bestQuestions > 0 ? Math.round((r.bestCorrect / r.bestQuestions) * 100) : 0,
      bestAt: r.bestAt.toISOString(),
      rounds: r.rounds,
    };
  };

  return {
    gameId,
    kind,
    players: total[0]?.n ?? 0,
    entries: top.map(toEntry),
    me: mine[0] ? toEntry(mine[0]) : null,
  };
}
