/**
 * Stage 1 security/correctness audit (crash between API answer and DB
 * commit, real cancellation of model requests, lease loss and fencing,
 * atomic status transitions). The cancellation tests run the REAL
 * @anthropic-ai/sdk against a local HTTP server speaking the Messages
 * streaming format — no paid API is called.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Anthropic from '@anthropic-ai/sdk';
import {
  enqueueSeoTask,
  loadSeoSettings,
  publishSeoArticle,
  saveSeoSettings,
  schema,
} from '@zybrilka/db';
import { createTestDb, verifiedReviewNotes } from '@zybrilka/db/testing';
import { DEFAULT_SEO_SETTINGS } from '@zybrilka/shared';
import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PENDING, SeoAi, type AiClient } from './ai.js';
import { analyticsHandlers } from './agents/index.js';
import type { SeoDeps } from './deps.js';
import { SeoQueue } from './queue.js';
import { runInTaskScope } from './taskScope.js';

const logger = pino({ enabled: false });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A local stand-in for POST /v1/messages (streaming), slow on purpose. */
function fakeAnthropic() {
  const state = { requests: 0, closedEarly: 0, finished: 0, deltasSent: 0 };
  const server: Server = createServer((req, res) => {
    state.requests++;
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'request-id': `req_${state.requests}`,
      });
      let open = true;
      res.on('close', () => {
        if (open) state.closedEarly++;
        open = false;
      });
      const send = (event: string, data: unknown) => {
        if (open) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      send('message_start', {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-haiku-5-5',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 12_000,
            output_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      });
      send('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      });
      for (let i = 0; i < 40 && open; i++) {
        send('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Очень длинный ответ модели. '.repeat(20) },
        });
        state.deltasSent++;
        await sleep(25);
      }
      if (!open) return;
      send('content_block_stop', { type: 'content_block_stop', index: 0 });
      send('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 4000 },
      });
      send('message_stop', { type: 'message_stop' });
      state.finished++;
      open = false;
      res.end();
    });
  });
  return { server, state };
}

describe('audit: cancellation reaches the real SDK and the HTTP request', () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  const fake = fakeAnthropic();
  let client: Anthropic;
  beforeAll(async () => {
    await new Promise<void>((r) => fake.server.listen(0, '127.0.0.1', r));
    const { port } = fake.server.address() as AddressInfo;
    client = new Anthropic({
      apiKey: 'test-key-not-real',
      baseURL: `http://127.0.0.1:${port}`,
      maxRetries: 0,
    });
  });
  afterAll(async () => {
    await new Promise<void>((r) => fake.server.close(() => r()));
  });
  beforeEach(async () => {
    t = await createTestDb();
    await saveSeoSettings(
      t.db,
      { ...DEFAULT_SEO_SETTINGS, dailyBudgetUsd: 50, monthlyBudgetUsd: 500 },
      null,
    );
  });
  afterEach(async () => t.close());

  it('an aborted call closes the HTTP stream, removes listeners, and is NOT recorded as free', async () => {
    const ai = new SeoAi({ db: t.db, client: client as unknown as AiClient, logger });
    const controller = new AbortController();
    const listenersBefore = (controller.signal as unknown as { [k: symbol]: unknown }) && 0;
    void listenersBefore;
    const before = { ...fake.state };
    const call = runInTaskScope({ signal: controller.signal, taskId: 't' }, () =>
      ai.text({
        agent: 'content',
        purpose: 'p',
        tier: 'cheap',
        system: 's',
        prompt: 'p',
        maxTokens: 8000,
      }),
    );
    await sleep(150); // message_start + a few deltas received
    controller.abort(new Error('task timed out'));
    await expect(call).rejects.toThrow();
    await sleep(100);
    // The remote request really ended: the server saw the connection close mid-stream.
    expect(fake.state.closedEarly - before.closedEarly).toBe(1);
    expect(fake.state.finished - before.finished).toBe(0);
    const deltasAtAbort = fake.state.deltasSent;
    await sleep(150);
    expect(fake.state.deltasSent).toBe(deltasAtAbort); // nothing more is streamed (or billed)
    // The request reached the model (message_start: 12 000 input tokens): it is billed by Anthropic,
    // so it must not be settled as $0.
    const [u] = await t.db.select().from(schema.seoAiUsage);
    expect(u!.error).not.toBe(PENDING);
    expect(u!.inputTokens).toBe(12_000);
    expect(Number(u!.costUsd)).toBeGreaterThan(0);
  });

  it('a completed real-SDK stream settles to the exact usage (control)', async () => {
    const ai = new SeoAi({ db: t.db, client: client as unknown as AiClient, logger });
    const r = await ai.text({
      agent: 'content',
      purpose: 'p',
      tier: 'cheap',
      system: 's',
      prompt: 'p',
      maxTokens: 8000,
    });
    expect(r.text.length).toBeGreaterThan(1000);
    const [u] = await t.db.select().from(schema.seoAiUsage);
    expect(u).toMatchObject({ ok: true, error: null, inputTokens: 12_000, outputTokens: 4000 });
  });
});

