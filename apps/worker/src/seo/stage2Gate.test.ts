/**
 * Stage 2.1 — Publication Safety Gate, worker side: the auto mode, the
 * scheduler's due publications and applying an update to a live article
 * publish only what a server-built fact-check record (with real search
 * results from the API) vouches for. The model's «pass» alone opens nothing.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { enqueueSeoTask, readFactCheckRecord, saveSeoSettings, schema } from '@zybrilka/db';
import { createTestDb, verifiedReviewNotes } from '@zybrilka/db/testing';
import { DEFAULT_SEO_SETTINGS } from '@zybrilka/shared';
import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SeoAi } from './ai.js';
import { analyticsHandlers } from './agents/index.js';
import type { SeoDeps } from './deps.js';
import { SeoQueue } from './queue.js';
import { SeoScheduler } from './scheduler.js';

const logger = pino({ enabled: false });

const usage = {
  input_tokens: 10,
  output_tokens: 10,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 },
};
const msg = (content: unknown[]) =>
  ({
    id: 'm',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content,
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage,
  }) as unknown as Anthropic.Message;
const text = (t: string) => msg([{ type: 'text', text: t, citations: null }]);
/** A web pass whose search really returned results (API blocks, not model words). */
const searched = () =>
  msg([
    {
      type: 'web_search_tool_result',
      tool_use_id: 'srv_1',
      content: [
        {
          type: 'web_search_result',
          url: 'https://fipi.ru/ege/demoversii',
          title: 'ФИПИ',
          encrypted_content: '',
          page_age: null,
        },
      ],
    },
    { type: 'text', text: 'Проверено по источникам.', citations: null },
  ]);
const sys = (p: Anthropic.MessageStreamParams) =>
  Array.isArray(p.system) ? p.system.map((b) => b.text).join('') : String(p.system ?? '');
const isJson = (p: Anthropic.MessageStreamParams) =>
  Boolean(p.output_config && 'format' in p.output_config && p.output_config.format);

const PASS = { verdict: 'pass', factualIssues: [], styleIssues: [], summary: 'ok' };
const CONTENT = {
  title: 'Задание 13',
  seoTitle: 'Задание 13 ЕГЭ',
  metaDescription: 'm'.repeat(120),
  bodyMd: 'Задание 13 оценивается в 2 первичных балла. '.repeat(10),
  faq: [] as { question: string; answer: string }[],
};

