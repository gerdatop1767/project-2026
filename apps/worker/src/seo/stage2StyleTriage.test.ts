/**
 * Stage 2.1 review fixes, worker side: the model's own classification never
 * lets a factual statement through as «style». A style note blocks auto
 * mode unless a separate triage call AND the server's marker check both
 * clear it; a factual issue blocks auto mode whatever its category.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { enqueueSeoTask, readFactCheckRecord, saveSeoSettings, schema } from '@zybrilka/db';
import { createTestDb } from '@zybrilka/db/testing';
import { DEFAULT_SEO_SETTINGS } from '@zybrilka/shared';
import { eq } from 'drizzle-orm';
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
const json = (v: unknown) => msg([{ type: 'text', text: JSON.stringify(v), citations: null }]);
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

const CONTENT = {
  title: 'Задание 13',
  seoTitle: 'Задание 13 ЕГЭ',
  metaDescription: 'm'.repeat(120),
  bodyMd: 'Задание 13 оценивается в 2 первичных балла. '.repeat(10),
};
const STYLISTIC = 'Убрать лишнее слово «очень» в абзаце про подготовку';

describe('stage 2.1: style notes and factual issues in auto mode', () => {
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

  /** Review with `verdict`; the triage answers `triage` (an Error = the call fails). */
  const run = async (verdict: unknown, triage: unknown | Error) => {
    const calls: string[] = [];
    const d: SeoDeps = {
      db: t.db,
      ai: new SeoAi({
        db: t.db,
        client: {
          messages: {
            stream: (p) => ({
              finalMessage: async () => {
                if (!isJson(p)) return searched();
                if (sys(p).includes('замечания редактора')) {
                  calls.push('triage');
                  if (triage instanceof Error) throw triage;
                  return json(triage);
                }
                if (sys(p).includes('факт-чекер') || sys(p).includes('Сведи итог'))
                  return json(verdict);
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
    };
    const [a] = await t.db
      .insert(schema.seoArticles)
      .values({ slug: `s-${Math.random()}`, status: 'draft', ...CONTENT })
      .returning();
    await enqueueSeoTask(t.db, {
      kind: 'review_article',
      agent: 'content',
      idempotencyKey: `r-${a!.id}`,
      payload: { articleId: a!.id },
      maxAttempts: 1,
    });
    await new SeoQueue({ db: t.db, logger, handlers: analyticsHandlers(d) }).process(1);
    const [after] = await t.db
      .select()
      .from(schema.seoArticles)
      .where(eq(schema.seoArticles.id, a!.id));
    return { after: after!, record: readFactCheckRecord(after!.reviewNotes)!, calls };
  };
  const pass = (styleIssues: string[], factualIssues: unknown[] = []) => ({
    verdict: 'pass',
    factualIssues,
    styleIssues,
    summary: 'ok',
  });

  it('a truly stylistic note confirmed by the triage: scheduled', async () => {
    const { after, record, calls } = await run(pass([STYLISTIC]), {
      notes: [{ index: 0, kind: 'style_only' }],
    });
    expect(calls).toEqual(['triage']);
    expect(record.result).toBe('verified');
    expect(after.status).toBe('scheduled');
  });

  it.each([
    'ЕГЭ начинается на два дня раньше',
    'В варианте вдвое больше заданий',
    'Порог изменился',
    'Экзамен перенесли',
    'Критерии оценивания изменились',
  ])('«%s» filed as style, triage wrongly says style_only: not scheduled', async (note) => {
    const { after, record } = await run(pass([note]), {
      notes: [{ index: 0, kind: 'style_only' }],
    });
    expect(record.result).toBe('failed');
    expect(record.styleNotes[0]).toMatchObject({ safe: false, rule: 'style_fact_marker' });
    expect(after.status).toBe('review');
    expect(after.scheduledFor).toBeNull();
  });

  it.each([
    ['the triage is unsure', { notes: [{ index: 0, kind: 'unsure' }] }],
    ['the triage says it may change facts', { notes: [{ index: 0, kind: 'may_change_facts' }] }],
    ['the triage skips the note', { notes: [] }],
    ['the triage call fails', new Error('overloaded')],
  ])('a stylistic note when %s: not scheduled (fail-closed)', async (_, triage) => {
    const { after, record } = await run(pass([STYLISTIC]), triage);
    expect(record.result).toBe('failed');
    expect(record.styleNotes[0]).toMatchObject({ safe: false, rule: 'style_unconfirmed' });
    expect(after.status).toBe('review');
  });

  it.each([
    ['ЕГЭ начинается на два дня раньше', 'wording'],
    ['Критерии оценивания изменились', 'style'],
    ['«прорешивать» лучше заменить на «решать»', 'wording'],
  ])(
    'a factual issue «%s» labelled %s with verdict pass: not scheduled',
    async (claim, category) => {
      const { after, record, calls } = await run(
        pass(
          [],
          [
            {
              claim,
              problem: '',
              correction: '',
              category,
              severity: 'minor',
              status: 'unverified',
            },
          ],
        ),
        { notes: [] },
      );
      expect(calls).toEqual([]); // no triage: the check failed anyway
      expect(record.result).toBe('failed');
      expect(record.criticalContradictions).toEqual([]); // the owner may still approve manually
      expect(after.status).toBe('review');
    },
  );
});