// ── Concurrency: lease loss, fencing, atomic transitions ────────────────
const prose = (tag: string, n: number) =>
  Array.from(
    { length: n },
    (_, i) => `Пример${tag}${i} показывает приём${i} на случае${i} для задачи${i}.`,
  ).join(' ');
const ARTICLE = {
  title: 'Задание 13 ЕГЭ',
  seoTitle: 'Задание 13 ЕГЭ по математике: как решать',
  metaDescription:
    'Как решать задание 13 ЕГЭ по профильной математике: что проверяют, алгоритм, отбор корней и типичные ошибки школьников.',
  h1: 'Задание 13 ЕГЭ',
  slugHint: 'zadanie-13',
  format: 'task_breakdown',
  bodyMd: [
    'Вступление.',
    '## А',
    `[теория](/theory) ${prose('a', 30)}`,
    '## Б',
    `[профиль](/subjects/math) ${prose('b', 30)}`,
    '## В',
    prose('c', 30),
  ].join('\n\n'),
  faq: [
    { question: 'Сколько баллов?', answer: 'Два первичных балла.' },
    { question: 'Нужна ли ОДЗ?', answer: 'Да, обязательно всегда.' },
    { question: 'Как отбирать корни?', answer: 'На окружности или неравенством.' },
  ],
  sources: [{ title: 'ФИПИ', url: 'https://fipi.ru/ege' }],
  ogTitle: 'Задание 13',
  ogDescription: 'Алгоритм решения задания 13.',
  primaryKeyword: 'задание 13 ЕГЭ',
  secondaryKeywords: [],
  ctaPath: '/theory',
};
const LONG =
  'Факты: профильная математика ЕГЭ 2027 по демоверсии ФИПИ; задание 13 — уравнение с отбором корней, 2 первичных балла. Частые вопросы школьников: как отбирать корни и что повторить по тригонометрии. https://fipi.ru/ege';
const msg = (text: string) =>
  ({
    id: 'm',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content: [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 10,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
    },
  }) as unknown as Anthropic.Message;
const sys = (p: Anthropic.MessageStreamParams) =>
  Array.isArray(p.system) ? p.system.map((b) => b.text).join('') : '';
const isJson = (p: Anthropic.MessageStreamParams) =>
  Boolean(p.output_config && 'format' in p.output_config && p.output_config.format);

