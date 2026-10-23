import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createTestDb } from '@zybrilka/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { fakePng } from '../../testSupport.js';

const W = { 'x-zybrilka-admin': '1' };

describe('admin «Рассылки» API', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let ownerCookie: string;
  let userCookie: string;

  async function session(userId: string) {
    const id = randomUUID();
    await testDb.db
      .insert(schema.authSessions)
      .values({ id, userId, expiresAt: new Date(Date.now() + 3_600_000) });
    return `session_id=${id}`;
  }

  beforeAll(async () => {
    testDb = await createTestDb();
    const [owner] = await testDb.db.insert(schema.users).values({}).returning();
    const [user] = await testDb.db.insert(schema.users).values({}).returning();
    ownerCookie = await session(owner!.id);
    userCookie = await session(user!.id);
    await testDb.db
      .insert(schema.telegramBotChats)
      .values([{ chatId: 1 }, { chatId: 2 }, { chatId: 3, blockedAt: new Date() }]);
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test', ADMIN_OWNER_USER_IDS: owner!.id }),
    });
  });
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({
      method,
      url: `/api/v1/admin/broadcasts${url}`,
      headers: { cookie: ownerCookie, ...(method === 'GET' ? {} : W) },
      ...(payload ? { payload } : {}),
    });
  const deliveries = () => testDb.db.select().from(schema.broadcastDeliveries);

  it('a draft is saved and shows the expected audience, but nothing is queued or sent', async () => {
    const created = await call('POST', '', { text: '<b>Привет!</b>\nНовые задания' });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.broadcast.status).toBe('draft');
    expect(body.recipientsEstimate).toBe(2); // the blocked chat is not counted
    expect(body.validation).toMatchObject({ ok: true, parts: [{ kind: 'text' }] });
    const id = body.broadcast.id as string;
    expect((await call('PATCH', `/${id}`, { text: 'Изменённый текст' })).statusCode).toBe(200);
    expect((await call('GET', '')).json().items[0].id).toBe(id);
    expect(await deliveries()).toHaveLength(0);
  });

  it('sending needs prepare → explicit confirm; the same broadcast cannot be started twice', async () => {
    const id = (await call('POST', '', { text: 'Рассылка' })).json().broadcast.id as string;
    // Not prepared yet: cannot be confirmed.
    expect((await call('POST', `/${id}/confirm`, { confirm: true })).statusCode).toBe(409);
    expect((await call('POST', `/${id}/prepare`)).json().broadcast.status).toBe(
      'awaiting_confirmation',
    );
    // Frozen while awaiting confirmation.
    expect((await call('PATCH', `/${id}`, { text: 'x' })).statusCode).toBe(409);
    // The confirmation must be explicit.
    expect((await call('POST', `/${id}/confirm`, {})).statusCode).toBe(400);
    const [first, second] = await Promise.all([
      call('POST', `/${id}/confirm`, { confirm: true }),
      call('POST', `/${id}/confirm`, { confirm: true }),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    const [row] = await testDb.db
      .select()
      .from(schema.broadcasts)
      .where(eq(schema.broadcasts.id, id));
    expect(row!.status).toBe('sending');
    expect(row!.confirmedByUserId).not.toBeNull();
    // The API itself never sends — the worker does.
    expect(await deliveries()).toHaveLength(0);
    // And it can be stopped.
    expect((await call('POST', `/${id}/cancel`)).json().broadcast.status).toBe('cancelled');
    expect((await call('POST', `/${id}/cancel`)).statusCode).toBe(409);
  });

  it('refuses content Telegram would refuse', async () => {
    const id = (await call('POST', '', { text: '<script>x</script>' })).json().broadcast.id;
    const prepared = await call('POST', `/${id}/prepare`);
    expect(prepared.statusCode).toBe(400);
    expect(prepared.json().message).toContain('не поддерживает');
    const empty = (await call('POST', '', { text: '' })).json().broadcast.id;
    expect((await call('POST', `/${empty}/prepare`)).json().message).toBe('Сообщение пустое');
  });

  it('images: real PNG/JPEG only, kept in order, removable while a draft', async () => {
    const id = (await call('POST', '', { text: 'С картинкой' })).json().broadcast.id as string;
    const upload = (body: Buffer, type = 'image/png') =>
      app.inject({
        method: 'POST',
        url: `/api/v1/admin/broadcasts/${id}/attachments`,
        headers: { cookie: ownerCookie, ...W, 'content-type': type },
        payload: body,
      });
    expect((await upload(fakePng(64, 64))).statusCode).toBe(201);
    const second = await upload(fakePng(32, 32));
    expect(second.json().attachments.map((a: { position: number }) => a.position)).toEqual([1, 2]);
    expect(second.json().validation.parts).toEqual([{ kind: 'album', withCaption: true }]);
    expect((await upload(Buffer.from('<svg/>'), 'image/png')).statusCode).toBe(400);
    expect((await upload(Buffer.from('GIF89a'), 'image/gif')).statusCode).toBe(415);
    const first = second.json().attachments[0].id as string;
    const image = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/broadcasts/${id}/attachments/${first}`,
      headers: { cookie: ownerCookie },
    });
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    const removed = await call('DELETE', `/${id}/attachments/${first}`);
    expect(removed.json().attachments).toHaveLength(1);
  });

  it('«Отправить себе» only marks a test for the worker', async () => {
    const id = (await call('POST', '', { text: 'Тест' })).json().broadcast.id as string;
    const res = await call('POST', `/${id}/test`);
    expect(res.statusCode).toBe(202);
    expect(res.json().broadcast).toMatchObject({ status: 'draft', testStatus: 'pending' });
    expect(await deliveries()).toHaveLength(0);
  });

  it('is owner-only: a regular user is refused everywhere', async () => {
    for (const [method, url] of [
      ['GET', ''],
      ['POST', ''],
      ['POST', `/${randomUUID()}/confirm`],
    ] as const) {
      const res = await app.inject({
        method,
        url: `/api/v1/admin/broadcasts${url}`,
        headers: { cookie: userCookie, ...W },
        ...(method === 'POST' ? { payload: { confirm: true } } : {}),
      });
      expect(res.statusCode).toBe(403);
    }
  });
});
