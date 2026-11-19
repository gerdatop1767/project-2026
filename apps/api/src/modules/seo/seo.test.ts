import { schema } from '@zybrilka/db';
import { createTestDb } from '@zybrilka/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { fakePng } from '../../testSupport.js';
import { fixtures } from '../admin/testFixtures.js';

const WEB = 'https://zybrilka.test';
const W = { 'x-zybrilka-admin': '1' };
const KEY = Buffer.alloc(32, 9).toString('base64');

const body = [
  '## Что проверяют в задании 13',
  'Текст про тригонометрию. Подробнее в [теории](/theory) и на [ФИПИ](https://fipi.ru/ege).',
  '## Как решать',
  '1. Найти ОДЗ',
  '2. Решить уравнение',
  '## Типичные ошибки',
  '> [!mistake] Забывают про отбор корней.',
  '<script>alert(1)</script>',
  'Ещё текст '.repeat(40),
].join('\n\n');

describe('SEO Center API and public blog', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  let studentCookie: string;

  beforeAll(async () => {
    testDb = await createTestDb();
    const f = fixtures(testDb.db);
    const owner = await f.user('2026-01-01T10:00:00+03:00', 'email');
    const student = await f.user('2026-01-01T10:00:00+03:00', 'vk');
    cookie = await f.session(owner);
    studentCookie = await f.session(student);
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({
        NODE_ENV: 'test',
        WEB_BASE_URL: WEB,
        ADMIN_OWNER_USER_IDS: owner,
        SEO_SECRETS_KEY: KEY,
      }),
    });
  });
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  const get = (url: string, c = cookie) =>
    app.inject({ method: 'GET', url, headers: { cookie: c } });
  const send = (method: 'POST' | 'PATCH' | 'PUT', url: string, payload?: unknown, c = cookie) =>
    app.inject({ method, url, headers: { cookie: c, ...W }, payload: payload as object });

  it('admin SEO routes are owner-only', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/seo/agent' })).statusCode).toBe(
      401,
    );
    expect((await get('/api/v1/admin/seo/agent', studentCookie)).statusCode).toBe(403);
    expect((await get('/api/v1/admin/seo/agent')).statusCode).toBe(200);
  });

  it('overview reports «no data» (null) instead of zeros without sources', async () => {
    const res = await get('/api/v1/admin/seo/overview?days=7');
    expect(res.statusCode).toBe(200);
    const d = res.json();
    expect(d.current.organicVisits).toBeNull();
    expect(d.current.avgPosition).toBeNull();
    expect(d.current.top10).toBeNull();
    expect(d.series).toHaveLength(7);
    expect((await get('/api/v1/admin/seo/overview?days=5')).statusCode).toBe(400);
  });

  it('switching to autonomous mode needs confirmation; emergency stop cancels the queue', async () => {
    expect(
      (await send('PUT', '/api/v1/admin/seo/settings', { settings: { mode: 'auto' } })).statusCode,
    ).toBe(400);
    const ok = await send('PUT', '/api/v1/admin/seo/settings', {
      settings: { mode: 'auto', articlesPerDay: 2 },
      confirm: true,
    });
    expect(ok.json().settings).toMatchObject({ mode: 'auto', articlesPerDay: 2 });
    expect(
      (await send('PUT', '/api/v1/admin/seo/settings', { settings: { articlesPerDay: 99 } }))
        .statusCode,
    ).toBe(400);

    await send('POST', '/api/v1/admin/seo/agent/run', { kind: 'research' });
    const stop = await send('POST', '/api/v1/admin/seo/agent/stop', {});
    expect(stop.json().cancelled).toBeGreaterThanOrEqual(1);
    expect(
      (await send('POST', '/api/v1/admin/seo/agent/run', { kind: 'research' })).statusCode,
    ).toBe(409);
    const resume = await send('PUT', '/api/v1/admin/seo/settings', {
      settings: { emergencyStop: false },
      confirm: true,
    });
    expect(resume.statusCode).toBe(200);
  });

  it('article lifecycle: create, edit (revision), publish once, serve SSR, 404 when unpublished', async () => {
    const created = await send('POST', '/api/v1/admin/seo/articles', {
      title: 'Как решать задание 13 ЕГЭ',
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().article.id as string;
    expect(created.json().article.slug).toBe('kak-reshat-zadanie-13-ege');

    // Not published yet → real 404, not a soft 200.
    expect(
      (await app.inject({ method: 'GET', url: '/blog/kak-reshat-zadanie-13-ege' })).statusCode,
    ).toBe(404);

    const edit = await send('PATCH', `/api/v1/admin/seo/articles/${id}`, {
      seoTitle: 'Задание 13 ЕГЭ по математике: как решать',
      metaDescription:
        'Разбор задания 13 ЕГЭ по профильной математике: что проверяют, пошаговый алгоритм решения, типичные ошибки и тренировка.',
      h1: 'Задание 13 ЕГЭ: как решать',
      bodyMd: body,
      faq: [
        {
          question: 'Сколько баллов за задание 13?',
          answer: 'Задание 13 оценивается в 2 первичных балла.',
        },
      ],
      ctaPath: '/subjects/math',
      subjectId: 'math',
    });
    expect(edit.statusCode).toBe(200);
    expect(edit.json().article).toMatchObject({ status: 'draft', version: 2 });
    expect(
      await testDb.db
        .select()
        .from(schema.seoArticleRevisions)
        .where(eq(schema.seoArticleRevisions.articleId, id)),
    ).toHaveLength(1);

    expect((await send('POST', `/api/v1/admin/seo/articles/${id}/publish`, {})).statusCode).toBe(
      400,
    );
    const pub = await send('POST', `/api/v1/admin/seo/articles/${id}/publish`, { confirm: true });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().article.campaignId).toBeTruthy();
    const again = await send('POST', `/api/v1/admin/seo/articles/${id}/publish`, { confirm: true });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('already_published');
    // Post-publish check queued exactly once.
    const checks = await testDb.db
      .select()
      .from(schema.seoTasks)
      .where(eq(schema.seoTasks.kind, 'post_publish_check'));
    expect(checks).toHaveLength(1);

    const page = await app.inject({ method: 'GET', url: '/blog/kak-reshat-zadanie-13-ege' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    const html = page.body;
    expect(html).toContain('<title>Задание 13 ЕГЭ по математике: как решать</title>');
    expect(html).toContain(`<link rel="canonical" href="${WEB}/blog/kak-reshat-zadanie-13-ege">`);
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).toContain('"@type":"Article"');
    expect(html).toContain('<h1>Задание 13 ЕГЭ: как решать</h1>');
    expect(html).toContain('class="toc"');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toMatch(
      /href="https:\/\/zybrilka\.test\/api\/v1\/go\/[A-Za-z0-9_-]+" rel="nofollow"/,
    );

    const sitemap = await app.inject({ method: 'GET', url: '/blog/sitemap.xml' });
    expect(sitemap.body).toContain(`<loc>${WEB}/blog/kak-reshat-zadanie-13-ege</loc>`);
    expect((await app.inject({ method: 'GET', url: '/blog' })).body).toContain(
      '/blog/kak-reshat-zadanie-13-ege',
    );
    expect((await app.inject({ method: 'GET', url: '/blog/rss.xml' })).body).toContain('<item>');

    // Slug is locked once published.
    expect(
      (await send('PATCH', `/api/v1/admin/seo/articles/${id}`, { slug: 'drugoy-adres' }))
        .statusCode,
    ).toBe(409);

    const un = await send('POST', `/api/v1/admin/seo/articles/${id}/unpublish`, { confirm: true });
    expect(un.statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/blog/kak-reshat-zadanie-13-ege' })).statusCode,
    ).toBe(404);

    const card = await get(`/api/v1/admin/seo/articles/${id}`);
    expect(card.json().previewHtml).toContain('callout-mistake');
    expect(card.json().revisions.length).toBeGreaterThanOrEqual(1);
  });

  it('uploads PNG media only and serves it with a sandbox CSP', async () => {
    const [a] = await testDb.db.select().from(schema.seoArticles).limit(1);
    const up = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/seo/articles/${a!.id}/media?alt=${encodeURIComponent('Схема решения')}&license=${encodeURIComponent('Собственное изображение')}`,
      headers: { cookie, ...W, 'content-type': 'image/png' },
      payload: fakePng(800, 450),
    });
    expect(up.statusCode).toBe(201);
    expect(up.json().markdown).toMatch(/^!\[Схема решения\]\(media:[0-9a-f-]{36}\)$/);
    const file = up.json().media.fileName as string;
    const m = await app.inject({ method: 'GET', url: `/blog/media/${file}` });
    expect(m.statusCode).toBe(200);
    expect(m.headers['content-security-policy']).toContain('sandbox');
    const svg = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/seo/articles/${a!.id}/media?alt=xxx&license=yyy`,
      headers: { cookie, ...W, 'content-type': 'image/svg+xml' },
      payload: '<svg onload="alert(1)"/>',
    });
    expect(svg.statusCode).toBe(415);
  });

  it('stores integration secrets encrypted and never returns them', async () => {
    const put = await send('PUT', '/api/v1/admin/seo/integrations/yandex_metrika', {
      config: { counterId: 114059780 },
      secret: 'y0_SECRET_TOKEN',
    });
    expect(put.statusCode).toBe(200);
    const [row] = await testDb.db
      .select()
      .from(schema.seoIntegrations)
      .where(eq(schema.seoIntegrations.kind, 'yandex_metrika'));
    expect(row!.secretEnc).toBeTruthy();
    expect(row!.secretEnc).not.toContain('SECRET');
    const list = await get('/api/v1/admin/seo/integrations');
    expect(list.body).not.toContain('SECRET');
    expect(
      list.json().items.find((i: { kind: string }) => i.kind === 'yandex_metrika'),
    ).toMatchObject({ hasSecret: true, status: 'configured' });
    const audit = await testDb.db
      .select()
      .from(schema.adminAuditLog)
      .where(eq(schema.adminAuditLog.action, 'seo.integration.update'));
    expect(JSON.stringify(audit)).not.toContain('SECRET');
    expect(
      (
        await send('PUT', '/api/v1/admin/seo/integrations/google_search_console', {
          config: { siteUrl: 'sc-domain:zybrilka.ru' },
          secret: 'not json',
        })
      ).statusCode,
    ).toBe(400);

    // IndexNow: key generated by us and published at a fixed path.
    await send('PUT', '/api/v1/admin/seo/integrations/indexnow', { config: {} });
    const [inx] = await testDb.db
      .select()
      .from(schema.seoIntegrations)
      .where(eq(schema.seoIntegrations.kind, 'indexnow'));
    const key = inx!.config.key as string;
    expect(key).toMatch(/^[a-f0-9]{32}$/);
    const proof = await app.inject({ method: 'GET', url: `/blog/indexnow-${key}.txt` });
    expect(proof.body).toBe(key);
    expect(
      (await app.inject({ method: 'GET', url: `/blog/indexnow-${'0'.repeat(32)}.txt` })).statusCode,
    ).toBe(404);
  });

  it('imports a CSV semantic core idempotently', async () => {
    const csv =
      'Запрос;Частота;Кластер\nзадания егэ по математике;12000;Математика\nЗадания ЕГЭ по математике!;13000;Математика\nбаллы егэ 2027;5400;Баллы\n;;';
    const r = await send('POST', '/api/v1/admin/seo/keywords/import', { csv });
    expect(r.json()).toEqual({ added: 2, updated: 1, skipped: 1 });
    const list = await get('/api/v1/admin/seo/keywords?filter=uncovered');
    expect(list.json().counts).toMatchObject({ total: 2, covered: 0, clusters: 2 });
    expect(list.json().items[0]).toMatchObject({
      frequency: 13000,
      frequencySource: 'csv',
      cluster: 'Математика',
    });
  });
});
