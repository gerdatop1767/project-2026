import { randomUUID } from 'node:crypto';
import { claimTelegramLinkToken, schema } from '@zybrilka/db';
import { createTestDb } from '@zybrilka/db/testing';
import { telegramLinkResponseSchema } from '@zybrilka/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { cookieValue, telegramLaunch } from '../../testSupport.js';

const BOT_TOKEN = '123456:TEST-bot-token-not-a-real-secret';

/**
 * The site half of linking Telegram through the bot: the server — not the
 * buttons on the page — decides whose link it is and whether it is still
 * open (docs/REMINDERS.md).
 */
describe('Telegram link confirmation — server-side rules', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let tg = 880_000;

  beforeAll(async () => {
    testDb = await createTestDb();
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({
        NODE_ENV: 'test',
        WEB_BASE_URL: 'https://zybrilka.test',
        TELEGRAM_BOT_TOKEN: BOT_TOKEN,
      }),
    });
  });
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  /** An account that signs in with VK, with a live session. */
  async function vkAccount() {
    const [user] = await testDb.db.insert(schema.users).values({}).returning();
    await testDb.db
      .insert(schema.authIdentities)
      .values({ userId: user!.id, provider: 'vk', providerUserId: `vk-${randomUUID()}` });
    const sessionId = randomUUID();
    await testDb.db
      .insert(schema.authSessions)
      .values({ id: sessionId, userId: user!.id, expiresAt: new Date(Date.now() + 3_600_000) });
    return { id: user!.id, cookie: `session_id=${sessionId}` };
  }
  const identities = (userId: string) =>
    testDb.db.select().from(schema.authIdentities).where(eq(schema.authIdentities.userId, userId));
  async function issueAndClaim(cookie: string, telegramId: number) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/me/telegram/link',
      headers: { cookie },
    });
    const { token } = telegramLinkResponseSchema.parse(res.json());
    expect(await claimTelegramLinkToken(testDb.db, token, telegramId, 'Кто-то')).toEqual({
      status: 'claimed',
    });
    return token;
  }
  const confirm = (cookie: string, accept: boolean, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/me/telegram/link/confirm',
      headers: { cookie, ...headers },
      payload: { accept },
    });
  const stillSignedIn = async (cookie: string) =>
    (await app.inject({ method: 'GET', url: '/api/v1/me/reminders', headers: { cookie } }))
      .statusCode === 200;

  it('account B cannot confirm (or refuse) the link account A created', async () => {
    const [a, b] = [await vkAccount(), await vkAccount()];
    await issueAndClaim(a.cookie, ++tg);
    for (const accept of [true, false]) {
      const res = await confirm(b.cookie, accept);
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('nothing_pending');
    }
    expect(await identities(b.id)).toHaveLength(1);
    // A's request is untouched and still A's to answer.
    expect((await confirm(a.cookie, true)).json().status).toBe('linked');
  });

  it('a cross-site POST cannot confirm, even with the owner’s cookie', async () => {
    const a = await vkAccount();
    await issueAndClaim(a.cookie, ++tg);
    const forged = await confirm(a.cookie, true, { 'sec-fetch-site': 'cross-site' });
    expect(forged.statusCode).toBe(403);
    expect(await identities(a.id)).toHaveLength(1);
    expect((await confirm(a.cookie, true)).json().status).toBe('linked');
  });

  it('repeated «Подтвердить» / «Это не я» are answered by the token’s state, not the page', async () => {
    const a = await vkAccount();
    await issueAndClaim(a.cookie, ++tg);
    const both = await Promise.all([confirm(a.cookie, true), confirm(a.cookie, true)]);
    expect(both.map((r) => r.json().status).sort()).toEqual(['linked', 'nothing_pending']);
    expect((await confirm(a.cookie, false)).json().status).toBe('nothing_pending');
    // «Это не я» after linking does not unlink — unlinking is the profile's job.
    expect((await identities(a.id)).map((i) => i.provider).sort()).toEqual(['telegram', 'vk']);

    const b = await vkAccount();
    await issueAndClaim(b.cookie, ++tg);
    expect((await confirm(b.cookie, false)).json().status).toBe('rejected');
    expect((await confirm(b.cookie, false)).json().status).toBe('nothing_pending');
    expect((await confirm(b.cookie, true)).json().status).toBe('nothing_pending');
    expect((await identities(b.id)).map((i) => i.provider)).toEqual(['vk']);
  });

  it('refusing or failing keeps the current sign-in working', async () => {
    const a = await vkAccount();
    const before = await identities(a.id);
    await issueAndClaim(a.cookie, ++tg);
    expect((await confirm(a.cookie, false)).json().status).toBe('rejected');
    // A Telegram already owned by someone else: refused, nothing moves.
    const other = await vkAccount();
    const taken = ++tg;
    await issueAndClaim(other.cookie, taken);
    expect((await confirm(other.cookie, true)).json().status).toBe('linked');
    await issueAndClaim(a.cookie, taken);
    expect((await confirm(a.cookie, true)).json().status).toBe('taken');
    expect(await identities(a.id)).toEqual(before);
    expect(await stillSignedIn(a.cookie)).toBe(true);
    expect(await stillSignedIn(other.cookie)).toBe(true);
  });

  it('the limit is per account: one busy account does not block another on the same IP', async () => {
    const busy = await vkAccount();
    const issue = (cookie: string) =>
      app.inject({ method: 'POST', url: '/api/v1/me/telegram/link', headers: { cookie } });
    for (let i = 0; i < 10; i++) expect((await issue(busy.cookie)).statusCode).toBe(200);
    expect((await issue(busy.cookie)).statusCode).toBe(429);
    const neighbour = await vkAccount();
    expect((await issue(neighbour.cookie)).statusCode).toBe(200);
  });

  it('once linked, signing in through that Telegram opens the same account', async () => {
    const a = await vkAccount();
    const telegramId = ++tg;
    await issueAndClaim(a.cookie, telegramId);
    expect((await confirm(a.cookie, true)).json().status).toBe('linked');
    for (let i = 0; i < 2; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/telegram',
        payload: { initData: telegramLaunch(BOT_TOKEN, { id: telegramId, first_name: 'Я' }) },
      });
      expect(res.statusCode).toBe(200);
      const session = cookieValue(res.headers['set-cookie'], 'session_id');
      const me = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { cookie: `session_id=${session}` },
      });
      expect(me.json().user.id).toBe(a.id);
    }
    // No second account appeared, and the VK sign-in is still there.
    expect((await identities(a.id)).map((i) => i.provider).sort()).toEqual(['telegram', 'vk']);
    expect(await stillSignedIn(a.cookie)).toBe(true);
  });
});
