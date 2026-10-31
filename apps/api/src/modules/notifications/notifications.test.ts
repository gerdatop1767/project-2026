import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createSeededTestDb } from '@zybrilka/db/testing';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { telegramLaunch } from '../../testSupport.js';
import { errorKind, SiteErrorNotifier } from './siteErrors.js';

const BOT_TOKEN = '123456:test-bot-token';
const W = { 'x-zybrilka-admin': '1' };

describe('owner notifications (API side: queued, never blocking)', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let owner: { id: string; cookie: string };
  let student: { id: string; cookie: string };
  let taskId: string;

  async function sessionFor(userId: string) {
    const id = randomUUID();
    await testDb.db
      .insert(schema.authSessions)
      .values({ id, userId, expiresAt: new Date(Date.now() + 3_600_000) });
    return `session_id=${id}`;
  }

  beforeAll(async () => {
    testDb = await createSeededTestDb();
    const [o] = await testDb.db.insert(schema.users).values({}).returning();
    const [s] = await testDb.db.insert(schema.users).values({}).returning();
    owner = { id: o!.id, cookie: await sessionFor(o!.id) };
    student = { id: s!.id, cookie: await sessionFor(s!.id) };
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({
        NODE_ENV: 'test',
        TELEGRAM_BOT_TOKEN: BOT_TOKEN,
        ADMIN_OWNER_USER_IDS: owner.id,
      }),
    });
    app.get('/api/v1/__boom', async () => {
      throw new TypeError('secret detail that must not leak');
    });
    app.get('/api/v1/__teapot', async (_req, reply) => reply.code(418).send({ error: 'nope' }));
    const [task] = await testDb.db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(eq(schema.tasks.status, 'published'))
      .limit(1);
    taskId = task!.id;
  });
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  const outbox = (kind: string) =>
    testDb.db.select().from(schema.telegramOutbox).where(eq(schema.telegramOutbox.kind, kind));

  it('a new registration queues exactly one notification; signing in again adds none', async () => {
    const tgId = 555001;
    const login = () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/telegram',
        payload: { initData: telegramLaunch(BOT_TOKEN, { id: tgId, first_name: 'Тест' }) },
      });
    const first = await login();
    expect(first.statusCode).toBe(200);
    const userId = first.json().user.id as string;
    await login();
    await login();
    const rows = (await outbox('registration')).filter(
      (r) => (r.payload as { userId: string }).userId === userId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({ userId, method: 'telegram', campaign: null });
    // No name, username or Telegram id in the notification.
    expect(JSON.stringify(rows[0]!.payload)).not.toMatch(/Тест|555001/);
  });

  it('a new complaint queues a notification; a repeated one does not', async () => {
    const send = () =>
      app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskId}/complaints`,
        payload: { reason: 'wrong_answer', comment: 'Ответ 7' },
        headers: { cookie: student.cookie },
      });
    const created = await send();
    expect(created.statusCode).toBe(201);
    await send();
    const rows = (await outbox('complaint')).filter(
      (r) => (r.payload as { complaintId: string }).complaintId === created.json().id,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({ taskId, reason: 'wrong_answer', comment: 'Ответ 7' });
    expect((rows[0]!.payload as { reportNumber: number }).reportNumber).toBeGreaterThan(0);
  });

  it('a broken notification queue does not break the complaint itself', async () => {
    await testDb.db.execute(sql`ALTER TABLE telegram_outbox RENAME TO telegram_outbox_off`);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskId}/complaints`,
        payload: { reason: 'condition_error' },
        headers: { cookie: student.cookie },
      });
      expect(res.statusCode).toBe(201);
      const [saved] = await testDb.db
        .select()
        .from(schema.taskComplaints)
        .where(eq(schema.taskComplaints.id, res.json().id));
      expect(saved).toBeDefined();
    } finally {
      await testDb.db.execute(sql`ALTER TABLE telegram_outbox_off RENAME TO telegram_outbox`);
    }
  });

  it('a server error queues one grouped notification with the error type only; 4xx is not an outage', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await app.inject({ method: 'GET', url: '/api/v1/__boom' })).statusCode).toBe(500);
    }
    await app.inject({ method: 'GET', url: '/api/v1/__teapot' });
    // Queued fire-and-forget, after the response: wait for the insert.
    await vi.waitFor(async () => expect(await outbox('site_error')).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    const rows = await outbox('site_error');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({
      method: 'GET',
      route: '/api/v1/__boom',
      status: 500,
      error: 'TypeError',
    });
    expect(JSON.stringify(rows[0]!.payload)).not.toContain('secret detail');
  });

  describe('settings («Уведомления» in the admin panel)', () => {
    it('the owner reads and changes each switch; the change is audited', async () => {
      const get = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/notifications',
        headers: { cookie: owner.cookie },
      });
      expect(get.statusCode).toBe(200);
      expect(get.json().settings).toEqual({
        registrations: true,
        siteErrors: true,
        complaints: true,
        support: true,
      });
      expect(get.json().delivery).toEqual({ botConfigured: true, owners: 1, withTelegram: 0 });
      // No worker has reported yet in this test, and nothing was delivered.
      expect(get.json().worker).toBeNull();
      expect(get.json().lastResult).toBeNull();

      const put = await app.inject({
        method: 'PUT',
        url: '/api/v1/admin/notifications',
        headers: { cookie: owner.cookie, ...W },
        payload: { registrations: false, siteErrors: true, complaints: false },
      });
      expect(put.statusCode).toBe(200);
      const again = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/notifications',
        headers: { cookie: owner.cookie },
      });
      expect(again.json().settings).toEqual({
        registrations: false,
        siteErrors: true,
        complaints: false,
        support: true,
      });
      const audit = await testDb.db
        .select()
        .from(schema.adminAuditLog)
        .where(
          and(
            eq(schema.adminAuditLog.action, 'notifications.updated'),
            eq(schema.adminAuditLog.actorUserId, owner.id),
          ),
        );
      expect(audit).toHaveLength(1);
    });

    it('shows what the worker reported and why the last notification did not arrive', async () => {
      await testDb.db.insert(schema.appSettings).values({
        key: 'worker.status',
        value: {
          at: new Date().toISOString(),
          botConfigured: true,
          polling: false,
          healthCheck: false,
          owners: 1,
        },
      });
      await testDb.db.insert(schema.telegramOutbox).values({
        kind: 'registration',
        payload: { userId: 'x', method: 'vk', at: new Date().toISOString(), campaign: null },
        status: 'failed',
        lastError: 'not_started',
      });
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/notifications',
        headers: { cookie: owner.cookie },
      });
      expect(res.json().worker).toMatchObject({ polling: false, healthCheck: false, stale: false });
      expect(res.json().lastResult).toMatchObject({ status: 'failed', lastError: 'not_started' });
      // The worker status carries booleans only.
      expect(JSON.stringify(res.json().worker)).not.toMatch(/token|:\w{20,}/i);
    });

    it('rejects unknown fields and wrong types', async () => {
      for (const payload of [{ registrations: 'yes' }, { registrations: true, spam: true }]) {
        const res = await app.inject({
          method: 'PUT',
          url: '/api/v1/admin/notifications',
          headers: { cookie: owner.cookie, ...W },
          payload,
        });
        expect(res.statusCode).toBe(400);
      }
    });

    it('a regular user can neither read nor change them', async () => {
      for (const [method, url] of [
        ['GET', '/api/v1/admin/notifications'],
        ['PUT', '/api/v1/admin/notifications'],
        ['POST', '/api/v1/admin/notifications/test'],
      ] as const) {
        const res = await app.inject({
          method,
          url,
          headers: { cookie: student.cookie, ...W },
          ...(method === 'GET' ? {} : { payload: { registrations: false } }),
        });
        expect(res.statusCode).toBe(403);
      }
      const anonymous = await app.inject({ method: 'GET', url: '/api/v1/admin/notifications' });
      expect(anonymous.statusCode).toBe(401);
    });

    it('«Отправить тест» only queues a message for the worker', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/notifications/test',
        headers: { cookie: owner.cookie, ...W },
      });
      expect(res.statusCode).toBe(202);
      expect(await outbox('test')).toHaveLength(1);
    });
  });
});

