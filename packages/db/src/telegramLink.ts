import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Database } from './client.js';
import { addIdentityIn } from './identities.js';
import * as schema from './schema.js';

/**
 * Linking a site account to Telegram through the bot (docs/REMINDERS.md).
 *
 * The signed-in user gets a one-time token (API) and opens
 * `t.me/<bot>?start=link_<token>`; the bot (worker) consumes it with the
 * sender's Telegram id, which Telegram itself vouches for. Nothing is
 * linked by a typed name or username. Only the token's SHA-256 is stored;
 * a token is single-use and lives a few minutes.
 */
export const TELEGRAM_LINK_TTL_MS = 15 * 60 * 1000;

export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 24 random bytes, base64url: 32 characters — fits Telegram's 64-char
 * `start` payload together with the `link_` prefix. */
export async function createTelegramLinkToken(
  db: Database,
  userId: string,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(now.getTime() + TELEGRAM_LINK_TTL_MS);
  await db.insert(schema.telegramLinkTokens).values({
    tokenHash: hashLinkToken(token),
    userId,
    expiresAt,
    createdAt: now,
  });
  return { token, expiresAt };
}

export type LinkTokenOutcome =
  | { status: 'linked' | 'already_linked'; userId: string }
  | { status: 'taken' | 'provider_already_used'; userId: string }
  | { status: 'invalid' | 'expired' | 'used' };

/**
 * Consumes a link token for the Telegram user who sent it. One
 * transaction: the token is marked used (so it can never work twice, even
 * when the identity turns out to be taken), the identity is attached with
 * the same rules as every other linking path, and the bot chat row learns
 * its account.
 */
export async function consumeTelegramLinkToken(
  db: Database,
  token: string,
  telegramUserId: number,
  now = new Date(),
): Promise<LinkTokenOutcome> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return { status: 'invalid' };
  const tokenHash = hashLinkToken(token);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.telegramLinkTokens)
      .where(eq(schema.telegramLinkTokens.tokenHash, tokenHash))
      .for('update');
    if (!row) return { status: 'invalid' } as const;
    if (row.consumedAt) return { status: 'used' } as const;
    if (row.expiresAt <= now) return { status: 'expired' } as const;
    const claimed = await tx
      .update(schema.telegramLinkTokens)
      .set({ consumedAt: now })
      .where(
        and(
          eq(schema.telegramLinkTokens.tokenHash, tokenHash),
          isNull(schema.telegramLinkTokens.consumedAt),
          gt(schema.telegramLinkTokens.expiresAt, now),
        ),
      )
      .returning({ userId: schema.telegramLinkTokens.userId });
    if (claimed.length === 0) return { status: 'used' } as const;

    const outcome = await addIdentityIn(tx, row.userId, 'telegram', String(telegramUserId));
    if (outcome === 'linked' || outcome === 'already_linked') {
      // A private chat's id is the Telegram user id.
      await tx
        .update(schema.telegramBotChats)
        .set({ userId: row.userId })
        .where(eq(schema.telegramBotChats.chatId, telegramUserId));
    }
    return { status: outcome, userId: row.userId };
  });
}

export interface TelegramReachability {
  /** The account's linked Telegram user id (= private chat id), if any. */
  telegramId: number | null;
  /** That chat pressed /start in the bot at some point. */
  botStarted: boolean;
  /** Telegram said the user blocked the bot (until their next /start). */
  blocked: boolean;
}

/**
 * Whether the bot may write to this account — the only audience Telegram
 * allows a bot to message first is a chat that started it and did not
 * block it.
 */
export async function telegramReachability(
  db: Database,
  userId: string,
): Promise<TelegramReachability> {
  const [identity] = await db
    .select({ telegramId: schema.authIdentities.providerUserId })
    .from(schema.authIdentities)
    .where(
      and(eq(schema.authIdentities.userId, userId), eq(schema.authIdentities.provider, 'telegram')),
    )
    .limit(1);
  const telegramId = identity ? Number(identity.telegramId) : null;
  if (telegramId === null || !Number.isSafeInteger(telegramId) || telegramId <= 0) {
    return { telegramId: null, botStarted: false, blocked: false };
  }
  const [chat] = await db
    .select({ blockedAt: schema.telegramBotChats.blockedAt })
    .from(schema.telegramBotChats)
    .where(eq(schema.telegramBotChats.chatId, telegramId))
    .limit(1);
  return { telegramId, botStarted: Boolean(chat), blocked: Boolean(chat?.blockedAt) };
}
