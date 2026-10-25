import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, isNotNull, isNull, or } from 'drizzle-orm';
import type { Database } from './client.js';
import { addIdentityIn } from './identities.js';
import * as schema from './schema.js';

/**
 * Linking a site account to Telegram through the bot (docs/REMINDERS.md).
 *
 * Both sides must agree, so a link that leaks — or one pushed on someone —
 * links nothing by itself:
 * 1. the signed-in user gets a one-time token (API) and opens
 *    `t.me/<bot>?start=link_<token>`;
 * 2. the bot shows WHICH account it is for and the Telegram user confirms
 *    («Да, это мой аккаунт») — `claimTelegramLinkToken` records their id,
 *    vouched for by Telegram itself;
 * 3. the account owner, signed in on the site, sees WHICH Telegram asked
 *    and confirms — `confirmTelegramLink` attaches it (or refuses).
 * Nothing is linked by a typed name or username. Only the token's SHA-256
 * is stored; a token lives 15 minutes, is finished by a confirmation, a
 * refusal or a newer link, and never works twice.
 */
export const TELEGRAM_LINK_TTL_MS = 15 * 60 * 1000;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 24 random bytes, base64url: 32 characters — fits Telegram's 64-char
 * `start` payload with the `link_` prefix and a callback's 64 bytes. A new
 * link cancels the account's older unfinished ones. */
export async function createTelegramLinkToken(
  db: Database,
  userId: string,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(now.getTime() + TELEGRAM_LINK_TTL_MS);
  await db.transaction(async (tx) => {
    await tx
      .update(schema.telegramLinkTokens)
      .set({ consumedAt: now })
      .where(
        and(
          eq(schema.telegramLinkTokens.userId, userId),
          isNull(schema.telegramLinkTokens.consumedAt),
        ),
      );
    await tx.insert(schema.telegramLinkTokens).values({
      tokenHash: hashLinkToken(token),
      userId,
      expiresAt,
      createdAt: now,
    });
  });
  return { token, expiresAt };
}

type TokenRow = typeof schema.telegramLinkTokens.$inferSelect;

async function liveToken(
  db: Pick<Database, 'select'>,
  token: string,
  now: Date,
): Promise<{ row: TokenRow } | { status: 'invalid' | 'expired' | 'used' }> {
  if (!TOKEN_RE.test(token)) return { status: 'invalid' };
  const [row] = await db
    .select()
    .from(schema.telegramLinkTokens)
    .where(eq(schema.telegramLinkTokens.tokenHash, hashLinkToken(token)));
  if (!row) return { status: 'invalid' };
  if (row.consumedAt) return { status: 'used' };
  if (row.expiresAt <= now) return { status: 'expired' };
  return { row };
}

/** What the bot may show about the account: a first name and a last-name
 * initial (or the user's own display name) — never more. */
