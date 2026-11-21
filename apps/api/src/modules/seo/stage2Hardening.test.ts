/**
 * Stage 2.1 final hardening, admin side: an edit of a LIVE article's text
 * never reaches the public page directly — it becomes a pending update with
 * its own fact-check and goes live only through the Publication Safety Gate.
 * Technical fields still save at once.
 */
import { articleContentHash, schema } from '@zybrilka/db';
import { createTestDb, verifiedReviewNotes } from '@zybrilka/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { fixtures } from '../admin/testFixtures.js';

const WEB = 'https://zybrilka.test';
const BODY = 'Задание 13 профильной математики оценивается в 2 первичных балла. '.repeat(8);
const CONTENT = {
  title: 'Задание 13 ЕГЭ',
  h1: 'Задание 13 ЕГЭ: как решать',
  seoTitle: 'Задание 13 ЕГЭ по математике',
  metaDescription: 'm'.repeat(120),
  ogTitle: 'Задание 13 ЕГЭ',
  ogDescription: 'Разбор задания 13 ЕГЭ по профильной математике',
  bodyMd: BODY,
  faq: [{ question: 'Сколько баллов?', answer: 'Два первичных балла.' }],
  sources: [
    { title: 'ФИПИ: демоверсии', url: 'https://fipi.ru/ege/demoversii' },
    { title: 'Рособрнадзор', url: 'https://obrnadzor.gov.ru/ege' },
  ],
};

