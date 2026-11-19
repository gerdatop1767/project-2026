/**
 * Stage 1 regressions (docs/SEO_CENTER_AUDIT.md §D): reliability of the
 * queue and the AI gateway, the article lifecycle on failures, research
 * caching, Telegram HTML and the trainer links. Real PGlite database, fake
 * model and network — no paid API is called.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  createSeoCampaign,
  enqueueSeoTask,
  loadSeoSettings,
  publishSeoArticle,
  saveSeoSettings,
  schema,
} from '@zybrilka/db';
import { createTestDb } from '@zybrilka/db/testing';
import { DEFAULT_SEO_SETTINGS, isAllowedCampaignTarget, SEO_SITE_PAGES } from '@zybrilka/shared';
import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AiBlocked, PENDING, SeoAi, requestWorstCaseUsd, type AiClient } from './ai.js';
import { analyticsHandlers } from './agents/index.js';
import { checkTelegramHtml, telegramPostHtml, TELEGRAM_TEXT_LIMIT } from './agents/distribution.js';
import { SITE_PAGES, type HttpFetch, type SeoDeps } from './deps.js';
import { SeoQueue, type TaskHandler } from './queue.js';
import { SeoScheduler } from './scheduler.js';
import { runInTaskScope } from './taskScope.js';

const logger = pino({ enabled: false });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function message(text: string, extra: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
    },
    ...extra,
  } as unknown as Anthropic.Message;
}

type Respond = (
  p: Anthropic.MessageStreamParams,
  signal?: AbortSignal,
) => Promise<Anthropic.Message>;
function client(
  respond: Respond,
  seen: { params: Anthropic.MessageStreamParams; signal?: AbortSignal }[] = [],
): AiClient {
  return {
    messages: {
      stream: (params, options) => {
        seen.push({ params, signal: options?.signal });
        return { finalMessage: () => respond(params, options?.signal) };
      },
    },
  };
}
/** A model request that only ends when it is aborted (a stuck/slow generation). */
const hang: Respond = (_p, signal) =>
  new Promise((_, reject) => {
    if (!signal) return;
    signal.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
  });
const systemOf = (p: Anthropic.MessageStreamParams) =>
  Array.isArray(p.system) ? p.system.map((b) => b.text).join('') : '';
const structured = (p: Anthropic.MessageStreamParams) =>
  Boolean(p.output_config && 'format' in p.output_config && p.output_config.format);

const LONG_NOTES =
  'Факты: профильная математика ЕГЭ 2027 — по демоверсии и спецификации ФИПИ; задание 13 — уравнение с отбором корней, 2 первичных балла. Частые вопросы школьников: как отбирать корни, какую тригонометрию повторить. https://fipi.ru/ege';

const prose = (tag: string, n: number) =>
  Array.from(
    { length: n },
    (_, i) => `Пример${tag}${i} показывает приём${i} на случае${i} для задачи${i}.`,
  ).join(' ');
const ARTICLE = {
  title: 'Задание 13 ЕГЭ по математике: как решать',
  seoTitle: 'Задание 13 ЕГЭ по математике: как решать уравнения',
  metaDescription:
    'Как решать задание 13 ЕГЭ по профильной математике: что проверяют, пошаговый алгоритм, отбор корней и типичные ошибки школьников.',
  h1: 'Задание 13 ЕГЭ: как решать',
  slugHint: 'zadanie-13-ege',
  format: 'task_breakdown',
  bodyMd: [
    'Вступление про задание 13 ЕГЭ.',
    '## Что проверяют',
    `Подробнее в [теории](/theory). ${prose('a', 30)}`,
    '## Алгоритм',
    `Тренируйся в [профиле](/subjects/math). ${prose('b', 30)}`,
    '## Ошибки',
    prose('c', 30),
  ].join('\n\n'),
  faq: [
    { question: 'Сколько баллов за задание 13?', answer: 'Два первичных балла за оба пункта.' },
    { question: 'Нужна ли ОДЗ?', answer: 'Да, иначе появятся лишние корни.' },
    { question: 'Как отбирать корни?', answer: 'На окружности или через неравенство.' },
  ],
  sources: [{ title: 'ФИПИ', url: 'https://fipi.ru/ege' }],
  ogTitle: 'Задание 13 ЕГЭ',
  ogDescription: 'Алгоритм решения задания 13.',
  primaryKeyword: 'задание 13 ЕГЭ',
  secondaryKeywords: [],
  ctaPath: '/theory',
};

