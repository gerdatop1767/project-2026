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

describe('Telegram linking — races, repeats and edge cases', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  const newUser = async () => (await testDb.db.insert(schema.users).values({}).returning())[0]!.id;
  const identities = (userId: string) =>
    testDb.db.select().from(schema.authIdentities).where(eq(schema.authIdentities.userId, userId));

  beforeAll(async () => {
    testDb = await createTestDb();
  });
  afterAll(async () => {
    await testDb.close();
  });

  it('two Telegram accounts pressing «Да» at once: exactly one claims', async () => {
    const owner = await newUser();
    const { token } = await createTelegramLinkToken(testDb.db, owner);
    const results = await Promise.all([
      claimTelegramLinkToken(testDb.db, token, 9001, 'Первый'),
      claimTelegramLinkToken(testDb.db, token, 9002, 'Второй'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['claimed', 'claimed_by_other']);
    // The same one pressing again (or a re-delivered update) keeps its claim.
    const winner = results[0]!.status === 'claimed' ? 9001 : 9002;
    expect(await claimTelegramLinkToken(testDb.db, token, winner, 'Снова')).toEqual({
      status: 'claimed',
    });
    const [row] = await testDb.db
      .select()
      .from(schema.telegramLinkTokens)
      .where(eq(schema.telegramLinkTokens.tokenHash, hashLinkToken(token)));
    expect(row!.claimedTelegramId).toBe(winner);
  });

  it('«Подтвердить» pressed twice at once links once; the second finds nothing', async () => {
    const owner = await newUser();
    const { token } = await createTelegramLinkToken(testDb.db, owner);
    await claimTelegramLinkToken(testDb.db, token, 9101, 'Я');
    const results = await Promise.all([
      confirmTelegramLink(testDb.db, owner, true),
      confirmTelegramLink(testDb.db, owner, true),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['linked', 'nothing_pending']);
    expect(await identities(owner)).toHaveLength(1);
  });

  it('«Подтвердить» and «Это не я» at once: one wins, the token is finished once', async () => {
    const owner = await newUser();
    const { token } = await createTelegramLinkToken(testDb.db, owner);
    await claimTelegramLinkToken(testDb.db, token, 9201, 'Я');
    const [a, b] = await Promise.all([
      confirmTelegramLink(testDb.db, owner, true),
      confirmTelegramLink(testDb.db, owner, false),
    ]);
    expect([a.status, b.status]).toContain('nothing_pending');
    const linked = (await identities(owner)).length;
    expect(linked).toBe([a.status, b.status].includes('linked') ? 1 : 0);
    // After either outcome, more presses change nothing.
    expect(await confirmTelegramLink(testDb.db, owner, true)).toEqual({
      status: 'nothing_pending',
    });
    expect(await identities(owner)).toHaveLength(linked);
  });

  it('«Это не я» twice, then «Подтвердить»: nothing is ever linked', async () => {
    const owner = await newUser();
    const { token } = await createTelegramLinkToken(testDb.db, owner);
    await claimTelegramLinkToken(testDb.db, token, 9301, 'Чужой');
    expect(await confirmTelegramLink(testDb.db, owner, false)).toEqual({ status: 'rejected' });
    expect(await confirmTelegramLink(testDb.db, owner, false)).toEqual({
      status: 'nothing_pending',
    });
    expect(await confirmTelegramLink(testDb.db, owner, true)).toEqual({
      status: 'nothing_pending',
    });
    expect(await identities(owner)).toHaveLength(0);
  });

  it('one Telegram claiming two accounts: only the first confirmed gets it — also in parallel', async () => {
    const [a, b] = [await newUser(), await newUser()];
    const ta = await createTelegramLinkToken(testDb.db, a);
    const tb = await createTelegramLinkToken(testDb.db, b);
    expect((await claimTelegramLinkToken(testDb.db, ta.token, 9401, 'Я')).status).toBe('claimed');
    expect((await claimTelegramLinkToken(testDb.db, tb.token, 9401, 'Я')).status).toBe('claimed');
    expect(await confirmTelegramLink(testDb.db, a, true)).toEqual({ status: 'linked' });
    expect(await confirmTelegramLink(testDb.db, b, true)).toEqual({ status: 'taken' });
    expect(await identities(b)).toHaveLength(0);

    const [c, d] = [await newUser(), await newUser()];
    const tc = await createTelegramLinkToken(testDb.db, c);
    const td = await createTelegramLinkToken(testDb.db, d);
    await claimTelegramLinkToken(testDb.db, tc.token, 9402, 'Я');
    await claimTelegramLinkToken(testDb.db, td.token, 9402, 'Я');
    const results = await Promise.all([
      confirmTelegramLink(testDb.db, c, true),
      confirmTelegramLink(testDb.db, d, true),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['linked', 'taken']);
    const owners = await testDb.db
      .select()
      .from(schema.authIdentities)
      .where(eq(schema.authIdentities.providerUserId, '9402'));
    expect(owners).toHaveLength(1);
  });

  it('a refused or failed link never touches the sign-in methods the account has', async () => {
    const owner = await newUser();
    await testDb.db.insert(schema.authIdentities).values([
      { userId: owner, provider: 'vk', providerUserId: 'vk-1' },
      { userId: owner, provider: 'telegram', providerUserId: '9501' },
    ]);
    const before = await identities(owner);
    const t1 = await createTelegramLinkToken(testDb.db, owner);
    await claimTelegramLinkToken(testDb.db, t1.token, 9502, 'Другой');
    expect(await confirmTelegramLink(testDb.db, owner, true)).toEqual({
      status: 'provider_already_used',
    });
    const t2 = await createTelegramLinkToken(testDb.db, owner);
    await claimTelegramLinkToken(testDb.db, t2.token, 9503, 'Чужой');
    expect(await confirmTelegramLink(testDb.db, owner, false)).toEqual({ status: 'rejected' });
    expect(await identities(owner)).toEqual(before);
  });

  it('the 15-minute limit is exact, and a new link revokes an older claimed one', async () => {
    const owner = await newUser();
    const issued = new Date('2026-10-25T10:00:00Z');
    const { token, expiresAt } = await createTelegramLinkToken(testDb.db, owner, issued);
    expect(expiresAt.getTime() - issued.getTime()).toBe(TELEGRAM_LINK_TTL_MS);
    const justBefore = new Date(expiresAt.getTime() - 1);
    expect(await previewTelegramLink(testDb.db, token, 9601, justBefore)).toMatchObject({
      status: 'ok',
    });
    expect(await claimTelegramLinkToken(testDb.db, token, 9601, 'x', expiresAt)).toEqual({
      status: 'expired',
    });
    expect((await claimTelegramLinkToken(testDb.db, token, 9601, 'x', justBefore)).status).toBe(
      'claimed',
    );
    expect(await confirmTelegramLink(testDb.db, owner, true, expiresAt)).toEqual({
      status: 'nothing_pending',
    });

    // Claimed but not confirmed, then a fresh link: the old claim is gone.
    const again = new Date(expiresAt.getTime() - 60_000);
    const old = await createTelegramLinkToken(testDb.db, owner, again);
    await claimTelegramLinkToken(testDb.db, old.token, 9602, 'Старый', again);
    await createTelegramLinkToken(testDb.db, owner, again);
    expect(await pendingTelegramLink(testDb.db, owner, again)).toBeNull();
    expect(await confirmTelegramLink(testDb.db, owner, true, again)).toEqual({
      status: 'nothing_pending',
    });
    expect(await identities(owner)).toHaveLength(0);
  });
});