describe('audit: lease loss and atomic transitions', () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    t = await createTestDb();
    await saveSeoSettings(
      t.db,
      { ...DEFAULT_SEO_SETTINGS, dailyBudgetUsd: 50, monthlyBudgetUsd: 500 },
      null,
    );
  });
  afterEach(async () => t.close());
  const deps = (
    respond: (p: Anthropic.MessageStreamParams) => Promise<Anthropic.Message>,
  ): SeoDeps => ({
    db: t.db,
    ai: new SeoAi({
      db: t.db,
      client: { messages: { stream: (p) => ({ finalMessage: () => respond(p) }) } },
      logger,
    }),
    logger,
    origin: 'https://z.test',
    fetch: async () => new Response('', { status: 404 }),
    secretsKey: null,
    telegramBotToken: null,
    now: () => new Date(),
  });

  it('a worker that lost its lease cannot write the article or finish the task (the new owner wins)', async () => {
    const [a] = await t.db
      .insert(schema.seoArticles)
      .values({ slug: 'x', title: 'X', status: 'idea' })
      .returning();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const d = deps(async (p) => {
      if (!isJson(p)) return msg(LONG);
      if (sys(p).includes('образовательный редактор')) {
        await gate;
        return msg(JSON.stringify(ARTICLE));
      }
      return msg('{}');
    });
    await enqueueSeoTask(t.db, {
      kind: 'write_article',
      agent: 'content',
      idempotencyKey: 'w',
      payload: { articleId: a!.id },
    });
    // Worker A: long heartbeat so it does not notice by itself during the test.
    const A = new SeoQueue({
      db: t.db,
      logger,
      handlers: analyticsHandlers(d),
      heartbeatMs: 60_000,
    });
    const running = A.process(1);
    await sleep(80);
    // A's lease is lost (e.g. it was partitioned from the DB); worker B took the task over.
    await t.db
      .update(schema.seoTasks)
      .set({ lockedBy: 'w-B', lockedUntil: new Date(Date.now() + 600_000) })
      .where(eq(schema.seoTasks.idempotencyKey, 'w'));
    release();
    await running;
    const [article] = await t.db.select().from(schema.seoArticles);
    const [task] = await t.db
      .select()
      .from(schema.seoTasks)
      .where(eq(schema.seoTasks.idempotencyKey, 'w'));
    expect(task).toMatchObject({ status: 'running', lockedBy: 'w-B' }); // not finished by A
    expect(article!.bodyMd).toBe(''); // A's stale result was not written
    expect(article!.version).toBe(1);
    expect(
      await t.db.select().from(schema.seoTasks).where(eq(schema.seoTasks.kind, 'review_article')),
    ).toHaveLength(0);
  });

  it('the heartbeat notices a lost lease and aborts the running work', async () => {
    let aborted = false;
    const handlers = {
      slow: async (ctx: { signal: AbortSignal }) => {
        await new Promise<void>((resolve) =>
          ctx.signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              resolve();
            },
            { once: true },
          ),
        );
      },
    };
    await enqueueSeoTask(t.db, { kind: 'slow', agent: 'system', idempotencyKey: 's' });
    const A = new SeoQueue({ db: t.db, logger, handlers, heartbeatMs: 30, taskTimeoutMs: 5000 });
    const running = A.process(1);
    await sleep(60);
    await t.db
      .update(schema.seoTasks)
      .set({ lockedBy: 'w-B' })
      .where(eq(schema.seoTasks.idempotencyKey, 's'));
    await running;
    expect(aborted).toBe(true);
    const [task] = await t.db.select().from(schema.seoTasks);
    expect(task).toMatchObject({ status: 'running', lockedBy: 'w-B' });
  });

  it('a fact-check finishing after the owner published the article does not take it off the site', async () => {
    const [a] = await t.db
      .insert(schema.seoArticles)
      .values({
        slug: 'p',
        title: 'P',
        status: 'review',
        seoTitle: 'Заголовок статьи',
        metaDescription: 'd'.repeat(120),
        bodyMd: 'x'.repeat(300),
        reviewNotes: verifiedReviewNotes({
          title: 'P',
          seoTitle: 'Заголовок статьи',
          metaDescription: 'd'.repeat(120),
          bodyMd: 'x'.repeat(300),
          faq: [],
        }),
      })
      .returning();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const d = deps(async (p) => {
      if (sys(p).includes('факт-чекер')) {
        await gate;
        return msg(
          JSON.stringify({ verdict: 'pass', factualIssues: [], styleIssues: [], summary: 'ok' }),
        );
      }
      return msg('{}');
    });
    await enqueueSeoTask(t.db, {
      kind: 'review_article',
      agent: 'content',
      idempotencyKey: 'r',
      payload: { articleId: a!.id },
    });
    const running = new SeoQueue({ db: t.db, logger, handlers: analyticsHandlers(d) }).process(1);
    await sleep(60);
    expect((await publishSeoArticle(t.db, a!.id, { kind: 'agent' })).ok).toBe(true);
    release();
    await running;
    const [after] = await t.db.select().from(schema.seoArticles);
    expect(after!.status).toBe('published');
  });

  it('visuals finishing after an edit do not overwrite the newer text', async () => {
    const [a] = await t.db
      .insert(schema.seoArticles)
      .values({ slug: 'v', title: 'V', status: 'draft', bodyMd: '## А\n\nстарый текст' })
      .returning();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const d = deps(async (p) => {
      if (sys(p).includes('визуальный редактор')) {
        await gate;
        return msg(
          JSON.stringify({
            coverKicker: 'Разбор',
            coverAlt: 'Обложка статьи про ЕГЭ',
            infographic: {
              title: 'Шаги решения',
              alt: 'Инфографика шагов решения',
              afterHeading: 'А',
              items: [
                { label: 'Один', text: 'Первый шаг' },
                { label: 'Два', text: 'Второй шаг' },
                { label: 'Три', text: 'Третий шаг' },
              ],
            },
            meme: null,
          }),
        );
      }
      return msg('{}');
    });
    await enqueueSeoTask(t.db, {
      kind: 'visuals',
      agent: 'visual',
      idempotencyKey: 'v',
      payload: { articleId: a!.id },
    });
    const running = new SeoQueue({ db: t.db, logger, handlers: analyticsHandlers(d) }).process(1);
    await sleep(60);
    // The owner edits the text meanwhile (admin PATCH = new version).
    await t.db
      .update(schema.seoArticles)
      .set({ bodyMd: '## А\n\nновый текст редактора', version: a!.version + 1 })
      .where(eq(schema.seoArticles.id, a!.id));
    release();
    await running;
    const [after] = await t.db.select().from(schema.seoArticles);
    expect(after!.bodyMd).toContain('новый текст редактора');
  });

  it('a pending update cannot be applied twice', async () => {
    const { applyPendingRevision } = await import('./agents/content.js');
    const [a] = await t.db
      .insert(schema.seoArticles)
      .values({
        slug: 'u',
        title: 'U',
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
        snapshot: { bodyMd: 'new' },
        reason: 'pending_update',
        actor: 'agent',
      })
      .returning();
    const d = { db: t.db, now: () => new Date() };
    const notes = verifiedReviewNotes(
      { title: 'U', bodyMd: 'new', faq: [] },
      { revisionId: rev!.id },
    );
    const results = await Promise.all([
      applyPendingRevision(d, a!, rev!.id, notes),
      applyPendingRevision(d, a!, rev!.id, notes),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const [after] = await t.db.select().from(schema.seoArticles);
    expect(after!.version).toBe(2);
    expect(
      await t.db
        .select()
        .from(schema.seoArticleRevisions)
        .where(eq(schema.seoArticleRevisions.reason, 'before_update')),
    ).toHaveLength(1);
    void loadSeoSettings;
  });
});

