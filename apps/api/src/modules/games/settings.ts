import { schema, type Database } from '@zybrilka/db';
import { MINI_GAMES, roundSizeLimits, type MiniGameSettingsResponse } from '@zybrilka/shared';
import { eq, sql } from 'drizzle-orm';

const GAME_IDS = new Set(MINI_GAMES.map((g) => g.id));
export const isMiniGame = (id: string): boolean => GAME_IDS.has(id);

/** A round size this game allows (its bank is checked when a round is built). */
export function validRoundSize(gameId: string, size: number): boolean {
  const { min, max } = roundSizeLimits(gameId);
  return Number.isInteger(size) && size >= min && size <= max;
}

export async function getMiniGameSettings(
  db: Database,
  userId: string,
): Promise<MiniGameSettingsResponse> {
  const rows = await db
    .select({
      gameId: schema.miniGameSettings.gameId,
      roundSize: schema.miniGameSettings.roundSize,
    })
    .from(schema.miniGameSettings)
    .where(eq(schema.miniGameSettings.userId, userId));
  return {
    settings: Object.fromEntries(
      rows.filter((r) => isMiniGame(r.gameId)).map((r) => [r.gameId, { roundSize: r.roundSize }]),
    ),
  };
}

export async function saveMiniGameSettings(
  db: Database,
  userId: string,
  gameId: string,
  roundSize: number,
): Promise<void> {
  await db
    .insert(schema.miniGameSettings)
    .values({ userId, gameId, roundSize })
    .onConflictDoUpdate({
      target: [schema.miniGameSettings.userId, schema.miniGameSettings.gameId],
      set: { roundSize, updatedAt: sql`now()` },
    });
}
