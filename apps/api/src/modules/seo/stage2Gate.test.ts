/**
 * Stage 2.1 — Publication Safety Gate, admin side: «Опубликовать»,
 * «Запланировать», «Применить обновление» and the manual fact-check
 * approval. Server logic decides; the model's «pass» and the
 * `factCheckPassed` flag authorize nothing.
 */
import { buildFactCheckRecord, articleContentHash, schema } from '@zybrilka/db';
import { createTestDb, verifiedReviewNotes } from '@zybrilka/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { fixtures } from '../admin/testFixtures.js';

const WEB = 'https://zybrilka.test';
const BODY = 'Задание 13 профильной математики оценивается в 2 первичных балла. '.repeat(8);
const CONTENT = {
  title: 'Задание 13',
  seoTitle: 'Задание 13 ЕГЭ',
  metaDescription: 'm'.repeat(120),
  bodyMd: BODY,
  faq: [] as { question: string; answer: string }[],
};
const CONTRADICTED = (hash: string) => ({
  verdict: 'fix',
  factualIssues: [{ claim: 'Задание 13 — 4 балла', problem: '', correction: '' }],
  factCheck: buildFactCheckRecord({
    verdict: 'fix',
    factualIssues: [
      { claim: 'Задание 13 — 4 балла', severity: 'critical', status: 'contradicted' },
    ],
    webChecked: true,
    webSources: ['https://fipi.ru/ege'],
    contentHash: hash,
    checkedAt: new Date(),
  }),
});
const UNVERIFIED = (hash: string) => ({
  verdict: 'fix',
  factCheck: buildFactCheckRecord({
    verdict: 'fix',
    factualIssues: [
      { claim: 'Демоверсия 2027 выйдет в августе', severity: 'critical', status: 'unverified' },
    ],
    webChecked: true,
    webSources: ['https://fipi.ru/ege'],
    contentHash: hash,
    checkedAt: new Date(),
  }),
});

