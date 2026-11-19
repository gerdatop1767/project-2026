import type Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_SEO_SETTINGS } from '@zybrilka/shared';
import {
  encryptSecret,
  enqueueSeoTask,
  loadSeoSettings,
  saveSeoSettings,
  schema,
} from '@zybrilka/db';
import { createTestDb } from '@zybrilka/db/testing';
import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AiBlocked, SeoAi, type AiClient } from './ai.js';
import { adjustWeights } from './agents/strategy.js';
import { pageIssues, parsePage } from './agents/technical.js';
import { coverSvg, insertImage, wrap } from './agents/visual.js';
import type { HttpFetch, SeoDeps } from './deps.js';
import { SeoQueue } from './queue.js';
import { isoWeek, SeoScheduler } from './scheduler.js';

const logger = pino({ enabled: false });
const ORIGIN = 'https://zybrilka.test';
const KEY = Buffer.alloc(32, 3);

function message(text: string, extra: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 },
    },
    ...extra,
  } as unknown as Anthropic.Message;
}

/** Fake model: answers by what the request asks for (system/prompt markers). */
function fakeClient(
  respond: (p: Anthropic.MessageStreamParams) => Anthropic.Message,
  calls: Anthropic.MessageStreamParams[] = [],
): AiClient {
  return {
    messages: {
      stream: (params) => {
        calls.push(params);
        return { finalMessage: async () => respond(params) };
      },
    },
  };
}

const promptOf = (p: Anthropic.MessageStreamParams) => String(p.messages[0]!.content);
const systemOf = (p: Anthropic.MessageStreamParams) =>
  Array.isArray(p.system) ? p.system.map((s) => s.text).join('') : String(p.system ?? '');

/** Varied filler: every 3-word phrase is unique (a realistic text has no stuffing). */
const prose = (tag: string, n: number) =>
  Array.from(
    { length: n },
    (_, i) => `Пример${tag}${i} показывает приём${i} на случае${i} для задачи${i}.`,
  ).join(' ');

const BODY = [
  'Задание 13 — первое задание второй части профильного ЕГЭ по математике. Это вступление с основным запросом «задание 13 ЕГЭ».',
  '## Что проверяют',
  'Умение решать тригонометрические уравнения и отбирать корни. Подробнее — в [теории](/theory). ' +
    prose('a', 30),
  '## Алгоритм решения',
  '1. Найти ОДЗ.\n2. Решить уравнение.\n3. Отобрать корни.',
  'Тренируйся в разделе [профильной математики](/subjects/math). ' + prose('b', 30),
  '## Типичные ошибки',
  '> [!mistake] Забывают про отбор корней.',
  'Подробности на [ФИПИ](https://fipi.ru/ege). ' + prose('c', 30),
  '## Как тренироваться',
  'Решай по одному заданию в день в [тренировке](/training).',
].join('\n\n');

const ARTICLE = {
  title: 'Задание 13 ЕГЭ по математике: как решать',
  seoTitle: 'Задание 13 ЕГЭ по математике: как решать уравнения',
  metaDescription:
    'Как решать задание 13 ЕГЭ по профильной математике: что проверяют, пошаговый алгоритм, отбор корней и типичные ошибки школьников.',
  h1: 'Задание 13 ЕГЭ: как решать',
  slugHint: 'zadanie-13-ege-matematika',
  format: 'task_breakdown',
  bodyMd: BODY,
  faq: [
    {
      question: 'Сколько баллов за задание 13?',
      answer: 'Задание 13 оценивается в 2 первичных балла.',
    },
    { question: 'Нужна ли ОДЗ в задании 13?', answer: 'Да, без неё легко получить лишние корни.' },
    {
      question: 'Как отбирать корни?',
      answer: 'С помощью тригонометрической окружности или неравенства.',
    },
  ],
  sources: [{ title: 'ФИПИ — демоверсия', url: 'https://fipi.ru/ege' }],
  ogTitle: 'Задание 13 ЕГЭ: как решать',
  ogDescription: 'Алгоритм решения задания 13 и типичные ошибки.',
  primaryKeyword: 'задание 13 ЕГЭ',
  secondaryKeywords: ['13 задание профиль'],
  ctaPath: '/subjects/math',
};

const factors = {
  demand: 9,
  competition: 3,
  seasonality: 7,
  freshness: 6,
  fit: 10,
  conversion: 8,
  rankChance: 7,
};