describe('SiteErrorNotifier', () => {
  it('groups repeats, stays quiet during the cooldown, then reports what it held back', () => {
    let now = 0;
    const sent: { suppressed: number; route: string }[] = [];
    const notifier = new SiteErrorNotifier(
      (n) => sent.push(n),
      15 * 60_000,
      () => now,
    );
    const boom = { method: 'GET', route: '/a', status: 500, error: 'TypeError' };
    notifier.record(boom);
    for (let i = 0; i < 50; i++) {
      now += 1000;
      notifier.record(boom);
    }
    expect(sent).toHaveLength(1);
    // A different error is its own group.
    notifier.record({ ...boom, route: '/b' });
    expect(sent).toHaveLength(2);
    now += 15 * 60_000;
    notifier.record(boom);
    expect(sent).toHaveLength(3);
    expect(sent[2]).toMatchObject({ route: '/a', suppressed: 50 });
  });

  it('errorKind keeps only the class and a code-like code', () => {
    expect(errorKind(new TypeError('user typed <secret>'))).toBe('TypeError');
    expect(errorKind(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe(
      'Error:ECONNREFUSED',
    );
    expect(errorKind(Object.assign(new Error('x'), { code: 'drop table; --' }))).toBe('Error');
    expect(errorKind(null)).toBe('unknown');
  });
});
