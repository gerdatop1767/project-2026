import { createTestDb } from '@zybrilka/db/testing';
import { schema } from '@zybrilka/db';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { EmailSendError, setEmailTransportForTests, type OutgoingEmail } from './email.js';
import { EmailThrottle } from './emailThrottle.js';

/**
 * Email + password accounts (docs/EMAIL_AUTH.md) through the real routes.
 * Letters are captured by the test transport instead of going to SMTP.
 */
describe('email registration, sign-in and password reset', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let noSmtpApp: ReturnType<typeof buildApp>;
  let outbox: OutgoingEmail[] = [];
  let failNextSend = false;
  let ip = 0;
  // The per-address letter limit runs on this clock; `later()` moves it on.
  let clock = Date.now();
  const later = () => {
    clock += 61_000;
  };

  // Each test gets its own client IP so the per-IP route limits only
  // bite where a test is about them.
  let clientIp = '10.0.0.1';
  const post = (url: string, payload: object, cookie?: string, target = app) =>
    target.inject({
      method: 'POST',
      url: `/api/v1${url}`,
      payload,
      remoteAddress: clientIp,
      headers: cookie ? { cookie } : {},
    });
  const me = (cookie: string) =>
    app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });

  function sessionCookie(res: { headers: Record<string, unknown> }): string {
    const raw = res.headers['set-cookie'];
    const all = Array.isArray(raw) ? raw : [raw];
    const found = all.find((c) => typeof c === 'string' && c.startsWith('session_id='));
    return (found as string).split(';')[0]!;
  }

  function linkParam(message: OutgoingEmail | undefined, param: string): string {
    const match = message?.text.match(/https?:\/\/\S+/);
    const value = match ? new URL(match[0]).searchParams.get(param) : null;
    if (!value) throw new Error(`no ${param} link in letter: ${message?.subject}`);
    return value;
  }

  let n = 0;
  const freshEmail = () => `student${++n}.${Date.now()}@example.com`;
  const PASSWORD = 'Ege2026-strong';

  async function registerAndConfirm(email = freshEmail(), password = PASSWORD) {
    expect((await post('/auth/register', { email, password })).statusCode).toBe(200);
    const confirmed = await post('/auth/register/confirm', {
      token: linkParam(outbox.at(-1), 'confirm'),
    });
    expect(confirmed.statusCode).toBe(200);
    outbox = [];
    later();
    return { email, cookie: sessionCookie(confirmed), user: confirmed.json().user };
  }

  beforeAll(async () => {
    testDb = await createTestDb();
    const smtp = {
      NODE_ENV: 'test',
      WEB_BASE_URL: 'https://zybrilka.test',
      SMTP_HOST: 'smtp.yandex.ru',
      SMTP_PORT: '465',
      SMTP_USER: 'no-reply@zybrilka.test',
      SMTP_PASSWORD: 'app-password',
    };
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig(smtp),
      emailThrottle: new EmailThrottle(60_000, 5, () => clock),
    });
    noSmtpApp = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test' }),
    });
    setEmailTransportForTests(async (_config, message) => {
      if (failNextSend) {
        failNextSend = false;
        throw new EmailSendError('EAUTH', 535);
      }
      outbox.push(message);
    });
  });

  afterEach(() => {
    outbox = [];
    clientIp = `10.0.${Math.floor(++ip / 250)}.${(ip % 250) + 1}`;
  });

  afterAll(async () => {
    setEmailTransportForTests(null);
    await app.close();
    await noSmtpApp.close();
    await testDb.close();
  });

  it('registers: letter first, account only after the link is opened', async () => {
    const email = freshEmail();
    const res = await post('/auth/register', { email: email.toUpperCase(), password: PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ to: email, subject: 'Подтвердите регистрацию в Зубрилке' });
    // Nothing exists yet, and the password is not stored in clear anywhere.
    const identities = await testDb.db
      .select()
      .from(schema.authIdentities)
      .where(eq(schema.authIdentities.providerUserId, email));
    expect(identities).toHaveLength(0);
    const [pending] = await testDb.db
      .select()
      .from(schema.magicLinkTokens)
      .where(eq(schema.magicLinkTokens.email, email));
    expect(pending!.passwordHash).toMatch(/^scrypt\$15\$8\$3\$/);
    expect(pending!.passwordHash).not.toContain(PASSWORD);
    expect(JSON.stringify(pending)).not.toContain(linkParam(outbox[0], 'confirm'));

    const confirmed = await post('/auth/register/confirm', {
      token: linkParam(outbox[0], 'confirm'),
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ created: true, user: { email } });
    const cookie = sessionCookie(confirmed);
    expect((await me(cookie)).json().user.email).toBe(email);

    // The link works once.
    const again = await post('/auth/register/confirm', { token: linkParam(outbox[0], 'confirm') });
    expect(again.statusCode).toBe(400);
    expect(again.json()).toEqual({ error: 'invalid_or_used_token' });
  });

  it('signs in with the password; one neutral error for every failure', async () => {
    const { email } = await registerAndConfirm();
    const ok = await post('/auth/login', { email: email.toUpperCase(), password: PASSWORD });
    expect(ok.statusCode).toBe(200);
    expect((await me(sessionCookie(ok))).json().user.email).toBe(email);

    const wrong = await post('/auth/login', { email, password: 'not-the-password' });
    const unknown = await post('/auth/login', { email: freshEmail(), password: PASSWORD });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
    expect(wrong.json()).toEqual({ error: 'invalid_credentials' });
  });

  it('a registration waiting for confirmation cannot sign in yet', async () => {
    const email = freshEmail();
    await post('/auth/register', { email, password: PASSWORD });
    expect((await post('/auth/login', { email, password: PASSWORD })).statusCode).toBe(401);
  });

  it('validates the address and the password on the server', async () => {
    expect(
      (await post('/auth/register', { email: 'not-an-email', password: PASSWORD })).json(),
    ).toEqual({ error: 'invalid_body' });
    const short = await post('/auth/register', { email: freshEmail(), password: 'short1' });
    expect(short.statusCode).toBe(400);
    expect(short.json()).toEqual({ error: 'weak_password', problem: 'too_short' });
    const simple = await post('/auth/register', { email: freshEmail(), password: '12345678' });
    expect(simple.json()).toEqual({ error: 'weak_password', problem: 'too_simple' });
    const long = await post('/auth/register', { email: freshEmail(), password: 'a1'.repeat(70) });
    expect(long.statusCode).toBe(400);
    expect(outbox).toHaveLength(0);
  });

  it('registering an address that already has an account: same answer, no new password, owner gets a reset link', async () => {
    const { email } = await registerAndConfirm();
    const res = await post('/auth/register', { email, password: 'Another-pass-1' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(outbox[0]!.subject).toBe('У вас уже есть аккаунт в Зубрилке');
    expect(linkParam(outbox[0], 'reset')).toBeTruthy();
    // The attacker's password does not work; the owner's still does.
    expect((await post('/auth/login', { email, password: 'Another-pass-1' })).statusCode).toBe(401);
    expect((await post('/auth/login', { email, password: PASSWORD })).statusCode).toBe(200);
    const users = await testDb.db
      .select()
      .from(schema.authIdentities)
      .where(eq(schema.authIdentities.providerUserId, email));
    expect(users).toHaveLength(1);
  });

  it('an expired confirmation link says so, and a new one can be sent from it', async () => {
    const email = freshEmail();
    await post('/auth/register', { email, password: PASSWORD });
    const oldToken = linkParam(outbox[0], 'confirm');
    await testDb.db
      .update(schema.magicLinkTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.magicLinkTokens.email, email));
    const expired = await post('/auth/register/confirm', { token: oldToken });
    expect(expired.statusCode).toBe(410);
    expect(expired.json()).toEqual({ error: 'token_expired' });

    clientIp = '10.8.8.8';
    // The per-address limit still holds right after the first letter…
    const tooSoon = await post('/auth/register/resend', { token: oldToken });
    expect(tooSoon.statusCode).toBe(429);
    expect(tooSoon.headers['retry-after']).toBeDefined();
    expect(tooSoon.json()).toMatchObject({ error: 'too_many_requests' });

    later();
    outbox = [];
    expect((await post('/auth/register/resend', { token: oldToken })).json()).toEqual({ ok: true });
    const fresh = await post('/auth/register/confirm', { token: linkParam(outbox[0], 'confirm') });
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json().user.email).toBe(email);
  });

  it('resends a confirmation (by address) and the new link works', async () => {
    const email = freshEmail();
    await post('/auth/register', { email, password: PASSWORD });
    outbox = [];
    later();
    const res = await post('/auth/register/resend', { email });
    expect(res.json()).toEqual({ ok: true });
    expect(outbox).toHaveLength(1);
    const confirmed = await post('/auth/register/confirm', {
      token: linkParam(outbox[0], 'confirm'),
    });
    expect(confirmed.statusCode).toBe(200);

    // Unknown address: same answer, nothing sent.
    outbox = [];
    const unknown = await post('/auth/register/resend', { email: freshEmail() });
    expect(unknown.json()).toEqual({ ok: true });
    expect(outbox).toHaveLength(0);
    // Already confirmed: same answer, nothing sent.
    later();
    expect((await post('/auth/register/resend', { email })).json()).toEqual({ ok: true });
    expect(outbox).toHaveLength(0);
  });

  it('limits letters per address and per IP', async () => {
    const email = freshEmail();
    expect((await post('/auth/register', { email, password: PASSWORD })).statusCode).toBe(200);
    clientIp = '10.7.7.7';
    // Another kind of letter to the same address within a minute: refused.
    expect((await post('/auth/password/forgot', { email })).statusCode).toBe(429);
    expect(outbox).toHaveLength(1);
    // At most 5 an hour, even when spaced out.
    for (let i = 0; i < 4; i++) {
      later();
      expect((await post('/auth/password/forgot', { email })).statusCode).toBe(200);
    }
    later();
    expect((await post('/auth/password/forgot', { email })).statusCode).toBe(429);

    clientIp = '10.6.6.6';
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      codes.push((await post('/auth/login', { email, password: 'wrong-password' })).statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it('resets a password: link, new password, other sessions signed out', async () => {
    const { email, cookie: oldSession } = await registerAndConfirm();
    const asked = await post('/auth/password/forgot', { email: email.toUpperCase() });
    expect(asked.json()).toEqual({ ok: true });
    expect(outbox[0]!.subject).toBe('Восстановление пароля в Зубрилке');
    const token = linkParam(outbox[0], 'reset');

    expect((await post('/auth/password/reset/check', { token })).json()).toEqual({ ok: true });
    const weak = await post('/auth/password/reset', { token, password: 'short' });
    expect(weak.json()).toEqual({ error: 'weak_password', problem: 'too_short' });

    const done = await post('/auth/password/reset', { token, password: 'Brand-new-pass-7' });
    expect(done.statusCode).toBe(200);
    expect((await me(sessionCookie(done))).json().user.email).toBe(email);
    expect((await me(oldSession)).json().user).toBeNull();

    expect((await post('/auth/login', { email, password: PASSWORD })).statusCode).toBe(401);
    expect((await post('/auth/login', { email, password: 'Brand-new-pass-7' })).statusCode).toBe(
      200,
    );
    // Used once.
    const reused = await post('/auth/password/reset', { token, password: 'Other-pass-77' });
    expect(reused.json()).toEqual({ error: 'invalid_or_used_token' });
  });

  it('an expired reset link is reported as expired', async () => {
    const { email } = await registerAndConfirm();
    await post('/auth/password/forgot', { email });
    const token = linkParam(outbox[0], 'reset');
    await testDb.db
      .update(schema.magicLinkTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.magicLinkTokens.purpose, 'reset_password'));
    expect((await post('/auth/password/reset/check', { token })).statusCode).toBe(410);
    const res = await post('/auth/password/reset', { token, password: 'Brand-new-pass-7' });
    expect(res.statusCode).toBe(410);
    expect(res.json()).toEqual({ error: 'token_expired' });
  });

  it('a reset request for an unknown address answers the same and stores no token', async () => {
    const email = freshEmail();
    const res = await post('/auth/password/forgot', { email });
    expect(res.json()).toEqual({ ok: true });
    expect(outbox[0]!.subject).toBe('Восстановление пароля в Зубрилке');
    expect(outbox[0]!.text).toContain('аккаунта с ним нет');
    const rows = await testDb.db
      .select()
      .from(schema.magicLinkTokens)
      .where(eq(schema.magicLinkTokens.email, email));
    expect(rows).toHaveLength(0);
  });

  it('a passwordless (magic-link) account can add a password only through its mailbox', async () => {
    const email = freshEmail();
    const [user] = await testDb.db.insert(schema.users).values({}).returning();
    await testDb.db
      .insert(schema.authIdentities)
      .values({ userId: user!.id, provider: 'email', providerUserId: email });
    expect((await post('/auth/login', { email, password: PASSWORD })).statusCode).toBe(401);
    await post('/auth/password/forgot', { email });
    const done = await post('/auth/password/reset', {
      token: linkParam(outbox[0], 'reset'),
      password: PASSWORD,
    });
    expect(done.json().user.id).toBe(user!.id);
    expect((await post('/auth/login', { email, password: PASSWORD })).json().user.id).toBe(
      user!.id,
    );
  });

  it('tokens only work for their own purpose', async () => {
    const email = freshEmail();
    await post('/auth/register', { email, password: PASSWORD });
    const confirmToken = linkParam(outbox[0], 'confirm');
    expect((await post('/auth/verify', { token: confirmToken })).statusCode).toBe(400);
    expect(
      (await post('/auth/password/reset', { token: confirmToken, password: 'Brand-new-pass-7' }))
        .statusCode,
    ).toBe(400);
    expect((await post('/auth/register/confirm', { token: 'x'.repeat(40) })).statusCode).toBe(400);
  });

  it('never claims a letter was sent when SMTP is missing or fails', async () => {
    const email = freshEmail();
    const notConfigured = await post(
      '/auth/register',
      { email, password: PASSWORD },
      undefined,
      noSmtpApp,
    );
    expect(notConfigured.statusCode).toBe(503);
    expect(notConfigured.json()).toEqual({ error: 'email_not_configured' });

    failNextSend = true;
    const failed = await post('/auth/register', { email, password: PASSWORD });
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toEqual({ error: 'email_send_failed' });
    expect(JSON.stringify(failed.json())).not.toMatch(/535|EAUTH|password/i);
    const rows = await testDb.db
      .select()
      .from(schema.magicLinkTokens)
      .where(eq(schema.magicLinkTokens.email, email));
    expect(rows).toHaveLength(0);
    // The failed letter did not use up the per-address limit.
    expect((await post('/auth/register', { email, password: PASSWORD })).statusCode).toBe(200);
  });
});