describe('stage 2.1 hardening: editing a live article (admin PATCH)', () => {
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
  beforeEach(async () => {
    await t.db.delete(schema.seoArticleRevisions);
    await t.db.delete(schema.seoTasks);
    await t.db.delete(schema.seoAgentLog);
    await t.db.delete(schema.seoArticles);
  });

  const req = (method: 'POST' | 'PATCH', url: string, payload: unknown) =>
    app.inject({
      method,
      url: `/api/v1/admin/seo/articles/${url}`,
      headers: { cookie, 'x-zybrilka-admin': '1' },
      payload: payload as object,
    });
  const live = async (status: 'published' | 'needs_update' = 'published') =>
    (
      await t.db
        .insert(schema.seoArticles)
        .values({
          slug: `live-${Math.random().toString(36).slice(2, 8)}`,
          status,
          publishedAt: new Date(),
          ctaPath: '/training',
          reviewNotes: verifiedReviewNotes(CONTENT),
          factCheckPassed: true,
          ...CONTENT,
        })
        .returning()
    )[0]!;
  const get = async (id: string) =>
    (await t.db.select().from(schema.seoArticles).where(eq(schema.seoArticles.id, id)))[0]!;
  const pendingOf = (id: string) =>
    t.db
      .select()
      .from(schema.seoArticleRevisions)
      .where(
        and(
          eq(schema.seoArticleRevisions.articleId, id),
          eq(schema.seoArticleRevisions.reason, 'pending_update'),
        ),
      );
  const page = async (slug: string) =>
    (await app.inject({ method: 'GET', url: `/blog/${slug}` })).body;

  it('a text edit of a published article becomes a pending update; the site keeps the checked text', async () => {
    const a = await live();
    const r = await req('PATCH', a.id, {
      bodyMd: `${BODY} Задание 13 даёт 3 балла.`,
      version: a.version,
    });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toMatchObject({ factCheck: 'queued' });
    const after = await get(a.id);
    expect(after).toMatchObject({ status: 'needs_update', bodyMd: BODY, version: a.version + 1 });
    expect(await page(a.slug)).not.toContain('3 балла');
    const [rev] = await pendingOf(a.id);
    expect(rev!.id).toBe(r.json().pendingRevisionId);
    expect((rev!.snapshot as { bodyMd: string }).bodyMd).toContain('3 балла');
    // Its own fact-check is queued, bound to that revision.
    const [task] = await t.db
      .select()
      .from(schema.seoTasks)
      .where(eq(schema.seoTasks.kind, 'review_article'));
    expect(task!.payload).toMatchObject({ articleId: a.id, pendingRevisionId: rev!.id });
    // Audited.
    const audit = await t.db
      .select()
      .from(schema.adminAuditLog)
      .where(eq(schema.adminAuditLog.action, 'seo.article.edit_live_proposed'));
    expect(audit.at(-1)!.details).toMatchObject({
      fields: ['bodyMd'],
      pendingRevisionId: rev!.id,
    });

    // Not applicable without a check of THAT text; the old check does not count.
    const apply = () => req('POST', `${a.id}/revisions/${rev!.id}/apply`, { confirm: true });
    expect((await apply()).statusCode).toBe(409);
    expect((await get(a.id)).bodyMd).toBe(BODY);
    // Checked (worker) → applied, live.
    await t.db
      .update(schema.seoArticles)
      .set({
        reviewNotes: verifiedReviewNotes(
          { ...CONTENT, bodyMd: `${BODY} Задание 13 даёт 3 балла.` },
          { revisionId: rev!.id },
        ),
      })
      .where(eq(schema.seoArticles.id, a.id));
    expect((await apply()).statusCode).toBe(200);
    expect(await get(a.id)).toMatchObject({ status: 'published', factCheckPassed: true });
    expect(await page(a.slug)).toContain('3 балла');
  });

  it.each([
    ['title', 'Задание 13 ЕГЭ: 3 балла'],
    ['h1', 'Задание 13 даёт 3 балла'],
    ['seoTitle', 'Задание 13 ЕГЭ — 3 балла'],
    ['metaDescription', `${'n'.repeat(110)} 3 балла.`],
    ['ogTitle', 'Задание 13: три балла'],
    ['ogDescription', 'Задание 13 профильной математики даёт три балла'],
    ['faq', [{ question: 'Сколько баллов?', answer: 'Три первичных балла.' }]],
  ])('every checked text field goes through a check: %s', async (field, value) => {
    const a = await live();
    const r = await req('PATCH', a.id, { [field]: value });
    expect(r.statusCode).toBe(202);
    const after = await get(a.id);
    expect(after[field as keyof typeof after]).toEqual(CONTENT[field as keyof typeof CONTENT]);
    expect(after.status).toBe('needs_update');
    expect(await pendingOf(a.id)).toHaveLength(1);
  });

  it('technical fields of a live article save at once, without a new check', async () => {
    const a = await live();
    const r = await req('PATCH', a.id, {
      ctaPath: '/subjects/math',
      primaryKeyword: 'задание 13 егэ',
      secondaryKeywords: ['13 задание'],
    });
    expect(r.statusCode).toBe(200);
    expect(await get(a.id)).toMatchObject({
      status: 'published',
      ctaPath: '/subjects/math',
      primaryKeyword: 'задание 13 егэ',
      bodyMd: BODY,
    });
    expect(await pendingOf(a.id)).toHaveLength(0);
    expect(
      await t.db.select().from(schema.seoTasks).where(eq(schema.seoTasks.kind, 'review_article')),
    ).toHaveLength(0);
  });

  it('edits that keep the checked text (an image, whitespace) save at once; the check stays valid', async () => {
    const a = await live();
    const withImage = `${BODY}\n\n![Инфографика](media:0f9b8b7a-1111-4222-8333-944455556666)\n`;
    const r = await req('PATCH', a.id, { bodyMd: withImage, title: `  ${CONTENT.title}  ` });
    expect(r.statusCode).toBe(200);
    const after = await get(a.id);
    expect(after).toMatchObject({ status: 'published', bodyMd: withImage });
    expect(articleContentHash(after)).toBe(articleContentHash(a));
    expect(await pendingOf(a.id)).toHaveLength(0);
  });

  it('a mixed edit splits: technical part now, text part as a pending update', async () => {
    const a = await live();
    const r = await req('PATCH', a.id, { ctaPath: '/theory', h1: 'Задание 13: новое' });
    expect(r.statusCode).toBe(202);
    expect(await get(a.id)).toMatchObject({ ctaPath: '/theory', h1: CONTENT.h1 });
    const [rev] = await pendingOf(a.id);
    expect(rev!.snapshot).toMatchObject({ h1: 'Задание 13: новое' });
    expect(rev!.snapshot).not.toHaveProperty('ctaPath');
  });

  it('a new edit supersedes the earlier pending update (one candidate at a time)', async () => {
    const a = await live('needs_update');
    const first = await req('PATCH', a.id, { h1: 'Вариант один' });
    const second = await req('PATCH', a.id, { h1: 'Вариант два' });
    expect([first.statusCode, second.statusCode]).toEqual([202, 202]);
    const pending = await pendingOf(a.id);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.snapshot).toMatchObject({ h1: 'Вариант два' });
    const old = await req('POST', `${a.id}/revisions/${first.json().pendingRevisionId}/apply`, {
      confirm: true,
    });
    expect(old.statusCode).toBe(409);
    expect((await get(a.id)).status).toBe('needs_update');
  });

  it('the slug of a needs_update (live) article is locked too', async () => {
    const a = await live('needs_update');
    const r = await req('PATCH', a.id, { slug: 'drugoy-adres' });
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe('slug_locked');
  });

  it('an edit racing a publication cannot slip unchecked text onto the site', async () => {
    const [d] = await t.db
      .insert(schema.seoArticles)
      .values({
        slug: 'race-draft',
        status: 'review',
        reviewNotes: verifiedReviewNotes(CONTENT),
        ...CONTENT,
      })
      .returning();
    const [pub, edit] = await Promise.all([
      req('POST', `${d!.id}/publish`, { confirm: true }),
      req('PATCH', d!.id, { bodyMd: `${BODY} Задание 13 — 4 балла.`, version: d!.version }),
    ]);
    const after = await get(d!.id);
    if (after.status === 'published' || after.status === 'needs_update') {
      // Whatever order: the public text is the checked one.
      expect(after.bodyMd).toBe(BODY);
      expect(await page('race-draft')).not.toContain('4 балла');
    }
    expect([pub.statusCode, edit.statusCode]).not.toContain(500);
  });

  describe('sources are evidence', () => {
    const FIPI = CONTENT.sources[0]!;
    const RON = CONTENT.sources[1]!;
    const expectPending = async (id: string, sources: unknown) => {
      const after = await get(id);
      expect(after.sources).toEqual(CONTENT.sources); // the public list is unchanged
      expect(after.status).toBe('needs_update');
      const [rev] = await pendingOf(id);
      expect((rev!.snapshot as { sources: unknown }).sources).toEqual(sources);
      const audit = await t.db
        .select()
        .from(schema.adminAuditLog)
        .where(eq(schema.adminAuditLog.action, 'seo.article.edit_live_proposed'));
      expect(audit.at(-1)!.details).toMatchObject({ fields: ['sources'] });
    };

    it('removing a source the check relied on → pending update with a new check', async () => {
      const a = await live();
      const r = await req('PATCH', a.id, { sources: [RON] });
      expect(r.statusCode).toBe(202);
      await expectPending(a.id, [RON]);
      expect(await page(a.slug)).toContain('fipi.ru/ege/demoversii');
    });

    it('adding a source → pending update', async () => {
      const a = await live();
      const added = [...CONTENT.sources, { title: 'Блог', url: 'https://example.com/ege-2027' }];
      expect((await req('PATCH', a.id, { sources: added })).statusCode).toBe(202);
      await expectPending(a.id, added);
      expect(await page(a.slug)).not.toContain('example.com/ege-2027');
    });

    it('changing a URL → pending update', async () => {
      const a = await live();
      const changed = [{ ...FIPI, url: 'https://fipi.ru/ege/demoversii-2026' }, RON];
      expect((await req('PATCH', a.id, { sources: changed })).statusCode).toBe(202);
      await expectPending(a.id, changed);
    });

    it('renaming or reordering links (same URLs) saves at once; the check stays valid', async () => {
      const a = await live();
      const same = [
        { title: 'Рособрнадзор — ЕГЭ', url: 'https://obrnadzor.gov.ru/ege/' },
        { title: 'Демоверсии ФИПИ', url: FIPI.url },
      ];
      const r = await req('PATCH', a.id, { sources: same });
      expect(r.statusCode).toBe(200);
      const after = await get(a.id);
      expect(after).toMatchObject({ status: 'published', sources: same });
      expect(await pendingOf(a.id)).toHaveLength(0);
      expect(articleContentHash(after)).toBe(articleContentHash(a));
      const audit = await t.db
        .select()
        .from(schema.adminAuditLog)
        .where(eq(schema.adminAuditLog.action, 'seo.article.edit'));
      expect(audit.at(-1)!.details).toMatchObject({ fields: ['sources'] });
    });

    it('a not-yet-published article: changing sources after the check makes it stale', async () => {
      const [d] = await t.db
        .insert(schema.seoArticles)
        .values({
          slug: 'src-draft',
          status: 'review',
          reviewNotes: verifiedReviewNotes(CONTENT),
          ...CONTENT,
        })
        .returning();
      expect((await req('PATCH', d!.id, { sources: [RON] })).statusCode).toBe(200);
      const r = await req('POST', `${d!.id}/publish`, { confirm: true });
      expect(r.statusCode).toBe(409);
      expect(r.json().reasons).toContain('stale_fact_check');
    });
  });
});
