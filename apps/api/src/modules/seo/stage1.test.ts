/**
 * Stage 1 regressions on the API side (docs/SEO_CENTER_AUDIT.md §D):
 * analytics counted once and «no data» kept apart from zero, every trainer
 * link landing where it should through the real /go redirect, and /blog/
 * URL normalisation without an open redirect.
 */
import { publishSeoArticle, schema } from '@zybrilka/db';
import { createTestDb } from '@zybrilka/db/testing';
import { SEO_SITE_PAGES } from '@zybrilka/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { fixtures } from '../admin/testFixtures.js';
import { addDays, articleMetrics, mskToday, overviewReport } from './reports.js';

const WEB = 'https://zybrilka.test';

describe('stage 1: SEO analytics, trainer links, blog URLs', () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  const day = addDays(mskToday(), -3);

  beforeAll(async () => {
    t = await createTestDb();
    const f = fixtures(t.db);
    const owner = await f.user('2026-01-01T10:00:00+03:00', 'email');
    cookie = await f.session(owner);
    app = buildApp({
      version: 't',
      db: t.db,
      authConfig: loadConfig({ NODE_ENV: 'test', WEB_BASE_URL: WEB, ADMIN_OWNER_USER_IDS: owner }),
    });
  });
  afterAll(async () => {
    await app.close();
    await t.close();
  });
  beforeEach(async () => {
    await t.db.delete(schema.seoSearchMetrics);
    await t.db.delete(schema.seoTrafficDaily);
  });

  const article = async (slug: string) =>
    (
      await t.db
        .insert(schema.seoArticles)
        .values({ slug, title: slug, status: 'published', publishedAt: new Date() })
        .returning()
    )[0]!;

  // ── 3. Google clicks/impressions counted once ──────────────────────────
  it('overview counts Google once although GSC stores per-page rows and the site total', async () => {
    await t.db.insert(schema.seoSearchMetrics).values([
      // What syncGsc writes: two pages for one query + the site-level aggregate.
      {
        engine: 'google',
        date: day,
        page: '/blog/a',
        query: 'егэ',
        impressions: 60,
        clicks: 6,
        position: 4,
      },
      {
        engine: 'google',
        date: day,
        page: '/blog/b',
        query: 'егэ',
        impressions: 40,
        clicks: 4,
        position: 8,
      },
      {
        engine: 'google',
        date: day,
        page: '',
        query: 'егэ',
        impressions: 100,
        clicks: 10,
        position: 5.6,
      },
      // Yandex Webmaster: site level only.
      {
        engine: 'yandex',
        date: day,
        page: '',
        query: 'егэ',
        impressions: 300,
        clicks: 30,
        position: 3,
      },
    ]);
    const r = await overviewReport(t.db, 7);
    expect(r.current.impressions).toBe(400);
    expect(r.current.clicks).toBe(40);
    expect(r.current.ctr).toBe(10);
    // impression-weighted average of the two engines' site-level positions
    // impression-weighted, rounded to 0.1 for display: (100×5.6 + 300×3) / 400 = 3.65 → 3.7
    expect(r.current.avgPosition).toBe(3.7);
    expect(r.current.top10).toBe(2); // the query in each engine
    const point = r.series.find((p) => p.date === day)!;
    expect(point.position).toBeCloseTo((100 * 5.6 + 300 * 3) / 400, 5);
  });

  // ── 4. Yandex-only: «no data», not zero ───────────────────────────────
  it('with only Yandex Webmaster connected, article search numbers are «no data» (null), not 0', async () => {
    const a = await article('yandex-only');
    await t.db.insert(schema.seoSearchMetrics).values({
      engine: 'yandex',
      date: day,
      page: '',
      query: 'егэ',
      impressions: 500,
      clicks: 30,
      position: 4,
    });
    const m = (await articleMetrics(t.db)).get(a.id)!;
    expect(m.impressions).toBeNull();
    expect(m.clicks).toBeNull();
    expect(m.ctr).toBeNull();
    expect(m.organicVisits).toBeNull();
    expect(m.views).toBeNull();
    expect(m.seoScore).toBeNull();
    // The site-level overview still shows the real Yandex numbers.
    expect((await overviewReport(t.db, 7)).current.clicks).toBe(30);
  });

  it('with page-level data connected, an article without impressions is a real 0', async () => {
    const shown = await article('shown');
    const silent = await article('silent');
    await t.db.insert(schema.seoSearchMetrics).values({
      engine: 'google',
      date: day,
      page: '/blog/shown',
      query: 'егэ',
      impressions: 50,
      clicks: 5,
      position: 6,
    });
    const metrics = await articleMetrics(t.db);
    expect(metrics.get(shown.id)).toMatchObject({ impressions: 50, clicks: 5, ctr: 10 });
    expect(metrics.get(silent.id)).toMatchObject({ impressions: 0, clicks: 0 });
  });

  // ── 6. Views not inflated ─────────────────────────────────────────────
  it('article views are the «all sources» visits, not all + organic', async () => {
    const a = await article('views');
    await t.db.insert(schema.seoTrafficDaily).values([
      { date: day, source: 'all', page: '/blog/views', visits: 10, users: 9 },
      { date: day, source: 'organic', page: '/blog/views', visits: 6, users: 6 },
    ]);
    const m = (await articleMetrics(t.db)).get(a.id)!;
    expect(m.views).toBe(10);
    expect(m.organicVisits).toBe(6);
  });

  // ── 5. Every trainer link lands on its section ───────────────────────
  it('each of the 11 trainer pages: a published article’s button redirects exactly there', async () => {
    expect(SEO_SITE_PAGES).toHaveLength(11);
    for (const [i, p] of SEO_SITE_PAGES.entries()) {
      const [a] = await t.db
        .insert(schema.seoArticles)
        .values({
          slug: `cta-${i}`,
          title: `CTA ${i}`,
          status: 'draft',
          seoTitle: 'Заголовок статьи',
          metaDescription: 'd'.repeat(120),
          bodyMd: 'x'.repeat(300),
          ctaPath: p.path,
        })
        .returning();
      const out = await publishSeoArticle(t.db, a!.id, { kind: 'agent' });
      expect(out.ok).toBe(true);
      const page = await app.inject({ method: 'GET', url: `/blog/cta-${i}` });
      const go =
        /href="(https:\/\/zybrilka\.test\/api\/v1\/go\/[A-Za-z0-9_-]+)" rel="nofollow"/.exec(
          page.body,
        )?.[1];
      expect(go, p.path).toBeTruthy();
      const res = await app.inject({ method: 'GET', url: new URL(go!).pathname });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location, p.path).toBe(new URL(p.path, WEB).toString());
    }
  });

  it('the admin cannot save a call to action outside the allowed sections', async () => {
    const [a] = await t.db
      .insert(schema.seoArticles)
      .values({ slug: 'edit', title: 'Edit', status: 'draft' })
      .returning();
    const patch = (ctaPath: string) =>
      app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/seo/articles/${a!.id}`,
        headers: { cookie, 'x-zybrilka-admin': '1' },
        payload: { ctaPath },
      });
    expect((await patch('/admin')).statusCode).toBe(400);
    expect((await patch('/api/v1/auth/logout')).statusCode).toBe(400);
    expect((await patch('/games/stress')).statusCode).toBe(200);
    const [after] = await t.db
      .select()
      .from(schema.seoArticles)
      .where(eq(schema.seoArticles.id, a!.id));
    expect(after!.ctaPath).toBe('/games/stress');
  });

  // ── 9. /blog/ normalisation ───────────────────────────────────────────
  it('/blog/ and /blog/<slug>/ redirect (301) to the canonical address, keeping the query', async () => {
    await article('norm');
    const cases: [string, string][] = [
      ['/blog/', '/blog'],
      ['/blog/?page=2', '/blog?page=2'],
      ['/blog/norm/', '/blog/norm'],
      ['/blog/norm/?utm_source=vk', '/blog/norm?utm_source=vk'],
    ];
    for (const [from, to] of cases) {
      const r = await app.inject({ method: 'GET', url: from });
      expect(r.statusCode, from).toBe(301);
      expect(r.headers.location, from).toBe(to);
    }
    expect((await app.inject({ method: 'GET', url: '/blog/norm' })).statusCode).toBe(200);
  });

  it('normalisation is not an open redirect and keeps real 404s', async () => {
    for (const url of [
      '/blog//evil.com/',
      '/blog/%2F%2Fevil.com/',
      '/blog/Bad%20Slug/',
      '/blog/a.b/',
    ]) {
      const r = await app.inject({ method: 'GET', url });
      expect(r.statusCode, url).toBe(404);
      expect(r.headers.location, url).toBeUndefined();
    }
    const missing = await app.inject({ method: 'GET', url: '/blog/nonexistent/' });
    expect(missing.statusCode).toBe(301); // to /blog/nonexistent, which then is a real 404
    expect((await app.inject({ method: 'GET', url: '/blog/nonexistent' })).statusCode).toBe(404);
  });
});