function pipelineModel(p: Anthropic.MessageStreamParams): Anthropic.Message {
  const prompt = promptOf(p);
  const system = systemOf(p);
  const structured = Boolean(
    p.output_config && 'format' in p.output_config && p.output_config.format,
  );
  if (!structured)
    return message(
      'Заметки исследования: задание 13 профильной математики (тригонометрические уравнения, отбор корней), по демоверсии ФИПИ 2027 — без изменений относительно 2026. Частые вопросы школьников: как отбирать корни, сколько баллов. https://fipi.ru/ege',
    );
  if (system.includes('SEO-исследователь')) {
    return message(
      JSON.stringify({
        topics: [
          {
            title: 'Задание 13 ЕГЭ по математике: как решать',
            angle: 'Пошаговый алгоритм с отбором корней',
            format: 'task_breakdown',
            subjectId: 'math',
            primaryKeyword: 'задание 13 ЕГЭ',
            keywords: ['13 задание профиль'],
            intent: 'informational',
            factors,
            reasoning: 'Высокий спрос в сезон подготовки, у конкурентов мало пошаговых разборов.',
          },
        ],
      }),
    );
  }
  if (system.includes('образовательный редактор')) return message(JSON.stringify(ARTICLE));
  if (system.includes('факт-чекер'))
    return message(
      JSON.stringify({
        verdict: 'pass',
        factualIssues: [],
        styleIssues: [],
        summary: 'Факты подтверждены.',
      }),
    );
  if (system.includes('визуальный редактор')) {
    return message(
      JSON.stringify({
        coverKicker: 'Разбор задания',
        coverAlt: 'Обложка: задание 13 ЕГЭ по математике',
        infographic: {
          title: 'Алгоритм задания 13',
          alt: 'Инфографика: три шага решения задания 13',
          afterHeading: 'Алгоритм решения',
          items: [
            { label: 'ОДЗ', text: 'Найти область допустимых значений' },
            { label: 'Решение', text: 'Решить уравнение' },
            { label: 'Отбор', text: 'Отобрать корни на отрезке' },
          ],
        },
        meme: null,
      }),
    );
  }
  if (system.includes('адаптируешь материалы')) {
    const link = /Ссылка для поста \(вставь ровно одну, как есть\): (\S+)/.exec(prompt)![1]!;
    const platform = /Площадка: (.+)/.exec(prompt)![1]!;
    return message(
      JSON.stringify({
        title: null,
        body: `${platform}: короткий уникальный пост ${platform.length} про задание 13 — ОДЗ, решение, отбор корней. ${'Совет для ' + platform + '. '.repeat(3)} ${link}`,
        checklist: ['Проверить правила площадки', 'Одна ссылка'],
      }),
    );
  }
  throw new Error(`unexpected structured call: ${system.slice(0, 60)}`);
}

