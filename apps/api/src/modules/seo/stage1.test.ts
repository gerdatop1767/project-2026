/**
 * Stage 1 regressions on the API side (docs/SEO_CENTER_AUDIT.md §D):
 * analytics counted once and «no data» kept apart from zero, every trainer
 * link landing where it should through the real /go redirect, and /blog/
 * URL normalisation without an open redirect.
 */
import { publishSeoArticle, schema } from '@zybrilka/db';
import { createTestDb, verifiedReviewNotes } from '@zybrilka/db/testing';
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
          reviewNotes: verifiedReviewNotes({
            title: `CTA ${i}`,
            seoTitle: 'Заголовок статьи',
            metaDescription: 'd'.repeat(120),
            bodyMd: 'x'.repeat(300),
            faq: [],
          }),
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

describe('stage 1 audit: admin writes race safely', () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
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
  const send = (url: string, payload: unknown, method: 'POST' | 'PATCH' = 'POST') =>
    app.inject({
      method,
      url,
      headers: { cookie, 'x-zybrilka-admin': '1' },
      payload: payload as object,
    });

  it('an edit made on an outdated version is refused (409), so the newer text is not lost', async () => {
    const [a] = await t.db
      .insert(schema.seoArticles)
      .values({ slug: 'race', title: 'Race', status: 'draft' })
      .returning();
    // The owner opened version 1; the agent saved version 2 meanwhile.
    await t.db
      .update(schema.seoArticles)
      .set({ bodyMd: 'текст агента', version: 2 })
      .where(eq(schema.seoArticles.id, a!.id));
    const stale = await send(
      `/api/v1/admin/seo/articles/${a!.id}`,
      { version: 1, title: 'Правка по старой версии' },
      'PATCH',
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe('article_changed');
    const [kept] = await t.db
      .select()
      .from(schema.seoArticles)
      .where(eq(schema.seoArticles.id, a!.id));
    expect(kept).toMatchObject({ bodyMd: 'текст агента', title: 'Race', version: 2 });
    const fresh = await send(
      `/api/v1/admin/seo/articles/${a!.id}`,
      { version: 2, title: 'Правка по свежей версии' },
      'PATCH',
    );
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json().article).toMatchObject({ title: 'Правка по свежей версии', version: 3 });
    expect(
      (await send(`/api/v1/admin/seo/articles/${a!.id}`, { version: 'x' }, 'PATCH')).statusCode,
    ).toBe(400);
  });

  it('simultaneous edits never lose an update: each lands on its own version with a revision', async () => {
    const [a] = await t.db
      .insert(schema.seoArticles)
      .values({ slug: 'race2', title: 'Race2', status: 'draft' })
      .returning();
    const results = await Promise.all([
      send(`/api/v1/admin/seo/articles/${a!.id}`, { version: 1, title: 'Первая' }, 'PATCH'),
      send(`/api/v1/admin/seo/articles/${a!.id}`, { version: 1, title: 'Вторая' }, 'PATCH'),
    ]);
    // Both opened version 1: exactly one wins, the other is told to reload.
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const [after] = await t.db
      .select()
      .from(schema.seoArticles)
      .where(eq(schema.seoArticles.id, a!.id));
    expect(after!.version).toBe(2);
  });

  it('a double click on «Применить обновление» applies it once', async () => {
    const [a] = await t.db
      .insert(schema.seoArticles)
      .values({
        slug: 'upd',
        title: 'Upd',
        status: 'needs_update',
        publishedAt: new Date(),
        bodyMd: 'old',
      })
      .returning();
    const [rev] = await t.db
      .insert(schema.seoArticleRevisions)
      .values({
        articleId: a!.id,
        version: 2,
        snapshot: { bodyMd: 'new text' },
        reason: 'pending_update',
        actor: 'agent',
      })
      .returning();
    // The pending text was fact-checked (worker) — the gate lets it through once.
    await t.db
      .update(schema.seoArticles)
      .set({
        reviewNotes: verifiedReviewNotes(
          { title: 'Upd', bodyMd: 'new text', faq: [] },
          { revisionId: rev!.id },
        ),
      })
      .where(eq(schema.seoArticles.id, a!.id));
    const url = `/api/v1/admin/seo/articles/${a!.id}/revisions/${rev!.id}/apply`;
    const [r1, r2] = await Promise.all([
      send(url, { confirm: true }),
      send(url, { confirm: true }),
    ]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409]);
    const [after] = await t.db
      .select()
      .from(schema.seoArticles)
      .where(eq(schema.seoArticles.id, a!.id));
    expect(after).toMatchObject({ status: 'published', bodyMd: 'new text', version: 2 });
  });
});