describe('stage 1: queue, AI gateway and article lifecycle', () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    t = await createTestDb();
    await saveSeoSettings(
      t.db,
      { ...DEFAULT_SEO_SETTINGS, dailyBudgetUsd: 50, monthlyBudgetUsd: 500 },
      null,
    );
  });
  afterEach(async () => {
    await t.close();
  });

  const deps = (
    c: AiClient | null,
    fetch: HttpFetch = async () => new Response('', { status: 404 }),
  ): SeoDeps => ({
    db: t.db,
    ai: new SeoAi({ db: t.db, client: c, logger }),
    logger,
    origin: 'https://z.test',
    fetch,
    secretsKey: null,
    telegramBotToken: '1:x',
    now: () => new Date(),
  });
  const fastQueue = (
    handlers: Partial<Record<string, TaskHandler>>,
    extra: Partial<ConstructorParameters<typeof SeoQueue>[0]> = {},
  ) => new SeoQueue({ db: t.db, logger, handlers, backoffBaseMs: 1, ...extra });
  const task = async (key: string) =>
    (await t.db.select().from(schema.seoTasks).where(eq(schema.seoTasks.idempotencyKey, key)))[0]!;
  const makeDue = (key: string) =>
    t.db
      .update(schema.seoTasks)
      .set({ runAfter: new Date(0) })
      .where(eq(schema.seoTasks.idempotencyKey, key));

  // ── 1–2. Temporary API error during generation ─────────────────────────
  it('a transient model error puts the article back (not «generating»), keeps the reason, and the retry succeeds', async () => {
    let writes = 0;
    const d = deps(
      client(async (p) => {
        if (!structured(p)) return message(LONG_NOTES);
        if (systemOf(p).includes('образовательный редактор')) {
          writes++;
          if (writes === 1) throw new Error('529 overloaded_error');
          return message(JSON.stringify(ARTICLE));
        }
        return message('{}');
      }),
    );
    const [topic] = await t.db
      .insert(schema.seoTopics)
      .values({
        title: 'Задание 13 ЕГЭ',
        normalized: 'z13',
        primaryKeyword: 'задание 13 ЕГЭ',
        source: 't',
        status: 'planned',
      })
      .returning();
    await enqueueSeoTask(t.db, {
      kind: 'write_article',
      agent: 'content',
      idempotencyKey: 'w',
      payload: { topicId: topic!.id },
    });
    const q = fastQueue(analyticsHandlers(d));

    await q.process(1);
    let [article] = await t.db.select().from(schema.seoArticles);
    expect(article!.status).toBe('idea');
    expect(article!.error).toContain('Попытка 1 из 3 не удалась');
    expect(article!.error).toContain('529');
    let tk = await task('w');
    expect(tk).toMatchObject({ status: 'queued', attempts: 1, articleId: article!.id });
    expect(tk.runAfter.getTime()).toBeGreaterThan(Date.now() - 1000);

    // Retry (same task, topic already linked to the article) resumes, not fails.
    await makeDue('w');
    await q.process(1);
    tk = await task('w');
    [article] = await t.db.select().from(schema.seoArticles);
    expect(tk.status).toBe('done');
    expect(article).toMatchObject({ status: 'draft', error: null });
    expect(await t.db.select().from(schema.seoArticles)).toHaveLength(1);
    // The expensive fact research was cached by the first attempt: the retry did not pay for it again.
    const facts = (await t.db.select().from(schema.seoAiUsage)).filter(
      (u) => u.purpose === 'article.facts',
    );
    expect(facts).toHaveLength(1);
  });

  it('after the last attempt the article is «Ошибка» with the reason; retries are bounded with backoff', async () => {
    const d = deps(
      client(async (p) =>
        structured(p) ? Promise.reject(new Error('500 api_error')) : message(LONG_NOTES),
      ),
    );
    const [a] = await t.db
      .insert(schema.seoArticles)
      .values({ slug: 'x', title: 'X', status: 'idea' })
      .returning();
    await enqueueSeoTask(t.db, {
      kind: 'write_article',
      agent: 'content',
      idempotencyKey: 'w',
      payload: { articleId: a!.id },
    });
    const q = fastQueue(analyticsHandlers(d), { backoffBaseMs: 60_000 });
    const runAfters: number[] = [];
    for (let i = 0; i < 3; i++) {
      await q.process(1);
      const tk = await task('w');
      runAfters.push(tk.runAfter.getTime() - Date.now());
      await makeDue('w');
    }
    const tk = await task('w');
    const [article] = await t.db.select().from(schema.seoArticles);
    expect(tk).toMatchObject({ status: 'failed', attempts: 3 });
    expect(article!.status).toBe('error');
    expect(article!.error).toContain('Генерация не удалась');
    // backoff 1 min, then 4 min between the attempts
    expect(runAfters[0]).toBeGreaterThan(50_000);
    expect(runAfters[1]).toBeGreaterThan(200_000);
    // Nothing more runs.
    expect(await q.process(5)).toBe(0);
  });

  it('a live article being updated stays on the site (status kept) even when the update fails', async () => {
    const d = deps(
      client(async (p) =>
        structured(p) ? Promise.reject(new Error('timeout')) : message(LONG_NOTES),
      ),
    );
    const [a] = await t.db
      .insert(schema.seoArticles)
      .values({
        slug: 'live',
        title: 'Live',
        status: 'published',
        publishedAt: new Date(),
        bodyMd: 'x'.repeat(300),
      })
      .returning();
    await enqueueSeoTask(t.db, {
      kind: 'write_article',
      agent: 'content',
      idempotencyKey: 'u',
      payload: { articleId: a!.id, instructions: 'обнови' },
    });
    let during: string | undefined;
    const handlers = analyticsHandlers(d);
    const write = handlers.write_article!;
    handlers.write_article = async (ctx) => {
      const p = write(ctx);
      await sleep(5);
      during = (await t.db.select().from(schema.seoArticles))[0]!.status;
      return p;
    };
    await fastQueue(handlers).process(1);
    const [after] = await t.db.select().from(schema.seoArticles);
    expect(during).toBe('published');
    expect(after!.status).toBe('published');
    expect(after!.error).toContain('timeout');
  });

  // ── Worker restart ─────────────────────────────────────────────────────
  it('worker restart mid-generation: the expired lease is recovered and the write resumes the same article', async () => {
    const d = deps(
      client(async (p) => (structured(p) ? message(JSON.stringify(ARTICLE)) : message(LONG_NOTES))),
    );
    const [topic] = await t.db
      .insert(schema.seoTopics)
      .values({
        title: 'Задание 13',
        normalized: 'z',
        primaryKeyword: 'задание 13 ЕГЭ',
        source: 't',
        status: 'writing',
      })
      .returning();
    const [a] = await t.db
      .insert(schema.seoArticles)
      .values({ slug: 'z13', title: 'Задание 13', status: 'generating', topicId: topic!.id })
      .returning();
    await t.db
      .update(schema.seoTopics)
      .set({ articleId: a!.id })
      .where(eq(schema.seoTopics.id, topic!.id));
    // The dead worker's task: running, lease already expired.
    await t.db.insert(schema.seoTasks).values({
      kind: 'write_article',
      agent: 'content',
      idempotencyKey: 'dead',
      status: 'running',
      attempts: 1,
      payload: { topicId: topic!.id },
      articleId: a!.id,
      lockedBy: 'w-dead',
      lockedUntil: new Date(Date.now() - 1000),
    });
    await fastQueue(analyticsHandlers(d)).process(1);
    const tk = await task('dead');
    const [article] = await t.db.select().from(schema.seoArticles);
    expect(tk).toMatchObject({ status: 'done', attempts: 2 });
    expect(article!.status).toBe('draft');
    expect(await t.db.select().from(schema.seoArticles)).toHaveLength(1);
  });

  it('the sweep releases articles stuck in «generating» without a live task (and leaves ones with a task)', async () => {
    const old = new Date(Date.now() - 3600_000);
    const [stuck] = await t.db
      .insert(schema.seoArticles)
      .values({ slug: 's', title: 'S', status: 'generating', updatedAt: old })
      .returning();
    const [busy] = await t.db
      .insert(schema.seoArticles)
      .values({ slug: 'b', title: 'B', status: 'generating', updatedAt: old })
      .returning();
    await t.db.insert(schema.seoTasks).values({
      kind: 'write_article',
      agent: 'content',
      idempotencyKey: 'live',
      status: 'running',
      articleId: busy!.id,
      lockedUntil: new Date(Date.now() + 60_000),
    });
    const r = await new SeoScheduler(deps(null)).sweep();
    expect(r.stuckArticles).toBe(1);
    const rows = await t.db.select().from(schema.seoArticles);
    expect(rows.find((x) => x.id === stuck!.id)).toMatchObject({ status: 'error' });
    expect(rows.find((x) => x.id === busy!.id)).toMatchObject({ status: 'generating' });
  });

  // ── 10–11. Timeout cancels the operation; no parallel second run ───────
  it('timeout aborts the model request itself, waits for it to stop, then retries — no request after the abort', async () => {
    const seen: { params: Anthropic.MessageStreamParams; signal?: AbortSignal }[] = [];
    const d = deps(client(hang, seen));
    await enqueueSeoTask(t.db, { kind: 'research', agent: 'research', idempotencyKey: 'r' });
    const q = fastQueue(analyticsHandlers(d), { taskTimeoutMs: 150, heartbeatMs: 30 });
    await q.process(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.signal?.aborted).toBe(true);
    const tk = await task('r');
    expect(tk).toMatchObject({ status: 'queued', attempts: 1 });
    expect(tk.error).toContain('timed out');
    // Aborted before any byte arrived: the real cost is unknown, so the
    // request is settled to its input estimate (never a silent $0, never left pending).
    const [u] = await t.db.select().from(schema.seoAiUsage);
    expect(u!.ok).toBe(false);
    expect(u!.error).toMatch(/^unknown_estimated: /);
    expect(Number(u!.costUsd)).toBeGreaterThan(0);
    await sleep(50);
    expect(seen).toHaveLength(1);
  });

  it('a slow task keeps its lease alive: another worker cannot recover or start it in parallel', async () => {
    let runs = 0;
    const handlers = {
      slow: async () => {
        runs++;
        await sleep(500);
      },
    };
    await enqueueSeoTask(t.db, { kind: 'slow', agent: 'system', idempotencyKey: 'slow' });
    const a = fastQueue(handlers, { leaseMs: 150, heartbeatMs: 40 });
    const b = fastQueue(handlers, { leaseMs: 150, heartbeatMs: 40 });
    const first = a.process(1);
    await sleep(350); // well past the initial 150 ms lease — only the heartbeat keeps it
    expect(await b.recoverExpired()).toBe(0);
    expect(await b.process(1)).toBe(0);
    await first;
    expect(runs).toBe(1);
    expect((await task('slow')).status).toBe('done');
  });

  it('a re-delivered job runs once: two workers racing for the same task', async () => {
    let runs = 0;
    const handlers = {
      once: async () => {
        runs++;
        await sleep(30);
      },
    };
    await enqueueSeoTask(t.db, { kind: 'once', agent: 'system', idempotencyKey: 'once' });
    expect(
      await enqueueSeoTask(t.db, { kind: 'once', agent: 'system', idempotencyKey: 'once' }),
    ).toBe(false);
    await Promise.all([fastQueue(handlers).process(1), fastQueue(handlers).process(1)]);
    expect(runs).toBe(1);
    expect((await task('once')).status).toBe('done');
  });

  it('«Остановить всё» during a running task aborts its model request and parks the task', async () => {
    const seen: { params: Anthropic.MessageStreamParams; signal?: AbortSignal }[] = [];
    const d = deps(client(hang, seen));
    await enqueueSeoTask(t.db, { kind: 'research', agent: 'research', idempotencyKey: 'r' });
    const q = fastQueue(analyticsHandlers(d), { heartbeatMs: 30, taskTimeoutMs: 10_000 });
    const running = q.process(1);
    await sleep(60);
    await saveSeoSettings(t.db, { ...(await loadSeoSettings(t.db)), emergencyStop: true }, null);
    await running;
    expect(seen[0]!.signal?.aborted).toBe(true);
    expect(await task('r')).toMatchObject({
      status: 'blocked',
      error: 'emergency_stop',
      attempts: 0,
    });
  });

  // ── 12. Budget: atomic reservations ───────────────────────────────────
  it('concurrent calls cannot jointly exceed the budget; reserves are released to the real cost', async () => {
    const worst = requestWorstCaseUsd(
      'claude-haiku-5-5',
      's' + JSON.stringify([{ role: 'user', content: 'p' }]),
      4000,
      0,
    );
    // Room for exactly one worst case.
    await saveSeoSettings(
      t.db,
      { ...DEFAULT_SEO_SETTINGS, dailyBudgetUsd: worst * 1.5, monthlyBudgetUsd: 100 },
      null,
    );
    const ai = new SeoAi({
      db: t.db,
      client: client(async () => {
        await sleep(80);
        return message('ok');
      }),
      logger,
    });
    const call = () =>
      ai.text({
        agent: 'content',
        purpose: 'p',
        tier: 'cheap',
        system: 's',
        prompt: 'p',
        maxTokens: 4000,
      });
    const results = await Promise.allSettled([call(), call(), call()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(refused).toHaveLength(2);
    for (const r of refused) expect(r.reason).toMatchObject({ reason: 'budget_daily' });
    const usage = await t.db.select().from(schema.seoAiUsage);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ ok: true, error: null, inputTokens: 100, outputTokens: 50 });
    expect(Number(usage[0]!.costUsd)).toBeLessThan(worst); // reserve released to the real cost
    // Once released, the next call fits again.
    await expect(call()).resolves.toMatchObject({ text: 'ok' });
  });

  it('every pause_turn continuation is reserved: the budget can stop a call between its requests', async () => {
    const worst = requestWorstCaseUsd(
      'claude-haiku-5-5',
      's' + JSON.stringify([{ role: 'user', content: 'p' }]),
      4000,
      0,
    );
    await saveSeoSettings(
      t.db,
      { ...DEFAULT_SEO_SETTINGS, dailyBudgetUsd: worst * 1.2, monthlyBudgetUsd: 100 },
      null,
    );
    let n = 0;
    const seen: { params: Anthropic.MessageStreamParams }[] = [];
    const ai = new SeoAi({
      db: t.db,
      client: client(async () => {
        n++;
        // A big first answer: its real cost leaves no room for the continuation's worst case.
        return message('part', {
          stop_reason: 'pause_turn',
          usage: {
            input_tokens: 100,
            output_tokens: 3000,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
          } as Anthropic.Usage,
        });
      }, seen),
      logger,
    });
    await expect(
      ai.text({
        agent: 'content',
        purpose: 'p',
        tier: 'cheap',
        system: 's',
        prompt: 'p',
        maxTokens: 4000,
      }),
    ).rejects.toBeInstanceOf(AiBlocked);
    expect(n).toBe(1);
    expect(await t.db.select().from(schema.seoAiUsage)).toHaveLength(1);
  });

  it('a request the API refused (HTTP error) releases its reservation: cost 0, reason kept', async () => {
    const refused = new Anthropic.RateLimitError(
      429,
      { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } },
      '429 rate_limit_error',
      new Headers(),
    );
    const ai = new SeoAi({ db: t.db, client: client(async () => Promise.reject(refused)), logger });
    await expect(
      ai.text({
        agent: 'content',
        purpose: 'p',
        tier: 'cheap',
        system: 's',
        prompt: 'p',
        maxTokens: 1000,
      }),
    ).rejects.toThrow('429');
    const [u] = await t.db.select().from(schema.seoAiUsage);
    expect(u).toMatchObject({ ok: false, costUsd: 0 });
    expect(u!.error).toMatch(/^refused: /);
  });

  it('a network failure before any answer keeps an input-cost estimate (unknown spend, safe side)', async () => {
    const ai = new SeoAi({
      db: t.db,
      client: client(async () => Promise.reject(new TypeError('fetch failed'))),
      logger,
    });
    await expect(
      ai.text({
        agent: 'content',
        purpose: 'p',
        tier: 'cheap',
        system: 's',
        prompt: 'p',
        maxTokens: 1000,
      }),
    ).rejects.toThrow('fetch failed');
    const [u] = await t.db.select().from(schema.seoAiUsage);
    expect(u!.error).toMatch(/^unknown_estimated: /);
    expect(Number(u!.costUsd)).toBeGreaterThan(0);
  });

  it('a reservation left by a crashed worker is kept at its worst case and marked abandoned', async () => {
    await t.db.insert(schema.seoAiUsage).values({
      agent: 'content',
      purpose: 'p',
      model: 'm',
      costUsd: 1.5,
      ok: false,
      error: PENDING,
      at: new Date(Date.now() - 2 * 3600_000),
    });
    await new SeoScheduler(deps(null)).sweep();
    const [u] = await t.db.select().from(schema.seoAiUsage);
    expect(u).toMatchObject({ error: 'abandoned', costUsd: 1.5 });
  });

  // ── 7. Empty research is not cached ───────────────────────────────────
  it('an empty research answer is not cached and the task retries', async () => {
    let calls = 0;
    const d = deps(
      client(async (p) => {
        calls++;
        return structured(p) ? message(JSON.stringify({ topics: [] })) : message('   ');
      }),
    );
    await enqueueSeoTask(t.db, { kind: 'research', agent: 'research', idempotencyKey: 'r' });
    const q = fastQueue(analyticsHandlers(d));
    await q.process(1);
    expect(await t.db.select().from(schema.seoResearchCache)).toHaveLength(0);
    expect(await task('r')).toMatchObject({ status: 'queued' });
    expect((await task('r')).error).toContain('empty');
    await makeDue('r');
    await q.process(1);
    expect(calls).toBe(2); // asked the model again instead of reusing an empty cache
  });

  // ── 5. Trainer links ─────────────────────────────────────────────────
  it('all 11 trainer pages are allowed campaign targets; a stored disallowed path falls back safely', async () => {
    expect(SITE_PAGES).toBe(SEO_SITE_PAGES);
    expect(SEO_SITE_PAGES).toHaveLength(11);
    for (const p of SEO_SITE_PAGES) expect(isAllowedCampaignTarget(p.path), p.path).toBe(true);
    await expect(
      createSeoCampaign(t.db, { name: 'x', source: 's', channel: 'c', targetPath: '/admin' }),
    ).rejects.toThrow('not allowed');
    const [a] = await t.db
      .insert(schema.seoArticles)
      .values({
        slug: 'legacy',
        title: 'Legacy',
        status: 'draft',
        seoTitle: 'Legacy title',
        metaDescription: 'd'.repeat(120),
        bodyMd: 'x'.repeat(300),
        ctaPath: '/admin',
      })
      .returning();
    const out = await publishSeoArticle(t.db, a!.id, { kind: 'agent' });
    expect(out.ok).toBe(true);
    const [c] = await t.db.select().from(schema.campaigns);
    expect(c!.targetPath).toBe('/training');
  });

  it('the task scope reaches fetch: an aborted task cancels its HTTP request', async () => {
    const controller = new AbortController();
    let got: AbortSignal | undefined;
    const { taskScopedFetch } = await import('./taskScope.js');
    const f = taskScopedFetch(async (_u, init) => {
      got = init?.signal ?? undefined;
      return new Response('');
    });
    await runInTaskScope({ signal: controller.signal, taskId: 't' }, () => f('https://x.test'));
    controller.abort();
    expect(got?.aborted).toBe(true);
  });
});