describe('SEO agent (worker)', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  beforeEach(async () => {
    testDb = await createTestDb();
  });
  afterEach(async () => {
    await testDb.close();
  });

  const deps = (
    client: AiClient | null,
    fetch: HttpFetch = async () => new Response('', { status: 404 }),
  ): SeoDeps => ({
    db: testDb.db,
    ai: new SeoAi({ db: testDb.db, client, logger }),
    logger,
    origin: ORIGIN,
    fetch,
    secretsKey: KEY,
    telegramBotToken: '123:abc',
    now: () => new Date(),
  });

  it('AI gateway refuses a call that does not fit the budget — before calling the model', async () => {
    await saveSeoSettings(testDb.db, { ...DEFAULT_SEO_SETTINGS, dailyBudgetUsd: 0.01 }, null);
    const calls: Anthropic.MessageStreamParams[] = [];
    const ai = new SeoAi({ db: testDb.db, client: fakeClient(() => message('x'), calls), logger });
    await expect(
      ai.text({
        agent: 'content',
        purpose: 't',
        tier: 'strong',
        system: 's',
        prompt: 'p',
        maxTokens: 8000,
      }),
    ).rejects.toThrow(AiBlocked);
    expect(calls).toHaveLength(0);
    await saveSeoSettings(testDb.db, { ...DEFAULT_SEO_SETTINGS, emergencyStop: true }, null);
    await expect(
      ai.text({
        agent: 'content',
        purpose: 't',
        tier: 'cheap',
        system: 's',
        prompt: 'p',
        maxTokens: 100,
      }),
    ).rejects.toMatchObject({ reason: 'emergency_stop' });
  });

  it('AI gateway records exact usage and resumes pause_turn', async () => {
    let n = 0;
    const ai = new SeoAi({
      db: testDb.db,
      client: fakeClient(() =>
        n++ === 0 ? message('часть 1 ', { stop_reason: 'pause_turn' }) : message('часть 2'),
      ),
      logger,
    });
    const r = await ai.text({
      agent: 'research',
      purpose: 'test',
      tier: 'strong',
      system: 's',
      prompt: 'p',
      maxTokens: 1000,
      webSearch: { maxUses: 2 },
    });
    expect(r.text).toBe('часть 1 часть 2');
    // One row per API request (the continuation is its own request, reserved and settled).
    const usage = await testDb.db.select().from(schema.seoAiUsage);
    expect(usage).toHaveLength(2);
    for (const u of usage) {
      expect(u).toMatchObject({
        model: 'claude-opus-5-5',
        inputTokens: 1000,
        outputTokens: 500,
        webSearches: 1,
        ok: true,
        error: null,
      });
    }
    // per request: 1000 in × $4/M + 500 out × $20/M + 1 search × $0.01
    const total = usage.reduce((a, u) => a + Number(u.costUsd), 0);
    expect(total).toBeCloseTo(2 * (0.004 + 0.01 + 0.01), 5);
  });

  it('queue: idempotent keys, retries with backoff, lease recovery, budget parks without burning attempts', async () => {
    const { db } = testDb;
    expect(await enqueueSeoTask(db, { kind: 'flaky', agent: 'system', idempotencyKey: 'k1' })).toBe(
      true,
    );
    expect(await enqueueSeoTask(db, { kind: 'flaky', agent: 'system', idempotencyKey: 'k1' })).toBe(
      false,
    );
    let runs = 0;
    const queue = new SeoQueue({
      db,
      logger,
      handlers: {
        flaky: async () => {
          runs++;
          throw new Error('boom');
        },
        broke: async () => {
          throw new AiBlocked('budget_monthly');
        },
      },
    });
    await queue.process(5);
    let [t] = await db
      .select()
      .from(schema.seoTasks)
      .where(eq(schema.seoTasks.idempotencyKey, 'k1'));
    expect(t).toMatchObject({ status: 'queued', attempts: 1, error: 'boom' });
    expect(t!.runAfter.getTime()).toBeGreaterThan(Date.now() + 50_000);
    await db
      .update(schema.seoTasks)
      .set({ runAfter: new Date(0) })
      .where(eq(schema.seoTasks.id, t!.id));
    await queue.process(1);
    await db
      .update(schema.seoTasks)
      .set({ runAfter: new Date(0) })
      .where(eq(schema.seoTasks.id, t!.id));
    await queue.process(1);
    [t] = await db.select().from(schema.seoTasks).where(eq(schema.seoTasks.id, t!.id));
    expect(t).toMatchObject({ status: 'failed', attempts: 3 });
    expect(runs).toBe(3);

    await enqueueSeoTask(db, { kind: 'broke', agent: 'system', idempotencyKey: 'k2' });
    await queue.process(1);
    const [b] = await db
      .select()
      .from(schema.seoTasks)
      .where(eq(schema.seoTasks.idempotencyKey, 'k2'));
    expect(b).toMatchObject({ status: 'blocked', error: 'budget_monthly', attempts: 0 });

    // A worker died mid-task: the expired lease returns it to the queue.
    await enqueueSeoTask(db, { kind: 'flaky', agent: 'system', idempotencyKey: 'k3' });
    await db
      .update(schema.seoTasks)
      .set({ status: 'running', lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(schema.seoTasks.idempotencyKey, 'k3'));
    expect(await queue.recoverExpired()).toBe(1);
  });

  it('full autonomous pipeline: research → write → fact-check → visuals → publish → check → Telegram', async () => {
    const { db } = testDb;
    await saveSeoSettings(
      db,
      {
        ...DEFAULT_SEO_SETTINGS,
        enabled: true,
        mode: 'auto',
        dailyRunTime: '00:00',
        publishTime: '00:00',
        dailyBudgetUsd: 50,
        monthlyBudgetUsd: 500,
      },
      null,
    );
    const fetched: string[] = [];
    const tgPosts: unknown[] = [];
    const fetch: HttpFetch = async (url, init) => {
      fetched.push(url);
      if (url.startsWith('https://api.telegram.org/')) {
        tgPosts.push(JSON.parse(String(init?.body)));
        return Response.json({
          ok: true,
          result: { message_id: 42, chat: { username: 'zybrilka' } },
        });
      }
      if (url === `${ORIGIN}/blog/sitemap.xml`) {
        const [a] = await db.select().from(schema.seoArticles);
        return new Response(`<urlset><url><loc>${ORIGIN}/blog/${a!.slug}</loc></url></urlset>`, {
          headers: { 'content-type': 'application/xml' },
        });
      }
      if (url.startsWith(`${ORIGIN}/blog/`)) {
        return new Response(
          `<html><head><title>T</title><meta name="description" content="${'d'.repeat(130)}"><meta name="viewport" content="x"><link rel="canonical" href="${url}"><script type="application/ld+json">{}</script></head><body><h1>H</h1></body></html>`,
          { headers: { 'content-type': 'text/html' } },
        );
      }
      if (url === 'https://yandex.com/indexnow') return new Response('', { status: 202 });
      return new Response('', { status: 404 });
    };
    await db.insert(schema.seoIntegrations).values([
      { kind: 'telegram_channel', config: { channelId: '@zybrilka' }, status: 'connected' },
      { kind: 'indexnow', config: { key: 'a'.repeat(32) }, status: 'connected' },
    ]);
    const d = deps(fakeClient(pipelineModel), fetch);
    const scheduler = new SeoScheduler(d);
    await scheduler.init();
    // Telegram first in the platform list; keep the test to API platforms.
    await db
      .update(schema.seoPlatforms)
      .set({ isActive: false })
      .where(eq(schema.seoPlatforms.mode, 'manual'));

    for (let i = 0; i < 12; i++) {
      await scheduler.tick();
      // run everything due, pushing scheduled times into the past
      await db
        .update(schema.seoTasks)
        .set({ runAfter: new Date(0) })
        .where(eq(schema.seoTasks.status, 'queued'));
      await db
        .update(schema.seoArticles)
        .set({ scheduledFor: new Date(0) })
        .where(eq(schema.seoArticles.status, 'scheduled'));
      await scheduler.queue.process(10);
    }

    const failed = await db
      .select()
      .from(schema.seoTasks)
      .where(eq(schema.seoTasks.status, 'failed'));
    expect(failed.map((f) => `${f.kind}: ${f.error}`)).toEqual([]);
    const [article] = await db.select().from(schema.seoArticles);
    expect(article).toMatchObject({
      status: 'published',
      factCheckPassed: true,
      primaryKeyword: 'задание 13 ЕГЭ',
    });
    expect(article!.slug).toBe('zadanie-13-ege-matematika');
    expect(article!.coverMediaId).toBeTruthy();
    expect(article!.bodyMd).toMatch(/!\[Инфографика: три шага решения задания 13\]\(media:/);
    expect(article!.lastCheck).toMatchObject({ status: 200, inSitemap: true, indexNow: '202' });
    const media = await db.select().from(schema.seoMedia);
    expect(media.map((m) => m.kind).sort()).toEqual(['cover', 'infographic']);
    expect(media.every((m) => m.alt.length > 5 && m.sizeBytes < 20_000)).toBe(true);

    const posts = await db.select().from(schema.seoExternalPosts);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      status: 'published',
      externalUrl: 'https://t.me/zybrilka/42',
    });
    expect(tgPosts).toHaveLength(1);
    expect(String((tgPosts[0] as { text: string }).text)).toContain(`${ORIGIN}/api/v1/go/`);

    // Every AI call accounted for; one article only (idempotent planning across 12 ticks).
    const usage = await db.select().from(schema.seoAiUsage);
    expect(usage.length).toBeGreaterThanOrEqual(6);
    expect(await db.select().from(schema.seoArticles)).toHaveLength(1);
    const log = await db.select().from(schema.seoAgentLog);
    expect(log.some((l) => l.action === 'article.published')).toBe(true);

    // Emergency stop: nothing more runs.
    await saveSeoSettings(db, { ...(await loadSeoSettings(db)), emergencyStop: true }, null);
    await enqueueSeoTask(db, { kind: 'research', agent: 'research', idempotencyKey: 'after-stop' });
    expect(await scheduler.queue.process(5)).toBe(0);
  });

  it('manual mode: drafts and reviews but never publishes', async () => {
    const { db } = testDb;
    await saveSeoSettings(
      db,
      {
        ...DEFAULT_SEO_SETTINGS,
        enabled: true,
        mode: 'manual',
        dailyRunTime: '00:00',
        dailyBudgetUsd: 50,
        monthlyBudgetUsd: 500,
      },
      null,
    );
    const scheduler = new SeoScheduler(deps(fakeClient(pipelineModel)));
    await scheduler.init();
    for (let i = 0; i < 8; i++) {
      await scheduler.tick();
      await db
        .update(schema.seoTasks)
        .set({ runAfter: new Date(0) })
        .where(eq(schema.seoTasks.status, 'queued'));
      await scheduler.queue.process(10);
    }
    const [article] = await db.select().from(schema.seoArticles);
    expect(article).toMatchObject({ status: 'review', factCheckPassed: true, publishedAt: null });
    expect(await db.select().from(schema.seoExternalPosts)).toHaveLength(0);
  });

  it('integration secrets decrypt only with the right key', async () => {
    const enc = encryptSecret(KEY, 'token');
    await testDb.db.insert(schema.seoIntegrations).values({
      kind: 'yandex_metrika',
      config: { counterId: 1 },
      secretEnc: enc,
      status: 'configured',
    });
    const { loadIntegration } = await import('@zybrilka/db');
    expect((await loadIntegration(testDb.db, KEY, 'yandex_metrika'))!.secret).toBe('token');
    expect(
      (await loadIntegration(testDb.db, Buffer.alloc(32, 1), 'yandex_metrika'))!.secret,
    ).toBeNull();
  });
});

