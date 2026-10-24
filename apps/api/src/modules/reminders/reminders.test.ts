import { randomUUID } from 'node:crypto';
import { claimTelegramLinkToken, schema } from '@zybrilka/db';
import { createTestDb } from '@zybrilka/db/testing';
import {
  reminderSettingsResponseSchema,
  telegramLinkConfirmResponseSchema,
  telegramLinkResponseSchema,
} from '@zybrilka/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';

describe('daily reminders — site API', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let anna: string;
  let boris: string;

  async function cookieFor(userId: string) {
    const id = randomUUID();
    await testDb.db
      .insert(schema.authSessions)
      .values({ id, userId, expiresAt: new Date(Date.now() + 3_600_000) });
    return `session_id=${id}`;
  }

  beforeAll(async () => {
    testDb = await createTestDb();
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test', WEB_BASE_URL: 'https://zybrilka.test' }),
    });
    const rows = await testDb.db.insert(schema.users).values([{}, {}]).returning();
    anna = rows[0]!.id;
    boris = rows[1]!.id;
  });
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  it('needs an account', async () => {
    for (const [method, url] of [
      ['GET', '/api/v1/me/reminders'],
      ['PUT', '/api/v1/me/reminders'],
      ['POST', '/api/v1/me/telegram/link'],
      ['POST', '/api/v1/me/telegram/link/confirm'],
    ] as const) {
      const res = await app.inject({ method, url, payload: method === 'GET' ? undefined : {} });
      expect(res.statusCode, url).toBe(401);
    }
  });

  it('defaults: off, 19:00 Moscow, Telegram not linked', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/me/reminders',
      headers: { cookie: await cookieFor(anna) },
    });
    expect(reminderSettingsResponseSchema.parse(res.json())).toEqual({
      enabled: false,
      time: '19:00',
      timezone: 'Europe/Moscow',
      telegram: { linked: false, botStarted: false, blocked: false, pendingLink: null },
    });
  });

  it('saves on the server for this account only, and validates input', async () => {
    const cookie = await cookieFor(anna);
    const put = (payload: Record<string, unknown>) =>
      app.inject({ method: 'PUT', url: '/api/v1/me/reminders', payload, headers: { cookie } });
    const ok = await put({ enabled: true, time: '07:30', timezone: 'Asia/Yekaterinburg' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      enabled: true,
      time: '07:30',
      timezone: 'Asia/Yekaterinburg',
    });
    for (const bad of [
      { enabled: true, time: '25:00', timezone: 'Europe/Moscow' },
      { enabled: true, time: '07:30', timezone: 'Mars/Olympus' },
      { enabled: 'yes', time: '07:30', timezone: 'Europe/Moscow' },
    ]) {
      expect((await put(bad)).statusCode).toBe(400);
    }
    // Boris sees his own (default) settings, not Anna's.
    const other = await app.inject({
      method: 'GET',
      url: '/api/v1/me/reminders',
      headers: { cookie: await cookieFor(boris) },
    });
    expect(other.json().enabled).toBe(false);
    // Off again.
    const off = await put({ enabled: false, time: '07:30', timezone: 'Asia/Yekaterinburg' });
    expect(off.json().enabled).toBe(false);
  });

  it('links Telegram only after the bot claim AND the owner confirms on the site', async () => {
    const borisCookie = await cookieFor(boris);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/me/telegram/link',
      headers: { cookie: borisCookie },
    });
    expect(res.statusCode).toBe(200);
    const { token } = telegramLinkResponseSchema.parse(res.json());
    expect(token.length).toBeLessThanOrEqual(64 - 'link_'.length);
    await testDb.db.insert(schema.telegramBotChats).values({ chatId: 4242 });
    expect(await claimTelegramLinkToken(testDb.db, token, 4242, 'Борис')).toEqual({
      status: 'claimed',
    });
    const status = () =>
      app.inject({ method: 'GET', url: '/api/v1/me/reminders', headers: { cookie: borisCookie } });
    expect((await status()).json().telegram).toEqual({
      linked: false,
      botStarted: false,
      blocked: false,
      pendingLink: { name: 'Борис' },
    });

    const confirm = (cookie: string, payload: unknown) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/me/telegram/link/confirm',
        headers: { cookie },
        payload: payload as Record<string, unknown>,
      });
    expect((await confirm(borisCookie, { accept: 'yes' })).statusCode).toBe(400);
    // Anna cannot confirm Boris's link: she has nothing pending.
    const foreign = await confirm(await cookieFor(anna), { accept: true });
    expect(foreign.json().status).toBe('nothing_pending');

    const ok = await confirm(borisCookie, { accept: true });
    expect(ok.statusCode).toBe(200);
    expect(telegramLinkConfirmResponseSchema.parse(ok.json())).toMatchObject({
      status: 'linked',
      settings: { telegram: { linked: true, botStarted: true, blocked: false, pendingLink: null } },
    });
  });
});