describe('stage 2.1: publication safety gate (admin API)', () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let cookie: string;
  let owner: string;

  beforeAll(async () => {
    t = await createTestDb();
    const f = fixtures(t.db);
    owner = await f.user('2026-01-01T10:00:00+03:00', 'email');
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

  const send = (url: string, payload: unknown, method: 'POST' | 'PATCH' = 'POST') =>
    app.inject({
      method,
      url: `/api/v1/admin/seo/articles/${url}`,
      headers: { cookie, 'x-zybrilka-admin': '1' },
      payload: payload as object,
    });
  const article = async (extra: Partial<typeof schema.seoArticles.$inferInsert> = {}) =>
    (
      await t.db
        .insert(schema.seoArticles)
        .values({
          slug: `a-${Math.random().toString(36).slice(2)}`,
          status: 'review',
          ...CONTENT,
          ...extra,
        })
        .returning()
    )[0]!;
  const get = async (id: string) =>
    (await t.db.select().from(schema.seoArticles).where(eq(schema.seoArticles.id, id)))[0]!;
  const publish = (id: string) => send(`${id}/publish`, { confirm: true });
  const schedule = (id: string) =>
    send(`${id}/schedule`, { at: '2030-01-01T09:00:00+03:00', confirm: true });

  it('1: an unverified article is not published, scheduled or changed', async () => {
    const a = await article();
    const r = await publish(a.id);
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: 'fact_check', reasons: ['no_fact_check'] });
    expect(await get(a.id)).toMatchObject({
      status: 'review',
      publishedAt: null,
      campaignId: null,
    });
    const audit = await t.db
      .select()
      .from(schema.adminAuditLog)
      .where(eq(schema.adminAuditLog.action, 'seo.article.publish_blocked'));
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0]!.result).toBe('denied');
  });

  it('2: an empty, malformed or failed fact-check result does not allow publication', async () => {
    const hash = articleContentHash(CONTENT);
    const failedNoEvidence = buildFactCheckRecord({
      verdict: 'pass',
      factualIssues: [],
      webChecked: true,
      webSources: [],
      contentHash: hash,
      checkedAt: new Date(),
    });
    for (const reviewNotes of [
      {},
      { factCheck: {} },
      { factCheck: { ...failedNoEvidence, result: 'verified', contentHash: 'abc' } },
      { factCheck: failedNoEvidence },
    ]) {
      const a = await article({ reviewNotes });
      const r = await publish(a.id);
      expect(r.statusCode, JSON.stringify(reviewNotes)).toBe(409);
      expect(r.json().error).toBe('fact_check');
      expect((await get(a.id)).status).toBe('review');
    }
  });

  it("3: the model's «pass» and factCheckPassed=true alone authorize nothing", async () => {
    const a = await article({
      factCheckPassed: true,
      reviewNotes: { verdict: 'pass', factualIssues: [], styleIssues: [], summary: 'pass' },
    });
    expect((await publish(a.id)).statusCode).toBe(409);
    expect((await schedule(a.id)).statusCode).toBe(409);
    expect((await get(a.id)).status).toBe('review');
  });

  it('4: a critical contradiction blocks publication and scheduling', async () => {
    const a = await article({ reviewNotes: CONTRADICTED(articleContentHash(CONTENT)) });
    const r = await publish(a.id);
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({
      error: 'fact_check',
      manualAllowed: false,
      criticalContradictions: ['Задание 13 — 4 балла'],
    });
    expect(r.json().reasons).toContain('critical_contradiction');
    expect((await schedule(a.id)).statusCode).toBe(409);
  });

  it('5: manual scheduling does not bypass the gate; a verified article schedules', async () => {
    const a = await article();
    const r = await schedule(a.id);
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe('fact_check');
    expect(await get(a.id)).toMatchObject({ status: 'review', scheduledFor: null });

    const ok = await article({ reviewNotes: verifiedReviewNotes(CONTENT) });
    const s = await schedule(ok.id);
    expect(s.statusCode).toBe(200);
    expect(s.json().article.status).toBe('scheduled');
    // Already published → not schedulable at all.
    const live = await article({ status: 'published', publishedAt: new Date() });
    expect((await schedule(live.id)).json().error).toBe('not_schedulable');
  });

  it('7: applying an update to a live article needs a check of that revision', async () => {
    const a = await article({ status: 'needs_update', publishedAt: new Date(), version: 1 });
    const newText = { ...CONTENT, bodyMd: `${BODY} Новое: таблица баллов.` };
    const [rev] = await t.db
      .insert(schema.seoArticleRevisions)
      .values({
        articleId: a.id,
        version: 2,
        snapshot: newText,
        reason: 'pending_update',
        actor: 'agent:content',
      })
      .returning();
    const apply = () => send(`${a.id}/revisions/${rev!.id}/apply`, { confirm: true });

    // No check; a check of the live text; the model's «pass» only — all refused.
    for (const reviewNotes of [
      null,
      verifiedReviewNotes(CONTENT),
      { verdict: 'pass', factualIssues: [], pendingRevisionId: rev!.id, passed: true },
      verifiedReviewNotes(newText, { revisionId: '00000000-0000-4000-8000-000000000000' }),
    ]) {
      await t.db
        .update(schema.seoArticles)
        .set({ reviewNotes })
        .where(eq(schema.seoArticles.id, a.id));
      const r = await apply();
      expect(r.statusCode, JSON.stringify(reviewNotes)).toBe(409);
      expect(r.json().error).toBe('fact_check');
    }
    const [still] = await t.db
      .select()
      .from(schema.seoArticleRevisions)
      .where(eq(schema.seoArticleRevisions.id, rev!.id));
    expect(still!.reason).toBe('pending_update');
    expect((await get(a.id)).bodyMd).toBe(BODY);

    await t.db
      .update(schema.seoArticles)
      .set({ reviewNotes: verifiedReviewNotes(newText, { revisionId: rev!.id }) })
      .where(eq(schema.seoArticles.id, a.id));
    const ok = await apply();
    expect(ok.statusCode).toBe(200);
    expect(await get(a.id)).toMatchObject({ status: 'published', factCheckPassed: true });
  });

  describe('8: manual approval', () => {
    it('cannot bypass a critical contradiction — not even after an edit', async () => {
      const a = await article({ reviewNotes: CONTRADICTED(articleContentHash(CONTENT)) });
      const r = await send(`${a.id}/fact-check/approve`, {
        reason: 'Проверил сам по спецификации ФИПИ',
        confirm: true,
      });
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toBe('critical_contradiction');
      // Edit the text a little: the contradiction still needs a new check, not a click.
      const e = await send(`${a.id}`, { bodyMd: `${BODY} (уточнено)` }, 'PATCH');
      expect(e.statusCode).toBe(200);
      const r2 = await send(`${a.id}/fact-check/approve`, {
        reason: 'Проверил сам по спецификации ФИПИ',
        confirm: true,
      });
      expect(r2.statusCode).toBe(409);
      expect((await publish(a.id)).statusCode).toBe(409);
    });

    it('is recorded (who, when, why), bound to this text and this article, never «verified»', async () => {
      const hash = articleContentHash(CONTENT);
      const a = await article({ reviewNotes: UNVERIFIED(hash) });
      const twin = await article({ reviewNotes: UNVERIFIED(hash) }); // same text, another article
      expect((await publish(a.id)).json().reasons).toContain('unverified_critical_claims');

      expect(
        (await send(`${a.id}/fact-check/approve`, { reason: 'ок', confirm: true })).statusCode,
      ).toBe(400);
      expect(
        (await send(`${a.id}/fact-check/approve`, { reason: 'Проверил сам по ФИПИ' })).statusCode,
      ).toBe(400);
      const ap = await send(`${a.id}/fact-check/approve`, {
        reason: 'Дату подтвердил по новости ФИПИ от 01.09',
        confirm: true,
      });
      expect(ap.statusCode).toBe(200);
      const stored = (await get(a.id)).reviewNotes as {
        manualApproval: Record<string, string>;
        factCheck: { result: string };
      };
      expect(stored.manualApproval).toMatchObject({
        adminId: owner,
        reason: 'Дату подтвердил по новости ФИПИ от 01.09',
        contentHash: hash,
        revisionId: null,
      });
      expect(Number.isNaN(Date.parse(stored.manualApproval.at ?? ''))).toBe(false);
      // The automatic result is kept as it was.
      expect(stored.factCheck.result).toBe('failed');
      const audit = await t.db
        .select()
        .from(schema.adminAuditLog)
        .where(
          and(
            eq(schema.adminAuditLog.action, 'seo.article.fact_check_manual'),
            eq(schema.adminAuditLog.objectId, a.id),
          ),
        );
      expect(audit).toHaveLength(1);

      // Does not spread to the other article with the same text.
      expect((await publish(twin.id)).statusCode).toBe(409);

      const p = await publish(a.id);
      expect(p.statusCode).toBe(200);
      const after = await get(a.id);
      expect(after.status).toBe('published');
      expect(after.factCheckPassed).not.toBe(true);
      const [log] = await t.db
        .select()
        .from(schema.seoAgentLog)
        .where(eq(schema.seoAgentLog.action, 'article.published'));
      expect(log!.details).toMatchObject({ gate: { basis: 'manual' } });
    });

    it('an edit after the approval voids it', async () => {
      const a = await article({ reviewNotes: UNVERIFIED(articleContentHash(CONTENT)) });
      await send(`${a.id}/fact-check/approve`, {
        reason: 'Проверил вручную по ФИПИ',
        confirm: true,
      });
      await send(`${a.id}`, { bodyMd: `${BODY} Задание 13 — 3 балла.` }, 'PATCH');
      const r = await publish(a.id);
      expect(r.statusCode).toBe(409);
      expect(r.json().reasons).toContain('stale_fact_check');
    });
  });

  it('9: already published articles stay on the site (no check is required retroactively)', async () => {
    const a = await article({ status: 'published', publishedAt: new Date(), slug: 'legacy-live' });
    const page = await app.inject({ method: 'GET', url: '/blog/legacy-live' });
    expect(page.statusCode).toBe(200);
    expect(await get(a.id)).toMatchObject({ status: 'published', bodyMd: BODY });
  });

  it('10: concurrent publish/schedule/apply requests do not bypass the gate', async () => {
    const a = await article();
    const rs = await Promise.all([publish(a.id), schedule(a.id), publish(a.id), schedule(a.id)]);
    expect(rs.map((r) => r.statusCode)).toEqual([409, 409, 409, 409]);
    expect((await get(a.id)).status).toBe('review');

    // Verified: many parallel clicks → exactly one publication.
    const v = await article({ reviewNotes: verifiedReviewNotes(CONTENT) });
    const ps = await Promise.all([publish(v.id), publish(v.id), publish(v.id), schedule(v.id)]);
    expect(
      ps.filter((r) => r.statusCode === 200 && r.json().article.status === 'published'),
    ).toHaveLength(1);
    expect((await get(v.id)).status).toBe('published');

    // An edit racing a publication: whatever wins, the live text is one the gate saw at publish time.
    const w = await article({ reviewNotes: verifiedReviewNotes(CONTENT), slug: 'race' });
    const [pub, edit] = await Promise.all([
      publish(w.id),
      send(`${w.id}`, { bodyMd: `${BODY} Правка.`, version: 1 }, 'PATCH'),
    ]);
    const [log] = await t.db
      .select()
      .from(schema.seoAgentLog)
      .where(
        and(
          eq(schema.seoAgentLog.action, 'article.published'),
          eq(schema.seoAgentLog.articleId, w.id),
        ),
      );
    if (pub.statusCode === 200) {
      expect((log!.details as { gate: { contentHash: string } }).gate.contentHash).toBe(
        articleContentHash(CONTENT),
      );
    } else {
      expect(edit.statusCode).toBe(200);
      expect(pub.json().reasons).toContain('stale_fact_check');
    }
  });

  it('11: a repeated publish attempt is handled once (409 already_published, one post-publish check)', async () => {
    const a = await article({ reviewNotes: verifiedReviewNotes(CONTENT) });
    expect((await publish(a.id)).statusCode).toBe(200);
    const again = await publish(a.id);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('already_published');
    expect(
      await t.db
        .select()
        .from(schema.seoTasks)
        .where(eq(schema.seoTasks.kind, 'post_publish_check')),
    ).toHaveLength(1);
    // A blocked article stays blocked on retry, nothing half-done.
    const b = await article();
    expect((await publish(b.id)).statusCode).toBe(409);
    expect((await publish(b.id)).statusCode).toBe(409);
    expect((await get(b.id)).campaignId).toBeNull();
  });

  it('the article card shows the gate decision for the owner', async () => {
    const a = await article({ reviewNotes: UNVERIFIED(articleContentHash(CONTENT)) });
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/seo/articles/${a.id}`,
      headers: { cookie, 'x-zybrilka-admin': '1' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().publicationGate).toMatchObject({
      allowed: false,
      manualAllowed: true,
      unverifiedCritical: ['Демоверсия 2027 выйдет в августе'],
    });
  });
});
