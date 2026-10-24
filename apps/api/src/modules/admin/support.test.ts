import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createTestDb } from '@zybrilka/db/testing';
import {
  supportThreadDetailSchema,
  supportThreadSummarySchema,
  supportTexts,
} from '@zybrilka/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { supportRoutes } from './support.js';

const W = { 'x-zybrilka-admin': '1' };
const CHAT = 777000111;

describe('admin support API', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let owner: string;
  let student: string;
  let ownerCookie: string;
  let studentCookie: string;
  let threadId: string;

  async function cookieFor(userId: string) {
    const id = randomUUID();
    await testDb.db
      .insert(schema.authSessions)
      .values({ id, userId, expiresAt: new Date(Date.now() + 3_600_000) });
    return `session_id=${id}`;
  }

  beforeAll(async () => {
    testDb = await createTestDb();
    const rows = await testDb.db
      .insert(schema.users)
      .values([{ firstName: 'Owner' }, { firstName: 'Маша', lastName: 'Иванова' }])
      .returning();
    owner = rows[0]!.id;
    student = rows[1]!.id;
    ownerCookie = await cookieFor(owner);
    studentCookie = await cookieFor(student);
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({
        NODE_ENV: 'test',
        WEB_BASE_URL: 'https://zybrilka.test',
        ADMIN_OWNER_USER_IDS: owner,
      }),
    });
    // Maша linked Telegram and started the bot; she wrote to support.
    await testDb.db
      .insert(schema.authIdentities)
      .values({ userId: student, provider: 'telegram', providerUserId: String(CHAT) });
    await testDb.db.insert(schema.telegramBotChats).values({ chatId: CHAT, userId: student });
    const [thread] = await testDb.db
      .insert(schema.supportThreads)
      .values({ chatId: CHAT, userId: student, lastUserMessageAt: new Date() })
      .returning();
    threadId = thread!.id;
    await testDb.db.insert(schema.supportMessages).values({
      threadId,
      chatId: CHAT,
      direction: 'user',
      text: 'Не открывается задание 5',
      telegramMessageId: 10,
      attachments: [{ kind: 'photo', fileId: 'AgAC-file' }],
    });
  });
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  const asOwner = (method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) =>
    app.inject({
      method,
      url,
      payload,
      headers: { cookie: ownerCookie, ...(method === 'POST' ? W : {}) },
    });

  it('only the owner: a student gets 403, a guest 401 — reading and writing alike', async () => {
    const urls: ['GET' | 'POST', string, Record<string, unknown>?][] = [
      ['GET', '/api/v1/admin/support/threads'],
      ['GET', `/api/v1/admin/support/threads/${threadId}`],
      ['POST', `/api/v1/admin/support/threads/${threadId}/messages`, { text: 'hi' }],
      ['POST', '/api/v1/admin/support/start', { userId: student, text: 'hi' }],
      ['GET', '/api/v1/admin/support/users?q=Маша'],
    ];
    for (const [method, url, payload] of urls) {
      const guest = await app.inject({ method, url, payload });
      expect(guest.statusCode, url).toBe(401);
      const asStudent = await app.inject({
        method,
        url,
        payload,
        headers: { cookie: studentCookie, ...W },
      });
      expect(asStudent.statusCode, url).toBe(403);
    }
    const queued = await testDb.db
      .select()
      .from(schema.supportMessages)
      .where(eq(schema.supportMessages.direction, 'admin'));
    expect(queued).toHaveLength(0);
  });

  it('lists the thread as unread, with a name and a preview — never a Telegram id', async () => {
    const res = await asOwner('GET', '/api/v1/admin/support/threads');
    expect(res.statusCode).toBe(200);
    const body = z
      .object({ items: z.array(supportThreadSummarySchema), unread: z.number() })
      .parse(res.json());
    expect(body.unread).toBe(1);
    expect(body.items[0]).toMatchObject({
      id: threadId,
      name: 'Маша Иванова',
      unread: true,
      lastMessagePreview: 'Не открывается задание 5',
      lastMessageFrom: 'user',
    });
    expect(res.body).not.toContain(String(CHAT));
    expect(res.body).not.toContain('AgAC-file');
  });

  it('opens the dialog, marks it read, queues a reply for the worker', async () => {
    const detail = supportThreadDetailSchema.parse(
      (await asOwner('GET', `/api/v1/admin/support/threads/${threadId}`)).json(),
    );
    expect(detail.thread.reachable).toBe(true);
    expect(detail.messages[0]!.attachments[0]!.url).toMatch(/\/files\/0$/);
    expect(
      (await asOwner('POST', `/api/v1/admin/support/threads/${threadId}/read`)).statusCode,
    ).toBe(204);
    const sent = await asOwner('POST', `/api/v1/admin/support/threads/${threadId}/messages`, {
      text: 'Здравствуйте! Уже смотрим.',
    });
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({ direction: 'admin', delivery: 'pending' });
    const [queued] = await testDb.db
      .select()
      .from(schema.supportMessages)
      .where(eq(schema.supportMessages.direction, 'admin'));
    expect(queued).toMatchObject({ chatId: CHAT, deliveryStatus: 'pending', authorUserId: owner });
    const list = (await asOwner('GET', '/api/v1/admin/support/threads')).json();
    expect(list.unread).toBe(0);
  });

  it('closes (telling the user) and reopens; a closed thread takes no replies', async () => {
    const closed = await asOwner('POST', `/api/v1/admin/support/threads/${threadId}/status`, {
      status: 'closed',
    });
    expect(closed.json().thread.status).toBe('closed');
    const notice = (
      await testDb.db
        .select()
        .from(schema.supportMessages)
        .where(eq(schema.supportMessages.threadId, threadId))
    ).at(-1);
    expect(notice).toMatchObject({ text: supportTexts.closedByAdmin, deliveryStatus: 'pending' });
    const refused = await asOwner('POST', `/api/v1/admin/support/threads/${threadId}/messages`, {
      text: 'ещё',
    });
    expect(refused.statusCode).toBe(409);
    const reopened = await asOwner('POST', `/api/v1/admin/support/threads/${threadId}/status`, {
      status: 'open',
    });
    expect(reopened.json().thread.status).toBe('open');
  });

  it('writing first: only to someone the bot may message, one person at a time', async () => {
    const [nobody] = await testDb.db
      .insert(schema.users)
      .values({ firstName: 'Маша', lastName: 'Без Телеграма' })
      .returning();
    const search = (await asOwner('GET', '/api/v1/admin/support/users?q=Маша')).json();
    const byName = Object.fromEntries(search.items.map((i: { name: string }) => [i.name, i]));
    expect(byName['Маша Иванова']).toMatchObject({ reachable: true, openThreadId: threadId });
    expect(byName['Маша Без Телеграма']).toMatchObject({ reachable: false, reason: 'no_telegram' });
    const refused = await asOwner('POST', '/api/v1/admin/support/start', {
      userId: nobody!.id,
      text: 'Привет',
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: 'unreachable', reason: 'no_telegram' });
    // The reachable one: reuses her open thread.
    const ok = await asOwner('POST', '/api/v1/admin/support/start', {
      userId: student,
      text: 'Привет!',
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().threadId).toBe(threadId);
    // Blocked bot: an honest reason.
    await testDb.db
      .update(schema.telegramBotChats)
      .set({ blockedAt: new Date() })
      .where(eq(schema.telegramBotChats.chatId, CHAT));
    const blocked = await asOwner('POST', '/api/v1/admin/support/start', {
      userId: student,
      text: 'Привет!',
    });
    expect(blocked.json()).toEqual({ error: 'unreachable', reason: 'blocked' });
  });

  it('attachments are streamed from Telegram without exposing the token', async () => {
    const calls: string[] = [];
    const fakeFetch = (async (url: string | URL) => {
      calls.push(String(url));
      if (String(url).includes('/getFile')) {
        return new Response(JSON.stringify({ ok: true, result: { file_path: 'photos/a.jpg' } }));
      }
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]));
    }) as typeof fetch;
    const fastify = (await import('fastify')).default;
    const local = fastify();
    await local.register(supportRoutes, {
      db: testDb.db,
      botToken: 'TOKEN123',
      fetchImpl: fakeFetch,
    });
    const [message] = await testDb.db
      .select()
      .from(schema.supportMessages)
      .where(eq(schema.supportMessages.telegramMessageId, 10));
    const res = await local.inject({
      method: 'GET',
      url: `/admin/support/messages/${message!.id}/files/0`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['content-security-policy']).toContain('sandbox');
    expect(res.body).not.toContain('TOKEN123');
    expect(calls[0]).toContain('file_id=AgAC-file');
    const missing = await local.inject({
      method: 'GET',
      url: `/admin/support/messages/${message!.id}/files/3`,
    });
    expect(missing.statusCode).toBe(404);
    await local.close();
  });
});