describe('stage 1: Telegram HTML', () => {
  const link = 'https://zybrilka.ru/api/v1/go/AbC123xyz0';

  it('a long post with entities near the limit is cut on plain text: no broken entity, link kept, within the limit', () => {
    for (const filler of [
      `${'а'.repeat(4070)} & <b>x</b> "q" ${'б'.repeat(200)}`,
      '&'.repeat(5000),
      `${'😀'.repeat(2100)}`,
    ]) {
      const html = telegramPostHtml('Заголовок <важный> & нужный', filler, link);
      const check = checkTelegramHtml(html);
      expect(check.ok, JSON.stringify(check)).toBe(true);
      if (check.ok) expect(check.textLength).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
      expect(html.endsWith(link)).toBe(true);
      expect(html.startsWith('<b>Заголовок &lt;важный&gt; &amp; нужный</b>')).toBe(true);
      expect(html).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/); // no split surrogate pair
    }
  });

  it('a short post is sent as is (link not duplicated)', () => {
    const html = telegramPostHtml(null, `Коротко про задание 13. ${link}`, link);
    expect(html).toBe(`Коротко про задание 13. ${link}`);
  });

  it('the validator rejects what the old slice produced', () => {
    expect(checkTelegramHtml(`${'а'.repeat(10)} &am`)).toMatchObject({ ok: false });
    expect(checkTelegramHtml('<b>open')).toMatchObject({ ok: false });
    expect(checkTelegramHtml('<i>x</i>')).toMatchObject({ ok: false });
    expect(checkTelegramHtml('x'.repeat(5000))).toMatchObject({ ok: false });
  });

  it('publish_external sends only a validated message (fake Telegram, nothing real is sent)', async () => {
    const t = await createTestDb();
    try {
      const sent: string[] = [];
      const fetch: HttpFetch = async (url, init) => {
        if (url.startsWith('https://api.telegram.org/')) {
          sent.push((JSON.parse(String(init?.body)) as { text: string }).text);
          return Response.json({ ok: true, result: { message_id: 7, chat: { username: 'ch' } } });
        }
        return new Response('', { status: 404 });
      };
      const d: SeoDeps = {
        db: t.db,
        ai: new SeoAi({ db: t.db, client: null, logger }),
        logger,
        origin: 'https://z.test',
        fetch,
        secretsKey: null,
        telegramBotToken: '1:x',
        now: () => new Date(),
      };
      const scheduler = new SeoScheduler(d);
      await scheduler.init();
      await t.db
        .insert(schema.seoIntegrations)
        .values({ kind: 'telegram_channel', config: { channelId: '@ch' }, status: 'connected' });
      const [platform] = await t.db
        .select()
        .from(schema.seoPlatforms)
        .where(eq(schema.seoPlatforms.slug, 'telegram'));
      const [post] = await t.db
        .insert(schema.seoExternalPosts)
        .values({
          platformId: platform!.id,
          status: 'ready',
          title: 'T & T',
          body: `${'текст '.repeat(900)}& конец`,
          link,
        })
        .returning();
      await enqueueSeoTask(t.db, {
        kind: 'publish_external',
        agent: 'distribution',
        idempotencyKey: 'p',
        payload: { postId: post!.id, manual: true },
      });
      await scheduler.queue.process(1);
      expect(sent).toHaveLength(1);
      expect(checkTelegramHtml(sent[0]!).ok).toBe(true);
      expect(sent[0]!.endsWith(link)).toBe(true);
      const [after] = await t.db.select().from(schema.seoExternalPosts);
      expect(after).toMatchObject({ status: 'published', externalUrl: 'https://t.me/ch/7' });
    } finally {
      await t.close();
    }
  });
});
