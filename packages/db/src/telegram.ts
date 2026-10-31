import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from './client.js';
import * as schema from './schema.js';

/**
 * Private chats where the bot may write to the project owner(s): each
 * owner (`ADMIN_OWNER_USER_IDS`, server-side) → their Telegram identity,
 * verified at sign-in (`auth_identities`). A private chat's id IS the
 * Telegram user id, so no recorded /start is needed: Telegram itself
 * accepts the message once the owner has pressed Start in the bot — even
 * while the worker is not reading updates (TELEGRAM_BOT_POLLING off) —
 * and refuses it (403) otherwise. A username is never involved.
 */
export async function adminTelegramChats(
  db: Database,
  ownerIds: readonly string[],
): Promise<number[]> {
  if (ownerIds.length === 0) return [];
  const rows = await db
    .select({ telegramId: schema.authIdentities.providerUserId })
    .from(schema.authIdentities)
    .where(
      and(
        eq(schema.authIdentities.provider, 'telegram'),
        inArray(schema.authIdentities.userId, [...ownerIds]),
      ),
    );
  const ids = rows
    .map((r) => Number(r.telegramId))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  return [...new Set(ids)];
}

/** Who of the owners could get notifications, for the admin panel. */
export async function adminTelegramReadiness(db: Database, ownerIds: readonly string[]) {
  return {
    owners: ownerIds.length,
    withTelegram: (await adminTelegramChats(db, ownerIds)).length,
  };
}
