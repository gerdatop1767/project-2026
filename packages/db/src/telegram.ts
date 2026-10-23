import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import * as schema from './schema.js';

/**
 * Private chats where the bot may write to the project owner(s):
 * an owner (`ADMIN_OWNER_USER_IDS`, server-side) → their Telegram identity
 * (verified at sign-in, `auth_identities`) → that Telegram user's chat with
 * the bot (they pressed /start; a private chat id equals the user id). A
 * username is never involved, so nobody can claim to be the owner.
 */
export async function adminTelegramChats(
  db: Database,
  ownerIds: readonly string[],
): Promise<number[]> {
  if (ownerIds.length === 0) return [];
  const rows = await db
    .select({ chatId: schema.telegramBotChats.chatId })
    .from(schema.telegramBotChats)
    .innerJoin(
      schema.authIdentities,
      and(
        eq(schema.authIdentities.provider, 'telegram'),
        eq(schema.authIdentities.providerUserId, sql`${schema.telegramBotChats.chatId}::text`),
      ),
    )
    .where(
      and(
        inArray(schema.authIdentities.userId, [...ownerIds]),
        isNull(schema.telegramBotChats.blockedAt),
      ),
    );
  return rows.map((r) => r.chatId);
}

/** Who of the owners could get notifications, for the admin panel. */
export async function adminTelegramReadiness(db: Database, ownerIds: readonly string[]) {
  if (ownerIds.length === 0) return { owners: 0, withTelegram: 0, startedBot: 0 };
  const identities = await db
    .select({ userId: schema.authIdentities.userId })
    .from(schema.authIdentities)
    .where(
      and(
        eq(schema.authIdentities.provider, 'telegram'),
        inArray(schema.authIdentities.userId, [...ownerIds]),
      ),
    );
  return {
    owners: ownerIds.length,
    withTelegram: new Set(identities.map((i) => i.userId)).size,
    startedBot: (await adminTelegramChats(db, ownerIds)).length,
  };
}