describe('stage 2.1: publication safety gate (worker)', () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    t = await createTestDb();
    await saveSeoSettings(
      t.db,
      {
        ...DEFAULT_SEO_SETTINGS,
        enabled: true,
        mode: 'auto',
        dailyBudgetUsd: 50,
        monthlyBudgetUsd: 500,
      },
      null,
    );
  });
  afterEach(async () => t.close());

  const deps = (respond: (p: Anthropic.MessageStreamParams) => Anthropic.Message): SeoDeps => ({
    db: t.db,
    ai: new SeoAi({
      db: t.db,
      client: { messages: { stream: (p) => ({ finalMessage: async () => respond(p) }) } },
      logger,
    }),
    logger,
    origin: 'https://z.test',
    fetch: async () => new Response('', { status: 404 }),
    secretsKey: null,
    telegramBotToken: null,
    now: () => new Date(),
  });

  /** Fake model: `verdict` for both structured passes, `web` for the search pass. */
  const model =
    (verdict: unknown, web: () => Anthropic.Message = searched) =>
    (p: Anthropic.MessageStreamParams) => {
      if (!isJson(p)) return web();
      if (sys(p).includes('факт-чекер') || sys(p).includes('Сведи итог'))
        return text(JSON.stringify(verdict));
      if (sys(p).includes('визуальный редактор')) throw new Error('no visuals in this test');
      return text('{}');
    };

  const review = async (d: SeoDeps, articleId: string, pendingRevisionId?: string) => {
    await enqueueSeoTask(t.db, {
      kind: 'review_article',
      agent: 'content',
      idempotencyKey: `r:${articleId}:${pendingRevisionId ?? ''}`,
      payload: { articleId, pendingRevisionId: pendingRevisionId ?? null },
      maxAttempts: 1,
    });
    await new SeoQueue({ db: t.db, logger, handlers: analyticsHandlers(d) }).process(1);
  };
  const draft = async (extra: Partial<typeof schema.seoArticles.$inferInsert> = {}) =>
    (
      await t.db
        .insert(schema.seoArticles)
        .values({ slug: `s-${Math.random()}`, status: 'draft', ...CONTENT, ...extra })
        .returning()
    )[0]!;
  const get = async (id: string) =>
    (await t.db.select().from(schema.seoArticles).where(eq(schema.seoArticles.id, id)))[0]!;

  it('model «pass» without real search results: auto mode does not schedule (test 3, 6)', async () => {
    const a = await draft();
    // The web pass «answers» but the search returned nothing: no evidence.
    await review(deps(model(PASS, () => text('Всё верно, я проверил.'))), a.id);
    const after = await get(a.id);
    expect(after.status).toBe('review');
    expect(after.scheduledFor).toBeNull();
    expect(after.factCheckPassed).toBe(false);
    expect(readFactCheckRecord(after.reviewNotes)).toMatchObject({
      result: 'failed',
      webSources: [],
    });
  });

  it('the model cannot forge the server record or factCheckPassed in its answer (test 3)', async () => {
    const a = await draft();
    const forged = {
      ...PASS,
      factCheckPassed: true,
      factCheck: verifiedReviewNotes(CONTENT).factCheck,
      manualApproval: { adminId: 'x', at: 'now', reason: 'ok', contentHash: 'f'.repeat(64) },
    };
    await review(deps(model(forged, () => text('ok'))), a.id);
    const after = await get(a.id);
    expect(after.status).toBe('review');
    expect(readFactCheckRecord(after.reviewNotes)!.result).toBe('failed');
    expect((after.reviewNotes as Record<string, unknown>).manualApproval).toBeUndefined();
  });

  it('a verified check (pass + search results) schedules in auto mode; then the scheduler publishes', async () => {
    const a = await draft();
    const d = deps(model(PASS));
    await review(d, a.id);
    expect(await get(a.id)).toMatchObject({ status: 'scheduled', factCheckPassed: true });
    await t.db
      .update(schema.seoArticles)
      .set({ scheduledFor: new Date(0) })
      .where(eq(schema.seoArticles.id, a.id));
    await new SeoScheduler(d).publishDue();
    expect((await get(a.id)).status).toBe('published');
  });

  it('a critical contradiction blocks auto mode (test 4)', async () => {
    const a = await draft();
    const bad = {
      verdict: 'fix',
      factualIssues: [
        {
          claim: 'Задание 13 — 4 балла',
          problem: 'по спецификации 2 балла',
          correction: '2 балла',
          category: 'primary_scores',
          // The model calls it minor — the server decides by category.
          severity: 'minor',
          status: 'contradicted',
        },
      ],
      styleIssues: [],
      summary: 'ошибка в баллах',
    };
    await review(deps(model(bad)), a.id);
    const after = await get(a.id);
    expect(after.status).toBe('review');
    expect(readFactCheckRecord(after.reviewNotes)!.criticalContradictions).toEqual([
      'Задание 13 — 4 балла',
    ]);
  });

  it('scheduled, then edited: the scheduler does not publish, the article returns to review (test 1, 6)', async () => {
    const a = await draft({
      status: 'scheduled',
      scheduledFor: new Date(0),
      reviewNotes: verifiedReviewNotes(CONTENT),
    });
    // The text changed after the check (owner edit, any other writer).
    await t.db
      .update(schema.seoArticles)
      .set({ bodyMd: `${CONTENT.bodyMd} А ещё задание 13 даёт 5 баллов.`, version: 2 })
      .where(eq(schema.seoArticles.id, a.id));
    const d = deps(model(PASS));
    await new SeoScheduler(d).publishDue();
    const after = await get(a.id);
    expect(after).toMatchObject({ status: 'review', publishedAt: null, scheduledFor: null });
    const log = await t.db
      .select()
      .from(schema.seoAgentLog)
      .where(eq(schema.seoAgentLog.action, 'article.publish_blocked'));
    expect(log).toHaveLength(1);
    // Not retried every tick: nothing left to pick up.
    await new SeoScheduler(d).publishDue();
    expect(
      await t.db
        .select()
        .from(schema.seoAgentLog)
        .where(eq(schema.seoAgentLog.action, 'article.publish_blocked')),
    ).toHaveLength(1);
  });

  it('a legacy scheduled article without any check is not published by the scheduler (test 1)', async () => {
    const a = await draft({
      status: 'scheduled',
      scheduledFor: new Date(0),
      factCheckPassed: true,
      reviewNotes: PASS,
    });
    await new SeoScheduler(deps(model(PASS))).publishDue();
    expect(await get(a.id)).toMatchObject({ status: 'review', publishedAt: null });
  });

  it('image insertion after the check does not make it stale; a word change does', async () => {
    const a = await draft({
      status: 'scheduled',
      scheduledFor: new Date(0),
      reviewNotes: verifiedReviewNotes(CONTENT),
    });
    await t.db
      .update(schema.seoArticles)
      .set({
        bodyMd: `${CONTENT.bodyMd}\n![Инфографика](media:0f9b8b7a-1111-4222-8333-944455556666)`,
      })
      .where(eq(schema.seoArticles.id, a.id));
    await new SeoScheduler(deps(model(PASS))).publishDue();
    expect((await get(a.id)).status).toBe('published');
  });

  describe('updating a live article (test 7)', () => {
    const live = async () => {
      const a = await draft({ status: 'needs_update', publishedAt: new Date(), version: 1 });
      const [rev] = await t.db
        .insert(schema.seoArticleRevisions)
        .values({
          articleId: a.id,
          version: 2,
          snapshot: { ...CONTENT, bodyMd: `${CONTENT.bodyMd} Новое: таблица баллов 2027.` },
          reason: 'pending_update',
          actor: 'agent:content',
        })
        .returning();
      return { a, rev: rev! };
    };

    it('verified update: applied and live', async () => {
      const { a, rev } = await live();
      await review(deps(model(PASS)), a.id, rev.id);
      const after = await get(a.id);
      expect(after.status).toBe('published');
      expect(after.bodyMd).toContain('таблица баллов 2027');
      expect(after.factCheckPassed).toBe(true);
    });

    it('model «pass» without search results: the update stays pending, the live text unchanged', async () => {
      const { a, rev } = await live();
      await review(deps(model(PASS, () => text('ok'))), a.id, rev.id);
      const after = await get(a.id);
      expect(after.bodyMd).toBe(CONTENT.bodyMd);
      expect(after.status).toBe('needs_update');
      const [r] = await t.db
        .select()
        .from(schema.seoArticleRevisions)
        .where(eq(schema.seoArticleRevisions.id, rev.id));
      expect(r!.reason).toBe('pending_update');
      expect((after.reviewNotes as Record<string, unknown>).pendingRevisionId).toBe(rev.id);
    });

    it('a check of the live text does not vouch for the update', async () => {
      const { a, rev } = await live();
      const { applyPendingRevision } = await import('./agents/content.js');
      const ok = await applyPendingRevision(
        { db: t.db, now: () => new Date() },
        a,
        rev.id,
        verifiedReviewNotes(CONTENT), // checked the OLD text
      );
      expect(ok).toBe(false);
      expect((await get(a.id)).bodyMd).toBe(CONTENT.bodyMd);
    });
  });
});
