/**
 * Stage 2.1 final hardening, worker side: a fact-check of a live article
 * (published / needs_update) never takes it off the site. A check started
 * without a revision reviews the newest pending update (the candidate
 * version) or the live text; failure or an error leaves the live version as
 * it was; a new version goes live only through the gate.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { enqueueSeoTask, readFactCheckRecord, saveSeoSettings, schema } from '@zybrilka/db';
import { createTestDb, verifiedReviewNotes } from '@zybrilka/db/testing';
import { DEFAULT_SEO_SETTINGS, type SeoMode } from '@zybrilka/shared';
import { and, eq } from 'drizzle-orm';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SeoAi } from './ai.js';
import { analyticsHandlers } from './agents/index.js';
import type { SeoDeps } from './deps.js';
import { SeoQueue } from './queue.js';

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
const searched = () =>
  msg([
    {
      type: 'web_search_tool_result',
      tool_use_id: 'srv_1',
      content: [
        {
          type: 'web_search_result',
          url: 'https://fipi.ru/ege',
          title: 'ФИПИ',
          encrypted_content: '',
          page_age: null,
        },
      ],
    },
    { type: 'text', text: 'Проверено.', citations: null },
  ]);
const sys = (p: Anthropic.MessageStreamParams) =>
  Array.isArray(p.system) ? p.system.map((b) => b.text).join('') : String(p.system ?? '');
const isJson = (p: Anthropic.MessageStreamParams) =>
  Boolean(p.output_config && 'format' in p.output_config && p.output_config.format);

const PASS = { verdict: 'pass', factualIssues: [], styleIssues: [], summary: 'ok' };
const CONTRADICTION = {
  verdict: 'fix',
  factualIssues: [
    {
      claim: 'Задание 13 — 4 балла',
      problem: 'по спецификации 2',
      correction: '2 балла',
      category: 'primary_scores',
      severity: 'critical',
      status: 'contradicted',
    },
  ],
  styleIssues: [],
  summary: 'ошибка',
};
const CONTENT = {
  title: 'Задание 13',
  seoTitle: 'Задание 13 ЕГЭ',
  metaDescription: 'm'.repeat(120),
  bodyMd: 'Задание 13 оценивается в 2 первичных балла. '.repeat(10),
  faq: [] as { question: string; answer: string }[],
};
const NEW_BODY = `${CONTENT.bodyMd} Новое: таблица баллов 2027.`;

describe('stage 2.1 hardening: checking a live article keeps it on the site', () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  const settings = (mode: SeoMode) =>
    saveSeoSettings(
      t.db,
      { ...DEFAULT_SEO_SETTINGS, enabled: true, mode, dailyBudgetUsd: 50, monthlyBudgetUsd: 500 },
      null,
    );
  beforeEach(async () => {
    t = await createTestDb();
    await settings('auto');
  });
  afterEach(async () => t.close());

  const deps = (verdict: unknown | Error): SeoDeps => ({
    db: t.db,
    ai: new SeoAi({
      db: t.db,
      client: {
        messages: {
          stream: (p) => ({
            finalMessage: async () => {
              if (verdict instanceof Error) throw verdict;
              if (!isJson(p)) return searched();
              if (sys(p).includes('факт-чекер') || sys(p).includes('Сведи итог'))
                return msg([{ type: 'text', text: JSON.stringify(verdict), citations: null }]);
              throw new Error('not in this test');
            },
          }),
        },
      },
      logger,
    }),
    logger,
    origin: 'https://z.test',
    fetch: async () => new Response('', { status: 404 }),
    secretsKey: null,
    telegramBotToken: null,
    now: () => new Date(),
  });
  const review = async (d: SeoDeps, articleId: string, pendingRevisionId?: string) => {
    await enqueueSeoTask(t.db, {
      kind: 'review_article',
      agent: 'content',
      idempotencyKey: `r:${Math.random()}`,
      payload: { articleId, ...(pendingRevisionId ? { pendingRevisionId } : {}) },
      maxAttempts: 1,
    });
    // Only the check: the follow-up visuals task is not part of these tests.
    await t.db.delete(schema.seoTasks).where(eq(schema.seoTasks.kind, 'visuals'));
    await new SeoQueue({ db: t.db, logger, handlers: analyticsHandlers(d) }).process(1);
  };
  const live = async (status: 'published' | 'needs_update') => {
    const publishedAt = new Date('2026-09-01T10:00:00Z');
    const [a] = await t.db
      .insert(schema.seoArticles)
      .values({
        slug: `l-${Math.random()}`,
        status,
        publishedAt,
        reviewNotes: verifiedReviewNotes(CONTENT),
        factCheckPassed: true,
        ...CONTENT,
      })
      .returning();
    return a!;
  };
  const withPending = async (articleId: string) =>
    (
      await t.db
        .insert(schema.seoArticleRevisions)
        .values({
          articleId,
          version: 2,
          snapshot: { ...CONTENT, bodyMd: NEW_BODY },
          reason: 'pending_update',
          actor: 'admin:x',
        })
        .returning()
    )[0]!;
  const get = async (id: string) =>
    (await t.db.select().from(schema.seoArticles).where(eq(schema.seoArticles.id, id)))[0]!;
  const expectLive = async (id: string, status: string) => {
    const a = await get(id);
    expect(a.status).toBe(status);
    expect(a.publishedAt).toEqual(new Date('2026-09-01T10:00:00Z'));
    expect(a.bodyMd).toBe(CONTENT.bodyMd);
    return a;
  };

  it('needs_update, no pending update, check passes → stays needs_update (not «review»)', async () => {
    const a = await live('needs_update');
    await review(deps(PASS), a.id);
    const after = await expectLive(a.id, 'needs_update');
    expect(readFactCheckRecord(after.reviewNotes)!.result).toBe('verified');
  });

  it('needs_update, no pending update, check fails → stays needs_update on the site', async () => {
    const a = await live('needs_update');
    await review(deps(CONTRADICTION), a.id);
    const after = await expectLive(a.id, 'needs_update');
    expect(after.factCheckPassed).toBe(false);
    expect(readFactCheckRecord(after.reviewNotes)!.criticalContradictions).toHaveLength(1);
  });

  it('published, re-check finds a contradiction → stays published, never rescheduled', async () => {
    const a = await live('published');
    await review(deps(CONTRADICTION), a.id);
    const after = await expectLive(a.id, 'published');
    expect(after.scheduledFor).toBeNull();
  });

  it('the check itself fails (model error) → the live version is untouched', async () => {
    const a = await live('needs_update');
    await review(deps(new Error('upstream down')), a.id);
    const after = await expectLive(a.id, 'needs_update');
    expect(after.reviewNotes).toEqual(a.reviewNotes);
    const [task] = await t.db
      .select()
      .from(schema.seoTasks)
      .where(eq(schema.seoTasks.kind, 'review_article'));
    expect(task!.status).toBe('failed');
  });

  it('a check without a revision id reviews the newest pending update, kept apart from the live text', async () => {
    await settings('manual');
    const a = await live('needs_update');
    const rev = await withPending(a.id);
    await review(deps(PASS), a.id);
    const after = await expectLive(a.id, 'needs_update');
    expect((after.reviewNotes as Record<string, unknown>).pendingRevisionId).toBe(rev.id);
    const record = readFactCheckRecord(after.reviewNotes)!;
    expect(record).toMatchObject({ result: 'verified', revisionId: rev.id });
    const [r] = await t.db
      .select()
      .from(schema.seoArticleRevisions)
      .where(eq(schema.seoArticleRevisions.id, rev.id));
    expect(r!.reason).toBe('pending_update'); // manual mode: waits for the owner
  });

  it('auto mode: the new version goes live only after its own successful check', async () => {
    const a = await live('needs_update');
    const rev = await withPending(a.id);
    // A failing check of the update: nothing changes on the site.
    await review(deps(CONTRADICTION), a.id, rev.id);
    await expectLive(a.id, 'needs_update');
    // A passing one: applied, published.
    await review(deps(PASS), a.id, rev.id);
    const after = await get(a.id);
    expect(after).toMatchObject({ status: 'published', bodyMd: NEW_BODY, factCheckPassed: true });
    const [r] = await t.db
      .select()
      .from(schema.seoArticleRevisions)
      .where(
        and(
          eq(schema.seoArticleRevisions.id, rev.id),
          eq(schema.seoArticleRevisions.reason, 'applied_update'),
        ),
      );
    expect(r).toBeTruthy();
  });

  it('draft / review statuses still move to «review» after a check (not live)', async () => {
    const [d] = await t.db
      .insert(schema.seoArticles)
      .values({ slug: 'd', status: 'draft', ...CONTENT })
      .returning();
    await settings('manual');
    await review(deps(PASS), d!.id);
    expect((await get(d!.id)).status).toBe('review');
  });
});
