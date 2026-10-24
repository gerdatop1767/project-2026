import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema.js';
import { createTestDb } from './testing.js';
import {
  claimTelegramLinkToken,
  confirmTelegramLink,
  createTelegramLinkToken,
  hashLinkToken,
  pendingTelegramLink,
  previewTelegramLink,
  telegramReachability,
  TELEGRAM_LINK_TTL_MS,
} from './telegramLink.js';

describe('Telegram linking through the bot', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let alice: string;
  let bob: string;
  let carol: string;

  beforeAll(async () => {
    testDb = await createTestDb();
    const rows = await testDb.db
      .insert(schema.users)
      .values([{ firstName: 'Алиса', lastName: 'Смирнова' }, {}, {}])
      .returning();
    alice = rows[0]!.id;
    bob = rows[1]!.id;
    carol = rows[2]!.id;
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

  it('links only after the bot user AND the account owner confirm', async () => {
    const { token } = await createTelegramLinkToken(testDb.db, alice);
    const [row] = await testDb.db.select().from(schema.telegramLinkTokens);
    expect(row!.tokenHash).toBe(hashLinkToken(token));
    expect(JSON.stringify(row)).not.toContain(token);

    // The bot shows a short label of the account — nothing else.
    expect(await previewTelegramLink(testDb.db, token, 111)).toEqual({
      status: 'ok',
      accountLabel: 'Алиса С.',
    });
    expect(await pendingTelegramLink(testDb.db, alice)).toBeNull();

    expect(await claimTelegramLinkToken(testDb.db, token, 111, 'Алиса')).toEqual({
      status: 'claimed',
    });
    // Claimed, but nothing is linked yet.
    expect(await telegramOf(alice)).toHaveLength(0);
    expect(await pendingTelegramLink(testDb.db, alice)).toMatchObject({ telegramName: 'Алиса' });

    expect(await confirmTelegramLink(testDb.db, alice, true)).toEqual({ status: 'linked' });
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
    expect(await previewTelegramLink(testDb.db, token, 111)).toEqual({ status: 'used' });
    expect(await claimTelegramLinkToken(testDb.db, token, 111, 'Алиса')).toEqual({
      status: 'used',
    });
    expect(await confirmTelegramLink(testDb.db, alice, true)).toEqual({
      status: 'nothing_pending',
    });
  });

  it('an intercepted link links nothing: the owner sees who claimed it and refuses', async () => {
    const { token } = await createTelegramLinkToken(testDb.db, bob);
    expect(await claimTelegramLinkToken(testDb.db, token, 666, 'Чужой')).toEqual({
      status: 'claimed',
    });
    // The real owner's Telegram is refused: the first claimer holds the link.
    expect(await claimTelegramLinkToken(testDb.db, token, 222, 'Боб')).toEqual({
      status: 'claimed_by_other',
    });
    expect(await telegramOf(bob)).toHaveLength(0);
    expect(await pendingTelegramLink(testDb.db, bob)).toMatchObject({ telegramName: 'Чужой' });

    expect(await confirmTelegramLink(testDb.db, bob, false)).toEqual({ status: 'rejected' });
    expect(await telegramOf(bob)).toHaveLength(0);
    expect(await pendingTelegramLink(testDb.db, bob)).toBeNull();
    expect(await claimTelegramLinkToken(testDb.db, token, 666, 'Чужой')).toEqual({
      status: 'used',
    });
  });

  it('confirming needs the account that issued the link', async () => {
    const { token } = await createTelegramLinkToken(testDb.db, bob);
    await claimTelegramLinkToken(testDb.db, token, 222, 'Боб');
    // Another signed-in account has nothing pending: the claim is not theirs.
    expect(await confirmTelegramLink(testDb.db, carol, true)).toEqual({
      status: 'nothing_pending',
    });
    expect(await telegramOf(carol)).toHaveLength(0);
    expect(await confirmTelegramLink(testDb.db, bob, true)).toEqual({ status: 'linked' });
    expect((await telegramOf(bob)).map((i) => i.providerUserId)).toEqual(['222']);
  });

  it('a newer link cancels the older one', async () => {
    const first = await createTelegramLinkToken(testDb.db, carol);
    const second = await createTelegramLinkToken(testDb.db, carol);
    expect(await claimTelegramLinkToken(testDb.db, first.token, 333, 'Кэрол')).toEqual({
      status: 'used',
    });
    expect(await previewTelegramLink(testDb.db, second.token, 333)).toMatchObject({
      status: 'ok',
    });
  });

  it('never moves a Telegram account that belongs to someone else', async () => {
    const { token } = await createTelegramLinkToken(testDb.db, carol);
    expect(await previewTelegramLink(testDb.db, token, 111)).toEqual({ status: 'taken' });
    // Even if claimed anyway, confirmation refuses to move it.
    await claimTelegramLinkToken(testDb.db, token, 111, 'Алиса');
    expect(await confirmTelegramLink(testDb.db, carol, true)).toEqual({ status: 'taken' });
    expect(await telegramOf(carol)).toHaveLength(0);
    expect((await telegramOf(alice)).map((i) => i.providerUserId)).toEqual(['111']);
  });

  it('an account keeps its one Telegram', async () => {
    const { token } = await createTelegramLinkToken(testDb.db, alice);
    expect(await previewTelegramLink(testDb.db, token, 111)).toEqual({
      status: 'already_linked',
    });
    await claimTelegramLinkToken(testDb.db, token, 444, 'Второй');
    expect(await confirmTelegramLink(testDb.db, alice, true)).toEqual({
      status: 'provider_already_used',
    });
    expect((await telegramOf(alice)).map((i) => i.providerUserId)).toEqual(['111']);
  });

  it('rejects expired, unknown and malformed tokens', async () => {
    const past = new Date(Date.now() - TELEGRAM_LINK_TTL_MS - 1000);
    const { token } = await createTelegramLinkToken(testDb.db, carol, past);
    expect(await previewTelegramLink(testDb.db, token, 555)).toEqual({ status: 'expired' });
    expect(await claimTelegramLinkToken(testDb.db, token, 555, 'x')).toEqual({
      status: 'expired',
    });
    expect(await claimTelegramLinkToken(testDb.db, 'A'.repeat(32), 555, 'x')).toEqual({
      status: 'invalid',
    });
    expect(await previewTelegramLink(testDb.db, "x'; drop", 555)).toEqual({ status: 'invalid' });
    expect(await telegramOf(carol)).toHaveLength(0);
  });

  it('a claim that expires before the owner confirms links nothing', async () => {
    const issued = new Date(Date.now() - TELEGRAM_LINK_TTL_MS + 60_000);
    const { token } = await createTelegramLinkToken(testDb.db, carol, issued);
    expect(await claimTelegramLinkToken(testDb.db, token, 555, 'Кэрол')).toEqual({
      status: 'claimed',
    });
    const later = new Date(Date.now() + 120_000);
    expect(await pendingTelegramLink(testDb.db, carol, later)).toBeNull();
    expect(await confirmTelegramLink(testDb.db, carol, true, later)).toEqual({
      status: 'nothing_pending',
    });
    expect(await telegramOf(carol)).toHaveLength(0);
  });
});