async function accountLabel(db: Pick<Database, 'select'>, userId: string): Promise<string> {
  const [user] = await db
    .select({
      displayName: schema.users.displayName,
      firstName: schema.users.firstName,
      lastName: schema.users.lastName,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  const custom = user?.displayName?.trim();
  if (custom) return custom;
  const first = user?.firstName?.trim();
  if (!first) return 'без имени';
  const initial = user?.lastName?.trim().charAt(0);
  return initial ? `${first} ${initial}.` : first;
}

export type LinkPreview =
  | { status: 'ok'; accountLabel: string }
  | { status: 'already_linked' }
  | { status: 'taken' }
  | { status: 'invalid' | 'expired' | 'used' };

/** Step 2 (bot, before any change): is the link alive, and for whom. */
export async function previewTelegramLink(
  db: Database,
  token: string,
  telegramUserId: number,
  now = new Date(),
): Promise<LinkPreview> {
  const live = await liveToken(db, token, now);
  if (!('row' in live)) return live;
  const [owner] = await db
    .select({ userId: schema.authIdentities.userId })
    .from(schema.authIdentities)
    .where(
      and(
        eq(schema.authIdentities.provider, 'telegram'),
        eq(schema.authIdentities.providerUserId, String(telegramUserId)),
      ),
    );
  if (owner) return { status: owner.userId === live.row.userId ? 'already_linked' : 'taken' };
  return { status: 'ok', accountLabel: await accountLabel(db, live.row.userId) };
}

export type LinkClaim =
  | { status: 'claimed' }
  | { status: 'claimed_by_other' }
  | { status: 'invalid' | 'expired' | 'used' };

/** Step 2 (bot, «Да, это мой аккаунт»): records who confirmed. The first
 * Telegram account to confirm keeps it; another one is refused. The same
 * one pressing again (or a re-delivered update) changes nothing. All
 * conditions sit in the one conditional UPDATE, so parallel presses
 * cannot both win. */
export async function claimTelegramLinkToken(
  db: Database,
  token: string,
  telegramUserId: number,
  telegramName: string,
  now = new Date(),
): Promise<LinkClaim> {
  const live = await liveToken(db, token, now);
  if (!('row' in live)) return live;
  const claimed = await db
    .update(schema.telegramLinkTokens)
    .set({
      claimedTelegramId: telegramUserId,
      claimedName: telegramName.slice(0, 80) || 'без имени',
      claimedAt: now,
    })
    .where(
      and(
        eq(schema.telegramLinkTokens.tokenHash, live.row.tokenHash),
        isNull(schema.telegramLinkTokens.consumedAt),
        gt(schema.telegramLinkTokens.expiresAt, now),
        or(
          isNull(schema.telegramLinkTokens.claimedTelegramId),
          eq(schema.telegramLinkTokens.claimedTelegramId, telegramUserId),
        ),
      ),
    )
    .returning({ tokenHash: schema.telegramLinkTokens.tokenHash });
  return claimed.length ? { status: 'claimed' } : { status: 'claimed_by_other' };
}

/** Step 3 (site): the account's link waiting for its confirmation. */
export async function pendingTelegramLink(
  db: Database,
  userId: string,
  now = new Date(),
): Promise<{ telegramName: string; claimedAt: Date } | null> {
  const [row] = await db
    .select()
    .from(schema.telegramLinkTokens)
    .where(
      and(
        eq(schema.telegramLinkTokens.userId, userId),
        isNull(schema.telegramLinkTokens.consumedAt),
        gt(schema.telegramLinkTokens.expiresAt, now),
        isNotNull(schema.telegramLinkTokens.claimedTelegramId),
      ),
    )
    .orderBy(desc(schema.telegramLinkTokens.createdAt))
    .limit(1);
  return row ? { telegramName: row.claimedName ?? 'без имени', claimedAt: row.claimedAt! } : null;
}

export type LinkTokenOutcome =
  | { status: 'linked' | 'already_linked' | 'taken' | 'provider_already_used' }
  | { status: 'nothing_pending' | 'rejected' };

/**
 * Step 3 (site, signed in as the account owner): confirm or refuse the
 * Telegram account that claimed this account's link. One transaction: the
 * token is finished either way (it can never work twice), and on «confirm»
 * the identity is attached with the same rules as every other linking path
 * — a Telegram account owned by someone else is never moved, an account
 * that already has a Telegram keeps it (unlink it in the profile first).
 */
export async function confirmTelegramLink(
  db: Database,
  userId: string,
  accept: boolean,
  now = new Date(),
): Promise<LinkTokenOutcome> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.telegramLinkTokens)
      .where(
        and(
          eq(schema.telegramLinkTokens.userId, userId),
          isNull(schema.telegramLinkTokens.consumedAt),
          gt(schema.telegramLinkTokens.expiresAt, now),
          isNotNull(schema.telegramLinkTokens.claimedTelegramId),
        ),
      )
      .orderBy(desc(schema.telegramLinkTokens.createdAt))
      .limit(1)
      .for('update');
    if (!row) return { status: 'nothing_pending' } as const;
    const finished = await tx
      .update(schema.telegramLinkTokens)
      .set({ consumedAt: now })
      .where(
        and(
          eq(schema.telegramLinkTokens.tokenHash, row.tokenHash),
          isNull(schema.telegramLinkTokens.consumedAt),
        ),
      )
      .returning({ tokenHash: schema.telegramLinkTokens.tokenHash });
    if (finished.length === 0) return { status: 'nothing_pending' } as const;
    if (!accept) return { status: 'rejected' } as const;
    const telegramUserId = row.claimedTelegramId!;
    const outcome = await addIdentityIn(tx, userId, 'telegram', String(telegramUserId));
    if (outcome === 'linked' || outcome === 'already_linked') {
      // A private chat's id is the Telegram user id.
      await tx
        .update(schema.telegramBotChats)
        .set({ userId })
        .where(eq(schema.telegramBotChats.chatId, telegramUserId));
    }
    return { status: outcome };
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
