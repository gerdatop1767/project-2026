import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createSeededTestDb } from '@zybrilka/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { telegramLaunch } from '../../testSupport.js';
import { isAllowedCampaignTarget } from './campaignLinks.js';

const BOT_TOKEN = '123456:TEST-ONLY-analytics';
const WEB = 'https://zybrilka.test';

describe('product analytics, campaign links, attribution, complaints', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let task: { id: string; correctAnswer: string };
  let campaignId: string;

  beforeAll(async () => {
    testDb = await createSeededTestDb();
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({
        NODE_ENV: 'test',
        TELEGRAM_BOT_TOKEN: BOT_TOKEN,
        WEB_BASE_URL: WEB,
      }),
    });
    const [row] = await testDb.db
      .select({ id: schema.tasks.id, correctAnswer: schema.tasks.correctAnswer })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.answerType, 'short_answer'), eq(schema.tasks.status, 'published')))
      .limit(1);
    task = row!;
    const [campaign] = await testDb.db
      .insert(schema.campaigns)
      .values({
        slug: 'spring-tg-01',
        name: 'Весна, Telegram',
        source: 'telegram',
        channel: 'post',
        targetPath: '/training',
      })
      .returning();
    campaignId = campaign!.id;
    await testDb.db.insert(schema.campaigns).values({
      slug: 'old-disabled',
      name: 'Off',
      source: 'vk',
      channel: 'ad',
      status: 'disabled',
    });
  });
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  const events = (type: string) =>
    testDb.db.select().from(schema.analyticsEvents).where(eq(schema.analyticsEvents.type, type));
  const visitorCookie = (res: { cookies: { name: string; value: string; httpOnly?: boolean }[] }) =>
    res.cookies.find((c) => c.name === 'zv');

  describe('POST /api/v1/events', () => {
    it('creates a visitor (httpOnly cookie) and records events idempotently', async () => {
      const batch = {
        client: 'web',
        events: [
          { id: randomUUID(), type: 'visit' },
          { id: randomUUID(), type: 'subject_selected', subjectId: 'math' },
        ],
      };
      const first = await app.inject({ method: 'POST', url: '/api/v1/events', payload: batch });
      expect(first.statusCode).toBe(204);
      const cookie = visitorCookie(first)!;
      expect(cookie.httpOnly).toBe(true);
      // The same batch again (a retry) changes nothing.
      const retry = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        payload: batch,
        headers: { cookie: `zv=${cookie.value}` },
      });
      expect(retry.statusCode).toBe(204);
      expect(visitorCookie(retry)).toBeUndefined(); // known visitor, no new cookie
      const selected = (await events('subject_selected')).filter(
        (e) => e.visitorId === cookie.value,
      );
      expect(selected).toHaveLength(1);
      expect(selected[0]).toMatchObject({ subjectId: 'math', userId: null });
    });

    it('replaces a forged/unknown visitor cookie instead of adopting it', async () => {
      const forged = randomUUID();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        payload: { events: [{ id: randomUUID(), type: 'visit' }] },
        headers: { cookie: `zv=${forged}` },
      });
      expect(res.statusCode).toBe(204);
      expect(visitorCookie(res)!.value).not.toBe(forged);
    });

    it.each([
      { events: [] },
      { events: [{ id: randomUUID(), type: 'registration_completed' }] },
      { events: [{ id: 'nope', type: 'visit' }] },
      { events: [{ id: randomUUID(), type: 'visit', subjectId: "math'; drop" }] },
      { events: Array.from({ length: 21 }, () => ({ id: randomUUID(), type: 'visit' })) },
    ])('rejects invalid input (server-only types, bad ids, oversize batches)', async (payload) => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/events', payload });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('answer_checked', () => {
    it('counts a guest check by visitor, without the entered answer', async () => {
      const visit = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        payload: { events: [{ id: randomUUID(), type: 'visit' }] },
      });
      const zv = visitorCookie(visit)!.value;
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/attempt`,
        payload: { answer: 'definitely-wrong-123' },
        headers: { cookie: `zv=${zv}` },
      });
      expect(res.statusCode).toBe(200);
      const rows = (await events('answer_checked')).filter((e) => e.visitorId === zv);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ userId: null, taskId: task.id });
      expect(rows[0]!.props).toEqual({ correct: false, guest: true });
      expect(JSON.stringify(rows[0])).not.toContain('definitely-wrong-123');
    });
  });

  describe('campaign links (/api/v1/go/:slug)', () => {
    it('counts the click and redirects to the campaign page on this site', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/go/spring-tg-01',
        headers: { 'user-agent': 'Mozilla/5.0 (iPhone)' },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(`${WEB}/training`);
      const zv = visitorCookie(res)!.value;
      const [visitor] = await testDb.db
        .select()
        .from(schema.analyticsVisitors)
        .where(eq(schema.analyticsVisitors.id, zv));
      expect(visitor!.campaignId).toBe(campaignId);
      expect((await events('campaign_click')).some((e) => e.visitorId === zv)).toBe(true);
    });

    it.each(['old-disabled', 'no-such-campaign', '..%2F..%2Fevil', 'x'])(
      '%s → home page, nothing counted',
      async (slug) => {
        const before = (await events('campaign_click')).length;
        const res = await app.inject({
          method: 'GET',
          url: `/api/v1/go/${slug}`,
          headers: { 'user-agent': 'Mozilla/5.0' },
        });
        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toBe(`${WEB}/`);
        expect((await events('campaign_click')).length).toBe(before);
      },
    );

    it('link-preview bots are redirected but not counted', async () => {
      const before = (await events('campaign_click')).length;
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/go/spring-tg-01',
        headers: { 'user-agent': 'TelegramBot (like TwitterBot)' },
      });
      expect(res.statusCode).toBe(302);
      expect((await events('campaign_click')).length).toBe(before);
    });

    it('only accepts in-site target paths (no open redirect)', () => {
      for (const ok of ['/', '/training', '/subjects/math', '/landing']) {
        expect(isAllowedCampaignTarget(ok), ok).toBe(true);
      }
      for (const bad of [
        'https://evil.example',
        '//evil.example',
        '/\\evil.example',
        '/training?x=1',
        '/../admin',
        '/admin',
        '/statistics',
        'training',
        '/training//x',
        '/%2f%2fevil',
      ]) {
        expect(isAllowedCampaignTarget(bad), bad).toBe(false);
      }
    });
  });

  describe('registration attribution', () => {
    async function telegramSignIn(id: number, zv?: string) {
      return app.inject({
        method: 'POST',
        url: '/api/v1/auth/telegram',
        payload: { initData: telegramLaunch(BOT_TOKEN, { id, first_name: 'Тест' }) },
        headers: zv ? { cookie: `zv=${zv}` } : {},
      });
    }

    it('a new account from a campaign visitor is attributed to that campaign', async () => {
      const click = await app.inject({
        method: 'GET',
        url: '/api/v1/go/spring-tg-01',
        headers: { 'user-agent': 'Mozilla/5.0' },
      });
      const zv = visitorCookie(click)!.value;
      const res = await telegramSignIn(5550001, zv);
      expect(res.json().created).toBe(true);
      const userId = res.json().user.id as string;
      const [attr] = await testDb.db
        .select()
        .from(schema.userAttributions)
        .where(eq(schema.userAttributions.userId, userId));
      expect(attr).toMatchObject({ campaignId, visitorId: zv, method: 'telegram' });
      const reg = (await events('registration_completed')).filter((e) => e.userId === userId);
      expect(reg).toHaveLength(1);

      // Signing in again later: a login event, attribution unchanged.
      const again = await telegramSignIn(5550001);
      expect(again.json().created).toBe(false);
      expect((await events('login_completed')).some((e) => e.userId === userId)).toBe(true);
      const attrs = await testDb.db
        .select()
        .from(schema.userAttributions)
        .where(eq(schema.userAttributions.userId, userId));
      expect(attrs).toHaveLength(1);
    });

    it('without a campaign touch the source stays unknown (never guessed)', async () => {
      const res = await telegramSignIn(5550002);
      const [attr] = await testDb.db
        .select()
        .from(schema.userAttributions)
        .where(eq(schema.userAttributions.userId, res.json().user.id));
      expect(attr).toMatchObject({ campaignId: null, visitorId: null });
    });
  });

  describe('task complaints', () => {
    async function signedIn() {
      const [user] = await testDb.db.insert(schema.users).values({}).returning();
      const sessionId = randomUUID();
      await testDb.db
        .insert(schema.authSessions)
        .values({ id: sessionId, userId: user!.id, expiresAt: new Date(Date.now() + 3_600_000) });
      return { userId: user!.id, cookie: `session_id=${sessionId}` };
    }

    it('needs an account', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/complaints`,
        payload: { reason: 'typo' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('stores a complaint once per open (task, reason)', async () => {
      const user = await signedIn();
      const send = () =>
        app.inject({
          method: 'POST',
          url: `/api/v1/tasks/${task.id}/complaints`,
          payload: { reason: 'wrong_answer', comment: '  Ответ должен быть 7  ' },
          headers: { cookie: user.cookie },
        });
      const first = await send();
      expect(first.statusCode).toBe(201);
      const second = await send();
      expect(second.statusCode).toBe(200);
      expect(second.json().status).toBe('already_reported');
      const rows = await testDb.db
        .select()
        .from(schema.taskComplaints)
        .where(eq(schema.taskComplaints.userId, user.userId));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'new', comment: 'Ответ должен быть 7' });
    });

    it.each([
      [{ reason: 'spam' }, 400],
      [{ reason: 'typo', comment: 'x'.repeat(1001) }, 400],
    ])('rejects invalid input %j', async (payload, code) => {
      const user = await signedIn();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/complaints`,
        payload,
        headers: { cookie: user.cookie },
      });
      expect(res.statusCode).toBe(code);
    });

    it('404 for a task that does not exist', async () => {
      const user = await signedIn();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${randomUUID()}/complaints`,
        payload: { reason: 'typo' },
        headers: { cookie: user.cookie },
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
