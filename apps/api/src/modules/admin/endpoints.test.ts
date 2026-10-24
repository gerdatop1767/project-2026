import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createSeededTestDb } from '@zybrilka/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { moscowDate, addDays } from './period.js';
import { streaks } from './reports/users.js';
import { fixtures } from './testFixtures.js';

const WEB = 'https://zybrilka.test';
const W = { 'x-zybrilka-admin': '1' };

describe('admin endpoints (as the owner)', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let f: ReturnType<typeof fixtures>;
  let owner: string;
  let cookie: string;
  let student: string;
  let tasks: { id: string; taskNumber: number }[];
  const today = moscowDate(new Date());
  const isoDaysAgo = (n: number, hour = 9) =>
    `${addDays(today, -n)}T${String(hour).padStart(2, '0')}:00:00+03:00`;

  beforeAll(async () => {
    testDb = await createSeededTestDb();
    f = fixtures(testDb.db);
    owner = await f.user(isoDaysAgo(100), 'email');
    cookie = await f.session(owner);
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test', WEB_BASE_URL: WEB, ADMIN_OWNER_USER_IDS: owner }),
    });
    tasks = await f.publishedTasks('math', 3);
    student = await f.user(isoDaysAgo(20), 'vk');
    await testDb.db
      .update(schema.users)
      .set({ displayName: '=HYPERLINK("http://evil")' })
      .where(eq(schema.users.id, student));
    await testDb.db
      .insert(schema.userSubjectProfiles)
      .values({ userId: student, subjectId: 'math' });
    for (let i = 0; i < 12; i++) {
      await f.attempt(
        student,
        tasks[i % 3]!.id,
        i % 3 !== 0,
        isoDaysAgo(20 - (i % 4), 10 + (i % 5)),
      );
    }
    await f.attempt(student, tasks[0]!.id, true, isoDaysAgo(13)); // active a week after registering
    const quiet = await f.user(isoDaysAgo(3), 'telegram');
    void quiet;
  });
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  const get = (url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
  const send = (method: 'POST' | 'PATCH' | 'PUT', url: string, payload: unknown) =>
    app.inject({ method, url, headers: { cookie, ...W }, payload: payload as object });

  it.each([
    '/api/v1/admin/overview?period=30d',
    '/api/v1/admin/growth?period=90d&granularity=week',
    '/api/v1/admin/content/subjects?period=30d',
    '/api/v1/admin/content/subjects/math?period=30d',
    '/api/v1/admin/content/tasks?period=30d&subject=math&sort=attempts&dir=desc',
    '/api/v1/admin/users?segment=all&sort=solves',
    '/api/v1/admin/funnels?period=30d',
    '/api/v1/admin/thresholds?period=30d',
    '/api/v1/admin/retention?cohort=week&basis=registration',
    '/api/v1/admin/retention?cohort=month&basis=first_activity',
    '/api/v1/admin/campaigns?period=30d',
    '/api/v1/admin/complaints',
    '/api/v1/admin/quality?period=30d',
    '/api/v1/admin/health',
    '/api/v1/admin/alerts',
    '/api/v1/admin/audit',
    '/api/v1/admin/settings',
  ])('GET %s → 200 for the owner', async (url) => {
    const res = await get(url);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each([
    ['/api/v1/admin/overview?period=forever', 'invalid_query'],
    ['/api/v1/admin/overview?period=custom&from=2026-02-30&to=2026-03-01', 'invalid_date'],
    ['/api/v1/admin/overview?period=custom&from=2001-01-01&to=2026-01-01', 'period_too_long'],
    ['/api/v1/admin/users?pageSize=100000', 'invalid_query'],
    ['/api/v1/admin/users?minSolves=7', 'invalid_query'],
    ['/api/v1/admin/users/not-a-uuid', 'invalid_id'],
    ["/api/v1/admin/content/subjects/math';--", 'invalid_id'],
    ['/api/v1/admin/export/passwords', 'invalid_kind'],
  ])('rejects invalid input %s', async (url, error) => {
    const res = await get(url);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error });
  });

  it('404 for unknown objects', async () => {
    for (const url of [
      `/api/v1/admin/users/${randomUUID()}`,
      `/api/v1/admin/content/tasks/${randomUUID()}`,
      `/api/v1/admin/complaints/${randomUUID()}`,
      `/api/v1/admin/campaigns/${randomUUID()}`,
      '/api/v1/admin/content/subjects/klingon',
    ]) {
      expect((await get(url)).statusCode, url).toBe(404);
    }
  });

  it('user list: registered only, filters, no secrets', async () => {
    const all = (await get('/api/v1/admin/users')).json();
    expect(all.total).toBe(3); // owner, student, quiet
    const ten = (await get('/api/v1/admin/users?minSolves=10')).json();
    expect(ten.items.map((u: { id: string }) => u.id)).toEqual([student]);
    expect(ten.items[0]).toMatchObject({ solves: 13, subjects: ['math'], source: 'unknown' });
    const none = (await get('/api/v1/admin/users?segment=no_solves')).json();
    expect(none.total).toBe(2);
    const byName = (await get('/api/v1/admin/users?q=HYPERLINK')).json();
    expect(byName.total).toBe(1);
    const card = await get(`/api/v1/admin/users/${student}`);
    expect(card.statusCode).toBe(200);
    const body = card.body;
    for (const secret of ['session_id', 'answer_raw', 'answerRaw', 'provider_user_id', 'token']) {
      expect(body).not.toContain(secret);
    }
    expect(card.json().history.length).toBe(13);
  });

  it('thresholds count the N-th answer once per user', async () => {
    const res = (await get('/api/v1/admin/thresholds?period=30d')).json();
    const by = Object.fromEntries(
      res.thresholds.map((t: { threshold: number; ever: number }) => [t.threshold, t.ever]),
    );
    expect(by).toMatchObject({ 1: 1, 5: 1, 10: 1, 25: 0 });
  });

  it('streaks: current survives until the end of the next day', () => {
    expect(streaks(['2026-03-01', '2026-03-02', '2026-03-03'], '2026-03-04')).toEqual({
      current: 3,
      best: 3,
    });
    expect(streaks(['2026-03-01', '2026-03-03'], '2026-03-06')).toEqual({ current: 0, best: 1 });
    expect(streaks([], '2026-03-06')).toEqual({ current: 0, best: 0 });
  });

  describe('campaigns', () => {
    it('creates a tracked link on our domain only', async () => {
      const res = await send('POST', '/api/v1/admin/campaigns', {
        name: 'Осень ВК',
        source: 'VK',
        channel: 'ads',
        creative: 'баннер 1',
        targetPath: '/training',
      });
      expect(res.statusCode, res.body).toBe(201);
      const c = res.json();
      expect(c.source).toBe('vk');
      expect(c.link.web).toBe(`${WEB}/api/v1/go/${c.slug}`);
      const click = await app.inject({
        method: 'GET',
        url: `/api/v1/go/${c.slug}`,
        // A visitor who accepted analytics cookies (zc=a1): counted as a visitor.
        headers: { 'user-agent': 'Mozilla/5.0', cookie: 'zc=a1' },
      });
      expect(click.headers.location).toBe(`${WEB}/training`);
      const list = (await get('/api/v1/admin/campaigns?period=7d')).json();
      expect(list.items.find((i: { id: string }) => i.id === c.id)).toMatchObject({
        clicks: 1,
        uniqueVisitors: 1,
        registrations: 0,
      });
      const audit = await testDb.db
        .select()
        .from(schema.adminAuditLog)
        .where(eq(schema.adminAuditLog.objectId, c.id));
      expect(audit.map((a) => a.action)).toEqual(['campaign.created']);
    });

    it.each(['https://evil.example', '//evil.example', '/admin', '/training?next=//evil'])(
      'refuses target %s',
      async (targetPath) => {
        const res = await send('POST', '/api/v1/admin/campaigns', {
          name: 'x',
          source: 'vk',
          channel: 'ads',
          targetPath,
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toBe('target_not_allowed');
      },
    );

    it('disabling needs confirmation and stops the link counting', async () => {
      const c = (
        await send('POST', '/api/v1/admin/campaigns', {
          name: 'Off',
          source: 'tg',
          channel: 'post',
          targetPath: '/',
        })
      ).json();
      const unconfirmed = await send('PATCH', `/api/v1/admin/campaigns/${c.id}/status`, {
        status: 'disabled',
      });
      expect(unconfirmed.statusCode).toBe(400);
      const ok = await send('PATCH', `/api/v1/admin/campaigns/${c.id}/status`, {
        status: 'disabled',
        confirm: true,
      });
      expect(ok.json().status).toBe('disabled');
      const click = await app.inject({
        method: 'GET',
        url: `/api/v1/go/${c.slug}`,
        headers: { 'user-agent': 'Mozilla/5.0' },
      });
      expect(click.headers.location).toBe(`${WEB}/`);
    });
  });

  describe('complaints', () => {
    it('status changes and internal comments are audited and shown as history', async () => {
      const [c] = await testDb.db
        .insert(schema.taskComplaints)
        .values({ taskId: tasks[0]!.id, userId: student, reason: 'wrong_answer', comment: 'тут 7' })
        .returning();
      const list = (await get('/api/v1/admin/complaints?status=new')).json();
      expect(list.items[0]).toMatchObject({ id: c!.id, reason: 'wrong_answer', status: 'new' });
      expect(
        (await send('PATCH', `/api/v1/admin/complaints/${c!.id}`, { status: 'closed' })).statusCode,
      ).toBe(400);
      expect((await send('PATCH', `/api/v1/admin/complaints/${c!.id}`, {})).statusCode).toBe(400);
      const upd = await send('PATCH', `/api/v1/admin/complaints/${c!.id}`, {
        status: 'fixed',
        internalComment: 'Исправлен ответ',
      });
      expect(upd.statusCode).toBe(200);
      expect(upd.json()).toMatchObject({ status: 'fixed', internalComment: 'Исправлен ответ' });
      expect(upd.json().resolvedAt).not.toBeNull();
      const card = (await get(`/api/v1/admin/complaints/${c!.id}`)).json();
      expect(card.history).toHaveLength(1);
      expect(card.history[0].details).toEqual({
        status: { from: 'new', to: 'fixed' },
        internalCommentChanged: true,
      });
      expect(upd.json().handledByUserId).toBe(owner);
    });

    it('search by RPT number or id, sort by date, and mark a duplicate', async () => {
      const [first] = await testDb.db
        .insert(schema.taskComplaints)
        .values({
          taskId: tasks[1]!.id,
          userId: student,
          reason: 'condition_error',
          createdAt: new Date(Date.now() - 3_600_000),
        })
        .returning();
      const [second] = await testDb.db
        .insert(schema.taskComplaints)
        .values({ taskId: tasks[1]!.id, userId: student, reason: 'condition_error' })
        .returning();

      const byNumber = (await get(`/api/v1/admin/complaints?q=RPT-${second!.reportNumber}`)).json();
      expect(byNumber.items.map((i: { id: string }) => i.id)).toEqual([second!.id]);
      const byUuid = (await get(`/api/v1/admin/complaints?q=${first!.id}`)).json();
      expect(byUuid.items.map((i: { id: string }) => i.id)).toEqual([first!.id]);
      const byTask = (await get(`/api/v1/admin/complaints?q=${tasks[1]!.id}`)).json();
      expect(byTask.total).toBeGreaterThanOrEqual(2);
      expect((await get('/api/v1/admin/complaints?q=garbage')).json().total).toBe(0);

      const oldest = (
        await get(`/api/v1/admin/complaints?taskId=${tasks[1]!.id}&sort=oldest`)
      ).json();
      expect(oldest.items.map((i: { id: string }) => i.id)).toEqual([first!.id, second!.id]);
      const newest = (
        await get(`/api/v1/admin/complaints?taskId=${tasks[1]!.id}&sort=newest`)
      ).json();
      expect(newest.items[0].id).toBe(second!.id);

      const self = await send('PATCH', `/api/v1/admin/complaints/${second!.id}`, {
        duplicateOf: `RPT-${second!.reportNumber}`,
      });
      expect(self.json()).toEqual({ error: 'duplicate_self' });
      const missing = await send('PATCH', `/api/v1/admin/complaints/${second!.id}`, {
        duplicateOf: 'RPT-999999',
      });
      expect(missing.json()).toEqual({ error: 'duplicate_not_found' });
      const dup = await send('PATCH', `/api/v1/admin/complaints/${second!.id}`, {
        duplicateOf: `RPT-${first!.reportNumber}`,
      });
      expect(dup.statusCode).toBe(200);
      expect(dup.json()).toMatchObject({ duplicateOfId: first!.id, status: 'rejected' });
      const card = (await get(`/api/v1/admin/complaints/${second!.id}`)).json();
      expect(card.complaint.duplicateOf).toBe(first!.reportNumber);
      expect(card.report.duplicateOf).toBe(first!.reportNumber);
    });

    it('the CSV export applies exactly the list’s search and filters', async () => {
      const [a] = await testDb.db
        .insert(schema.taskComplaints)
        .values({ taskId: tasks[0]!.id, userId: student, reason: 'wrong_topic', comment: 'csv-a' })
        .returning();
      const [b] = await testDb.db
        .insert(schema.taskComplaints)
        .values({ taskId: tasks[2]!.id, userId: student, reason: 'wrong_topic', comment: 'csv-b' })
        .returning();
      const csv = async (query: string) => {
        const res = await get(`/api/v1/admin/export/complaints?period=30d&${query}`);
        expect(res.statusCode, query).toBe(200);
        return res.body;
      };
      const listIds = async (query: string) =>
        (await get(`/api/v1/admin/complaints?pageSize=100&${query}`))
          .json()
          .items.map((i: { id: string }) => i.id)
          .sort();
      const csvIds = (body: string) =>
        [...body.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)]
          .map((m) => m[0])
          .filter((id, i, all) => all.indexOf(id) === i);
      // Search by RPT number, by complaint id and by task id.
      const byNumber = await csv(`q=RPT-${a!.reportNumber}`);
      expect(byNumber).toContain(`RPT-${a!.reportNumber}`);
      expect(byNumber).toContain('csv-a');
      expect(byNumber).not.toContain('csv-b');
      const byId = await csv(`q=${b!.id}`);
      expect(byId).toContain('csv-b');
      expect(byId).not.toContain('csv-a');
      const byTask = await csv(`q=${tasks[2]!.id}`);
      expect(byTask).toContain('csv-b');
      expect(byTask).not.toContain('csv-a');
      // Same rows as the list for the same filters.
      for (const query of [
        `q=${tasks[2]!.id}`,
        'reason=wrong_topic',
        'reason=wrong_topic&status=new',
      ]) {
        const complaintIds = csvIds(await csv(query)).filter((id) => [a!.id, b!.id].includes(id));
        const fromList = (await listIds(query)).filter((id: string) => [a!.id, b!.id].includes(id));
        expect(complaintIds.sort(), query).toEqual(fromList);
      }
      // A search that is no id matches nothing, as in the list.
      expect(await csv('q=garbage')).not.toMatch(/csv-a|csv-b/);
      // An unreadable filter is a 400, not a server error.
      const bad = await get('/api/v1/admin/export/complaints?period=30d&status=closed');
      expect(bad.statusCode).toBe(400);
    });

    it('the card carries the real task data for the Claude report — nothing invented', async () => {
      const [c] = await testDb.db
        .insert(schema.taskComplaints)
        .values({
          taskId: tasks[2]!.id,
          userId: student,
          reason: 'wrong_answer',
          comment: 'Ответ 5, а не 4',
        })
        .returning();
      const [task] = await testDb.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, tasks[2]!.id));
      const card = (await get(`/api/v1/admin/complaints/${c!.id}`)).json();
      expect(card.report).toMatchObject({
        reportNumber: c!.reportNumber,
        id: c!.id,
        taskId: task!.id,
        taskNumber: task!.taskNumber,
        reason: 'wrong_answer',
        comment: 'Ответ 5, а не 4',
        statement: task!.conditionMd,
        statementFromSnapshot: false, // inserted directly: no snapshot
        taskChangedSinceReport: null,
        context: null,
        adminUrl: `${WEB}/admin/complaints/${c!.id}`,
      });
      expect(card.complaint.taskStatement).toBe(task!.conditionMd);
    });
  });

  describe('task status', () => {
    it('needs confirmation, is audited, and changes what users see', async () => {
      const id = tasks[2]!.id;
      expect(
        (await send('POST', `/api/v1/admin/content/tasks/${id}/status`, { status: 'archived' }))
          .statusCode,
      ).toBe(400);
      const res = await send('POST', `/api/v1/admin/content/tasks/${id}/status`, {
        status: 'archived',
        confirm: true,
      });
      expect(res.json()).toMatchObject({ status: 'archived', previousStatus: 'published' });
      const card = (await get(`/api/v1/admin/content/tasks/${id}?period=30d`)).json();
      expect(card.task.status).toBe('archived');
      expect(card.history[0]).toMatchObject({ action: 'task.status_changed' });
      await send('POST', `/api/v1/admin/content/tasks/${id}/status`, {
        status: 'published',
        confirm: true,
      });
    });
  });

  it('revoking a user’s sessions signs them out everywhere (audited, confirmed)', async () => {
    const studentCookie = await f.session(student);
    expect(
      (await send('POST', `/api/v1/admin/users/${student}/revoke-sessions`, {})).statusCode,
    ).toBe(400);
    const res = await send('POST', `/api/v1/admin/users/${student}/revoke-sessions`, {
      confirm: true,
    });
    expect(res.json()).toEqual({ revoked: 1 });
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/progress/summary',
      headers: { cookie: studentCookie },
    });
    expect(me.statusCode).toBe(401);
    expect(
      (await send('POST', `/api/v1/admin/users/${owner}/revoke-sessions`, { confirm: true }))
        .statusCode,
    ).toBe(400);
  });

  it('settings: validated, saved and audited', async () => {
    const current = (await get('/api/v1/admin/settings')).json();
    expect(current.channels).toEqual({ telegram: 'not_connected', email: 'not_connected' });
    const bad = await send('PUT', '/api/v1/admin/settings', {
      ...current.settings,
      quality: { ...current.settings.quality, minSample: -5 },
    });
    expect(bad.statusCode).toBe(400);
    const next = { ...current.settings, quality: { ...current.settings.quality, minSample: 40 } };
    const ok = await send('PUT', '/api/v1/admin/settings', next);
    expect(ok.statusCode).toBe(200);
    expect((await get('/api/v1/admin/settings')).json().settings.quality.minSample).toBe(40);
  });

  it('CSV export: escaped against formula injection, no secrets, audited', async () => {
    const res = await get('/api/v1/admin/export/users');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="zybrilka-users-/);
    expect(res.body.startsWith('﻿')).toBe(true);
    expect(res.body).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(res.body).not.toMatch(/session|token|@/i);
    for (const kind of ['overview', 'subjects', 'numbers', 'campaigns', 'complaints', 'quality']) {
      const r = await get(`/api/v1/admin/export/${kind}?period=30d`);
      expect(r.statusCode, kind).toBe(200);
    }
    const audit = await testDb.db
      .select()
      .from(schema.adminAuditLog)
      .where(eq(schema.adminAuditLog.action, 'export.csv'));
    // Every export is audited (other tests export too, so check by kind).
    expect(new Set(audit.map((e) => e.objectId))).toEqual(
      new Set(['users', 'overview', 'subjects', 'numbers', 'campaigns', 'complaints', 'quality']),
    );
  });

  it('the audit log lists actions and cannot be changed through the API', async () => {
    const res = (await get('/api/v1/admin/audit?objectType=campaign')).json();
    expect(res.total).toBeGreaterThan(0);
    for (const method of ['DELETE', 'PUT', 'PATCH'] as const) {
      const r = await app.inject({
        method,
        url: '/api/v1/admin/audit',
        headers: { cookie, ...W },
        payload: {},
      });
      expect(r.statusCode).toBe(404);
    }
  });

  it('health reports only what it knows', async () => {
    const res = (await get('/api/v1/admin/health')).json();
    expect(res.database.status).toBe('ok');
    expect(res.unknown.backups).toMatch(/Нет данных/);
    expect(JSON.stringify(res)).not.toMatch(/DATABASE_URL|postgres:\/\/|password/i);
  });
});
