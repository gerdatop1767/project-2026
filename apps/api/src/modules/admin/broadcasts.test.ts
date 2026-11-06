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

  describe('«Возврат пользователей»', () => {
    async function student(chatId: number, registeredDaysAgo: number) {
      const createdAt = new Date(Date.now() - registeredDaysAgo * 86_400_000);
      const [u] = await testDb.db
        .insert(schema.users)
        .values({ createdAt, displayName: `S${chatId}` })
        .returning();
      await testDb.db.insert(schema.authIdentities).values({
        userId: u!.id,
        provider: 'telegram',
        providerUserId: `api-${chatId}`,
      });
      await testDb.db.insert(schema.telegramBotChats).values({ chatId, userId: u!.id });
      return u!.id;
    }
    const D3 = { stage: 'd3', accountAgeMinDays: 3, accountAgeMaxDays: 6 } as const;

    it('preview: count, reasons and a contact-free list; exclusions by hand; owner only', async () => {
      const a = await student(7001, 4);
      const b = await student(7002, 5);
      await student(7003, 40); // outside the window
      const preview = await call('POST', '/audience/preview', { audience: D3 });
      expect(preview.statusCode).toBe(200);
      const body = preview.json();
      expect(body.count).toBe(2);
      expect(body.sample.map((u: { id: string }) => u.id).sort()).toEqual([a, b].sort());
      expect(Object.keys(body.sample[0]).sort()).toEqual([
        'id',
        'lastActiveAt',
        'name',
        'registeredAt',
        'solved',
      ]);
      const excluded = (
        await call('POST', '/audience/preview', { audience: { ...D3, excludeUserIds: [b] } })
      ).json();
      expect(excluded.count).toBe(1);
      expect(excluded.leftOut.excludedByHand).toBe(1);
      expect(excluded.excluded[0].id).toBe(b);
      const asUser = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/broadcasts/audience/preview',
        headers: { cookie: userCookie, ...W },
        payload: { audience: D3 },
      });
      expect(asUser.statusCode).toBe(403);
      expect(
        (await call('POST', '/audience/preview', { audience: { stage: 'd5' } })).statusCode,
      ).toBe(400);
    });

    it('a draft keeps its audience and stage; the estimate is the audience, not every chat', async () => {
      const created = (
        await call('POST', '', { text: 'Возвращайся!', audience: D3, trackClicks: true })
      ).json();
      expect(created.broadcast).toMatchObject({ stage: 'd3', trackClicks: true });
      expect(created.audiencePreview.count).toBe(created.recipientsEstimate);
      const cleared = (await call('PATCH', `/${created.broadcast.id}`, { audience: null })).json();
      expect(cleared.broadcast).toMatchObject({ stage: null, audience: null });
      expect(cleared.audiencePreview).toBeNull();
    });

    it('a tracked album cannot be confirmed (no buttons on albums); separate text can', async () => {
      const id = (await call('POST', '', { text: 'Фото', trackClicks: true })).json().broadcast
        .id as string;
      for (let i = 0; i < 2; i++) {
        await app.inject({
          method: 'POST',
          url: `/api/v1/admin/broadcasts/${id}/attachments`,
          headers: { cookie: ownerCookie, ...W, 'content-type': 'image/png' },
          payload: fakePng(32, 32),
        });
      }
      const refused = await call('POST', `/${id}/prepare`);
      expect(refused.statusCode).toBe(400);
      expect(refused.json().message).toMatch(/альбому/);
      await call('PATCH', `/${id}`, { mediaMode: 'separate' });
      expect((await call('POST', `/${id}/prepare`)).statusCode).toBe(200);
    });

    it('the button link records the click once per recipient and opens the site; reaction is honest', async () => {
      const userId = await student(7100, 4);
      const [b] = await testDb.db
        .insert(schema.broadcasts)
        .values({
          authorUserId: userId,
          text: 'x',
          status: 'completed',
          recipientsTotal: 2,
          trackClicks: true,
          stage: 'd3',
          audience: D3,
        })
        .returning();
      const sentAt = new Date(Date.now() - 3 * 3_600_000);
      const [d] = await testDb.db
        .insert(schema.broadcastDeliveries)
        .values([
          { broadcastId: b!.id, chatId: 7100, userId, status: 'sent', sentAt },
          { broadcastId: b!.id, chatId: 7101, status: 'blocked' },
        ])
        .returning();
      const go = (ua = 'Mozilla/5.0') =>
        app.inject({
          method: 'GET',
          url: `/api/v1/go/b/${d!.clickToken}`,
          headers: { 'user-agent': ua },
        });
      const first = await go();
      expect(first.statusCode).toBe(302);
      expect(first.headers.location).toContain('utm_medium=broadcast');
      expect(first.headers.location).toContain(`utm_campaign=${b!.id}`);
      await go();
      await go('TelegramBot (like TwitterBot)'); // a link preview is not a click
      const [row] = await testDb.db
        .select()
        .from(schema.broadcastDeliveries)
        .where(eq(schema.broadcastDeliveries.clickToken, d!.clickToken));
      expect(row!.clickCount).toBe(2);
      expect(row!.clickedAt).not.toBeNull();
      // An unknown token: just the site, nothing recorded.
      const unknown = await app.inject({ method: 'GET', url: `/api/v1/go/b/${randomUUID()}` });
      expect(unknown.statusCode).toBe(302);
      expect(unknown.headers.location).not.toContain('utm_');

      // The student then played: active after the broadcast (answers, not «solved tasks»).
      await testDb.db.insert(schema.miniGameAnswers).values({
        userId,
        gameId: 'stress',
        itemId: randomUUID(),
        correct: true,
        answer: '1',
        clientAnswerId: randomUUID(),
      });
      const detail = (await call('GET', `/${b!.id}`)).json();
      expect(detail.reaction).toMatchObject({
        delivered: 1,
        deliveredToUsers: 1,
        clicked: 1,
        returned: 1,
        returned1d: 1,
        conversionPercent: 100,
        activeAfter: 1,
        answersAfter: 1,
        solvedAfter: 0,
      });
      const list = (await call('GET', '')).json();
      const item = list.items.find((i: { id: string }) => i.id === b!.id);
      expect(item).toMatchObject({ stage: 'd3', targeted: true, trackClicks: true });
      expect(item.reaction.clicked).toBe(1);
      expect(list.totals.clicked).toBeGreaterThanOrEqual(1);
    });
  });
});
