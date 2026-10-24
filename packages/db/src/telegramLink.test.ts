import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema.js';
import { createTestDb } from './testing.js';
import {
  consumeTelegramLinkToken,
  createTelegramLinkToken,
  hashLinkToken,
  telegramReachability,
  TELEGRAM_LINK_TTL_MS,
} from './telegramLink.js';

describe('Telegram linking through the bot', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    testDb = await createTestDb();
    const rows = await testDb.db.insert(schema.users).values([{}, {}]).returning();
    alice = rows[0]!.id;
    bob = rows[1]!.id;
    await testDb.db.insert(schema.telegramBotChats).values({ chatId: 111 });
  });
  afterAll(async () => {
    await testDb.close();
  });

  const telegramOf = async (userId: string) =>
    testDb.db
      .select()
      .from(schema.authIdentities)
      .where(
        and(
          eq(schema.authIdentities.userId, userId),
          eq(schema.authIdentities.provider, 'telegram'),
        ),
      );

  it('stores only a hash, links once, and ties the bot chat to the account', async () => {
    const { token } = await createTelegramLinkToken(testDb.db, alice);
    const [row] = await testDb.db.select().from(schema.telegramLinkTokens);
    expect(row!.tokenHash).toBe(hashLinkToken(token));
    expect(JSON.stringify(row)).not.toContain(token);

    expect(await telegramReachability(testDb.db, alice)).toEqual({
      telegramId: null,
      botStarted: false,
      blocked: false,
    });
    const outcome = await consumeTelegramLinkToken(testDb.db, token, 111);
    expect(outcome).toEqual({ status: 'linked', userId: alice });
    expect((await telegramOf(alice)).map((i) => i.providerUserId)).toEqual(['111']);
    const [chat] = await testDb.db
      .select()
      .from(schema.telegramBotChats)
      .where(eq(schema.telegramBotChats.chatId, 111));
    expect(chat!.userId).toBe(alice);
    expect(await telegramReachability(testDb.db, alice)).toEqual({
      telegramId: 111,
      botStarted: true,
      blocked: false,
    });

    // The same link again: never works twice.
    expect(await consumeTelegramLinkToken(testDb.db, token, 111)).toEqual({ status: 'used' });
  });

  it('never moves a Telegram account that belongs to someone else', async () => {
    const { token } = await createTelegramLinkToken(testDb.db, bob);
    expect(await consumeTelegramLinkToken(testDb.db, token, 111)).toEqual({
      status: 'taken',
      userId: bob,
    });
    expect(await telegramOf(bob)).toHaveLength(0);
  });

  it('rejects expired, unknown and malformed tokens', async () => {
    const past = new Date(Date.now() - TELEGRAM_LINK_TTL_MS - 1000);
    const { token } = await createTelegramLinkToken(testDb.db, bob, past);
    expect(await consumeTelegramLinkToken(testDb.db, token, 222)).toEqual({ status: 'expired' });
    expect(await consumeTelegramLinkToken(testDb.db, 'A'.repeat(32), 222)).toEqual({
      status: 'invalid',
    });
    expect(await consumeTelegramLinkToken(testDb.db, "x'; drop", 222)).toEqual({
      status: 'invalid',
    });
    expect(await telegramOf(bob)).toHaveLength(0);
  });
});