describe('SEO agent pure parts', () => {
  it('technical rules flag real problems and pass a clean page', () => {
    const clean = parsePage(
      `${ORIGIN}/blog/a`,
      `<html><head><title>Нормальный заголовок</title><meta name="viewport" content="w"><meta name="description" content="${'x'.repeat(130)}"><link rel="canonical" href="${ORIGIN}/blog/a"><script type="application/ld+json">{}</script></head><body><h1>A</h1><img src="a.svg" alt="ok"></body></html>`,
      200,
      null,
      120,
    );
    expect(pageIssues(clean, ORIGIN, true)).toEqual([]);
    const bad = parsePage(
      `${ORIGIN}/x`,
      '<html><head><meta name="robots" content="noindex"></head><body><h1>1</h1><h1>2</h1><img src="b"></body></html>',
      200,
      null,
      100,
    );
    expect(pageIssues(bad, ORIGIN, true).map((i) => i.code)).toEqual(['noindex_in_sitemap']);
    const broken = parsePage(`${ORIGIN}/y`, '', 404, null, 50);
    expect(pageIssues(broken, ORIGIN, true)[0]).toMatchObject({
      code: 'http_404',
      severity: 'critical',
    });
    const noMeta = parsePage(
      `${ORIGIN}/z`,
      '<html><head><title>t</title></head><body><img src="c"></body></html>',
      200,
      null,
      3500,
    );
    expect(
      pageIssues(noMeta, ORIGIN, false)
        .map((i) => i.code)
        .sort(),
    ).toEqual(
      [
        'canonical_missing',
        'description_missing',
        'h1_missing',
        'img_no_alt',
        'jsonld_missing',
        'slow_response',
        'viewport_missing',
      ].sort(),
    );
  });

  it('learning: weights move toward factors that correlate with real scores, only with enough data', () => {
    const w = DEFAULT_SEO_SETTINGS.priorityWeights;
    expect(adjustWeights(w, [{ factors, score: 50 }]).changed).toBe(false);
    const samples = Array.from({ length: 10 }, (_, i) => ({
      factors: { ...factors, fit: i, demand: 5 + (i % 2) },
      score: i * 10,
    }));
    const r = adjustWeights(w, samples);
    expect(r.changed).toBe(true);
    expect(r.weights.fit).toBeGreaterThan(w.fit);
    expect(r.correlations.fit).toBeCloseTo(1, 2);
    expect(Object.values(r.weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
  });

  it('visuals: escaped SVG, wrapped titles, image inserted after its section', () => {
    const svg = coverSvg({
      title: 'Как <script> сдать ЕГЭ & не сойти с ума',
      kicker: 'Гайд',
      palette: 0,
    });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(wrap('один два три четыре пять шесть', 10, 2)).toEqual(['один два', 'три четыре…']);
    const md = insertImage(
      '## A\n\npara\n\n## B\n\ntext',
      'A',
      'alt',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(md).toBe(
      '## A\n\npara\n\n![alt](media:11111111-1111-4111-8111-111111111111)\n\n## B\n\ntext',
    );
  });

  it('iso week id', () => {
    expect(isoWeek(new Date('2026-11-19T10:00:00Z'))).toBe('2026-W47');
  });
});