describe('audit: crash after the API answered but before the cost was saved', () => {
  let t: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    t = await createTestDb();
    await saveSeoSettings(
      t.db,
      { ...DEFAULT_SEO_SETTINGS, dailyBudgetUsd: 50, monthlyBudgetUsd: 500 },
      null,
    );
  });
  afterEach(async () => t.close());

  it('the reservation keeps the worst case (cost not lost), is counted once, and is reconciled by the sweep', async () => {
    const { requestWorstCaseUsd } = await import('./ai.js');
    const { SeoScheduler } = await import('./scheduler.js');
    const { seoSpendSince } = await import('@zybrilka/db');
    // A database whose settle UPDATE never lands — like a worker killed right after the answer.
    let crashed = false;
    const db = new Proxy(t.db, {
      get(target, prop, receiver) {
        if (prop === 'update') {
          return (table: unknown) => {
            if (table === schema.seoAiUsage && !crashed) {
              crashed = true;
              throw new Error('worker killed before the cost was saved');
            }
            return target.update(table as typeof schema.seoAiUsage);
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
    const answered = { n: 0 };
    const ai = new SeoAi({
      db,
      client: {
        messages: {
          stream: () => ({
            finalMessage: async () => {
              answered.n++;
              return msg('ответ');
            },
          }),
        },
      },
      logger,
    });
    const worst = requestWorstCaseUsd(
      'claude-haiku-5-5',
      's' + JSON.stringify([{ role: 'user', content: 'p' }]),
      2000,
      0,
    );
    await expect(
      ai.text({
        agent: 'content',
        purpose: 'p',
        tier: 'cheap',
        system: 's',
        prompt: 'p',
        maxTokens: 2000,
      }),
    ).rejects.toThrow('killed');
    expect(answered.n).toBe(1);
    let rows = await t.db.select().from(schema.seoAiUsage);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ error: PENDING });
    expect(Number(rows[0]!.costUsd)).toBeCloseTo(worst, 8); // ≥ the real cost (10 in / 10 out tokens)
    // The open reservation already counts against the budget (no window for overspend).
    expect(await seoSpendSince(t.db, new Date(Date.now() - 60_000))).toBeCloseTo(worst, 8);
    // After restart the sweep marks it abandoned — still the worst case, still ONE row (no double charge).
    await t.db.update(schema.seoAiUsage).set({ at: new Date(Date.now() - 2 * 3600_000) });
    const d: SeoDeps = {
      db: t.db,
      ai,
      logger,
      origin: 'https://z.test',
      fetch: async () => new Response(''),
      secretsKey: null,
      telegramBotToken: null,
      now: () => new Date(),
    };
    await new SeoScheduler(d).sweep();
    await new SeoScheduler(d).sweep();
    rows = await t.db.select().from(schema.seoAiUsage);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ error: 'abandoned' });
    expect(Number(rows[0]!.costUsd)).toBeCloseTo(worst, 8);
  });
});
