import { loadSeoSettings, schema } from '@zybrilka/db';
import {
  normalizeQuery,
  queryOverlap,
  SEO_ARTICLE_FORMATS,
  SEO_SEARCH_INTENTS,
  topicPriority,
} from '@zybrilka/shared';
import { and, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { OFFICIAL_SOURCES, PLATFORM_SUBJECTS, mskDate, type SeoDeps } from '../deps.js';
import type { TaskHandler } from '../queue.js';
import { rows } from '../sql.js';
import { MIN_RESEARCH_CHARS } from './content.js';

/**
 * SEO Research Agent: finds topics and queries (docs/SEO_CENTER.md §5).
 * Step 1 (strong model + web search): what students search and discuss now,
 * EGE changes, seasonal topics, gaps. Step 2 (cheap model, structured):
 * turn the notes into topics with 7 priority factors and keywords.
 * Then code de-duplicates against existing topics/articles and computes
 * the priority with the CURRENT learned weights.
 */

const factor = z.number().min(0).max(10);
export const researchOutputSchema = z.object({
  topics: z
    .array(
      z.object({
        title: z.string().min(10).max(200),
        angle: z.string().min(10).max(600),
        format: z.enum(SEO_ARTICLE_FORMATS),
        subjectId: z.enum(['math', 'russian', 'general']),
        primaryKeyword: z.string().min(3).max(150),
        keywords: z.array(z.string().min(3).max(150)).max(12),
        intent: z.enum(SEO_SEARCH_INTENTS),
        factors: z.object({
          demand: factor,
          competition: factor,
          seasonality: factor,
          freshness: factor,
          fit: factor,
          conversion: factor,
          rankChance: factor,
        }),
        reasoning: z.string().min(20).max(1200),
      }),
    )
    .max(25),
});

const SYSTEM = `Ты — SEO-исследователь бесплатного тренажёра ЕГЭ «Зубрилка» (zybrilka.ru).
На сайте есть задания с проверкой и разбором только по предметам: ${Object.values(PLATFORM_SUBJECTS).join(', ')}; плюс теория, полезные материалы, мини-игра на ударения.
Аудитория — школьники 10–11 классов и их родители, Россия, поиск Яндекс и Google.
Правила:
- опирайся на найденные источники, а не на память; про изменения ЕГЭ и даты — только с официальных сайтов (${OFFICIAL_SOURCES.join(', ')});
- не выдумывай частотность запросов: если цифр нет, оценивай спрос качественно;
- предлагай темы, по которым Зубрилка может дать ответ лучше конкурентов, а не копировать их;
- не предлагай темы про «слив ответов», покупку ответов и обман на экзамене.`;

export function researchHandler(deps: SeoDeps): TaskHandler {
  return async (ctx) => {
    const { db, ai } = deps;
    const settings = await loadSeoSettings(db);
    const today = mskDate(deps.now());

    // What we already have and what worked — the agent reads its knowledge base first.
    const existingTopics = await db
      .select({ title: schema.seoTopics.title, status: schema.seoTopics.status })
      .from(schema.seoTopics)
      .orderBy(desc(schema.seoTopics.createdAt))
      .limit(120);
    const insights = await db
      .select()
      .from(schema.seoInsights)
      .where(eq(schema.seoInsights.windowDays, 28))
      .limit(40);
    const uncovered = await db
      .select({ query: schema.seoKeywords.query, frequency: schema.seoKeywords.frequency })
      .from(schema.seoKeywords)
      .where(sql`${schema.seoKeywords.articleId} IS NULL`)
      .orderBy(sql`${schema.seoKeywords.frequency} DESC NULLS LAST`)
      .limit(40);
    const searchGaps = await rows<{ query: string; impressions: number; position: number | null }>(
      db,
      sql`SELECT query, sum(impressions)::int AS impressions,
            (sum((position)::text::float8 * impressions) / nullif(sum(impressions), 0))::float8 AS position
          FROM seo_search_metrics WHERE query <> '' AND date >= current_date - 28
          GROUP BY query HAVING sum(impressions) >= 20 ORDER BY sum(impressions) DESC LIMIT 40`,
    );

    const subjects = settings.prioritySubjects.filter((s) => s in PLATFORM_SUBJECTS);
    const notes = await ai.cached(
      'research',
      { today, subjects },
      20,
      async () => {
        const r = await ai.text({
          agent: 'research',
          purpose: 'research.web',
          taskId: ctx.task.id,
          tier: 'strong',
          system: SYSTEM,
          effort: 'medium',
          maxTokens: 12_000,
          webSearch: { maxUses: settings.maxSearchesPerResearch },
          prompt: `Сегодня ${today}. Исследуй поисковый спрос и обсуждения вокруг ЕГЭ для предметов: ${subjects.map((s) => PLATFORM_SUBJECTS[s]).join(', ')} и общих тем подготовки.
Найди:
1) актуальные изменения ЕГЭ 2026/2027 (только официальные источники) и ближайшие даты;
2) сезонные темы на ближайшие 4–8 недель;
3) частые вопросы школьников (форумы, ответы, соцсети) по номерам заданий;
4) информационные запросы с потенциалом и слабой конкуренцией;
5) что публикуют конкуренты (Решу ЕГЭ, Фоксфорд, Умскул, Сотка, Максимум) и какие темы раскрыты слабо.
Ответь заметками: тема — почему важна — какие запросы — какие источники. Без вступлений.`,
        });
        return { text: r.text, sources: r.sources.slice(0, 40) };
      },
      (v) => v.text.trim().length >= MIN_RESEARCH_CHARS,
    );

    const { data } = await ai.json(
      {
        agent: 'research',
        purpose: 'research.structure',
        taskId: ctx.task.id,
        tier: 'cheap',
        system: SYSTEM,
        effort: 'low',
        maxTokens: 8000,
        prompt: `Заметки исследования:
${notes.text.slice(0, 30_000)}

Ключевые запросы без статей (из семантического ядра, частотность только если известна):
${uncovered.map((k) => `- ${k.query}${k.frequency ? ` (${k.frequency}/мес)` : ''}`).join('\n') || '—'}

Запросы, по которым сайт уже показывается в поиске (за 28 дней):
${searchGaps.map((g) => `- ${g.query}: показов ${g.impressions}, позиция ${g.position?.toFixed(1) ?? '—'}`).join('\n') || '— (данных поиска пока нет)'}

Что работало у нас (база знаний):
${insights.map((i) => `- ${i.dimension}=${i.value}: ${JSON.stringify(i.metrics)} (n=${i.sampleSize})`).join('\n') || '— (статистики пока нет)'}

Уже есть темы (не повторяй их):
${existingTopics.map((t) => `- ${t.title}`).join('\n') || '—'}

Предложи до 15 НОВЫХ тем статей для блога Зубрилки. subjectId только math, russian или general. Оцени 7 факторов от 0 до 10 (competition: 10 = очень высокая конкуренция). В reasoning — на чём основана оценка.`,
      },
      researchOutputSchema,
    );

    let added = 0;
    let duplicates = 0;
    const existing = await db
      .select({
        id: schema.seoTopics.id,
        title: schema.seoTopics.title,
        kw: schema.seoTopics.primaryKeyword,
        articleId: schema.seoTopics.articleId,
      })
      .from(schema.seoTopics);
    const articles = await db
      .select({
        id: schema.seoArticles.id,
        title: schema.seoArticles.title,
        kw: schema.seoArticles.primaryKeyword,
      })
      .from(schema.seoArticles);

    for (const t of data.topics) {
      const normalized = normalizeQuery(t.title);
      const dup =
        existing.find(
          (e) =>
            queryOverlap(e.kw ?? e.title, t.primaryKeyword) >= 0.75 ||
            queryOverlap(e.title, t.title) >= 0.8,
        ) ?? articles.find((a) => queryOverlap(a.kw ?? a.title, t.primaryKeyword) >= 0.75);
      const priority = topicPriority(t.factors, settings.priorityWeights);
      const inserted = await db
        .insert(schema.seoTopics)
        .values({
          title: t.title,
          normalized,
          angle: t.angle,
          format: t.format,
          subjectId: t.subjectId === 'general' ? null : t.subjectId,
          primaryKeyword: t.primaryKeyword,
          keywords: t.keywords,
          factors: t.factors,
          reasoning: t.reasoning,
          priority,
          status: dup ? 'duplicate' : 'new',
          duplicateOf: dup?.id ?? null,
          source: 'research',
        })
        .onConflictDoNothing()
        .returning({ id: schema.seoTopics.id });
      if (!inserted.length) continue;
      if (dup) duplicates++;
      else added++;
      // Semantic core: every keyword once (normalized UNIQUE), AI demand estimate kept apart from real frequency.
      for (const q of [t.primaryKeyword, ...t.keywords]) {
        await db
          .insert(schema.seoKeywords)
          .values({
            query: q,
            normalized: normalizeQuery(q),
            subjectId: t.subjectId === 'general' ? null : t.subjectId,
            intent: t.intent,
            demandEstimate: Math.round(t.factors.demand),
            competition: Math.round(t.factors.competition),
            source: 'research',
          })
          .onConflictDoNothing();
      }
    }
    await ctx.log(
      'research.done',
      `Исследование: новых тем ${added}, дублей отброшено ${duplicates}, источников ${notes.sources.length}`,
      {
        details: { sources: notes.sources.slice(0, 15) },
      },
    );

    if (ctx.task.payload.planWriting) await planWriting(deps, ctx);
    return { added, duplicates };
  };
}

/** Picks today's topics for writing: highest priority above the threshold, within the daily limit. */
export async function planWriting(deps: SeoDeps, ctx: Parameters<TaskHandler>[0]) {
  const { db } = deps;
  const settings = await loadSeoSettings(db);
  const today = mskDate(deps.now());
  const since = new Date(`${today}T00:00:00+03:00`);
  const [{ n } = { n: 0 }] = await rows<{ n: number }>(
    db,
    sql`SELECT count(*)::int AS n FROM seo_tasks WHERE kind = 'write_article' AND created_at >= ${since.toISOString()}`,
  );
  const slots = Math.max(0, settings.articlesPerDay - n);
  if (slots === 0) return;
  const candidates = await db
    .select()
    .from(schema.seoTopics)
    .where(
      and(
        inArray(schema.seoTopics.status, ['new', 'approved']),
        isNotNull(schema.seoTopics.priority),
      ),
    )
    .orderBy(sql`(${schema.seoTopics.priority})::text::float8 DESC`)
    .limit(30);
  const picked = candidates
    .filter(
      (t) =>
        t.status === 'approved' ||
        (Number(t.priority) >= settings.minTopicPriority &&
          (!t.subjectId || settings.prioritySubjects.includes(t.subjectId))),
    )
    .slice(0, slots);
  for (const t of picked) {
    await db
      .update(schema.seoTopics)
      .set({ status: 'planned', updatedAt: deps.now() })
      .where(eq(schema.seoTopics.id, t.id));
    await ctx.enqueue({
      kind: 'write_article',
      agent: 'content',
      key: `write_topic:${t.id}`,
      payload: { topicId: t.id },
      priority: 60,
    });
  }
  await ctx.log(
    'plan.writing',
    picked.length
      ? `Запланировано статей: ${picked.length} — ${picked.map((t) => `«${t.title}» (${t.priority})`).join(', ')}`
      : `Нет тем выше порога ${settings.minTopicPriority}`,
  );
}

/** Competitor Agent: weekly look at each active competitor (public pages via web search only). */
export const competitorOutputSchema = z.object({
  strongTopics: z.array(z.string().max(300)).max(15),
  formats: z.array(z.string().max(300)).max(10),
  internalLinking: z.string().max(1000),
  weakSpots: z.array(z.string().max(400)).max(15),
  opportunities: z
    .array(
      z.object({
        title: z.string().min(10).max(200),
        primaryKeyword: z.string().min(3).max(150),
        why: z.string().max(500),
      }),
    )
    .max(8),
});

export function competitorsHandler(deps: SeoDeps): TaskHandler {
  return async (ctx) => {
    const { db, ai } = deps;
    const week = mskDate(deps.now()).slice(0, 8);
    const list = await db
      .select()
      .from(schema.seoCompetitors)
      .where(eq(schema.seoCompetitors.isActive, true));
    let analyzed = 0;
    for (const c of list) {
      if (c.analyzedAt && deps.now().getTime() - c.analyzedAt.getTime() < 6 * 24 * 3600_000)
        continue;
      const notes = await ai.cached(
        'competitor',
        { domain: c.domain, week },
        24 * 6,
        async () =>
          (
            await ai.text({
              agent: 'competitor',
              purpose: 'competitor.web',
              taskId: ctx.task.id,
              tier: 'strong',
              effort: 'medium',
              maxTokens: 6000,
              webSearch: { maxUses: 5 },
              system: SYSTEM,
              prompt: `Изучи публичные материалы сайта ${c.domain} (${c.name}) о ЕГЭ через поиск: какие статьи и разделы ранжируются, какие форматы, как устроена перелинковка, какие темы раскрыты слабо или устарели. Не копируй тексты — только наблюдения. Заметки, без вступлений.`,
            })
          ).text,
        (text) => text.trim().length >= MIN_RESEARCH_CHARS,
      );
      const { data } = await ai.json(
        {
          agent: 'competitor',
          purpose: 'competitor.structure',
          taskId: ctx.task.id,
          tier: 'cheap',
          effort: 'low',
          maxTokens: 3000,
          system: SYSTEM,
          prompt: `Заметки о ${c.domain}:\n${notes.slice(0, 20_000)}\n\nСтруктурируй: сильные темы, форматы, перелинковка, слабые места, до 8 возможностей для Зубрилки (темы, где можно сделать лучше).`,
        },
        competitorOutputSchema,
      );
      await db
        .update(schema.seoCompetitors)
        .set({ analysis: data, analyzedAt: deps.now() })
        .where(eq(schema.seoCompetitors.id, c.id));
      const settings = await loadSeoSettings(db);
      for (const o of data.opportunities) {
        await db
          .insert(schema.seoTopics)
          .values({
            title: o.title,
            normalized: normalizeQuery(o.title),
            primaryKeyword: o.primaryKeyword,
            reasoning: `${c.name}: ${o.why}`,
            status: 'new',
            source: `competitor:${c.domain}`,
            factors: null,
            priority: null,
          })
          .onConflictDoNothing();
      }
      void settings;
      analyzed++;
      await ctx.log(
        'competitor.analyzed',
        `${c.name}: сильных тем ${data.strongTopics.length}, слабых мест ${data.weakSpots.length}, идей ${data.opportunities.length}`,
      );
    }
    // Competitor ideas have no factors yet: the next research run scores them (they are listed as existing topics).
    return { analyzed };
  };
}

/** Scores unscored topics (e.g. competitor ideas, admin ideas) with the cheap model. */
export function scoreTopicsHandler(deps: SeoDeps): TaskHandler {
  return async (ctx) => {
    const { db, ai } = deps;
    const settings = await loadSeoSettings(db);
    const pending = await db
      .select()
      .from(schema.seoTopics)
      .where(
        and(
          eq(schema.seoTopics.status, 'new'),
          sql`${schema.seoTopics.priority} IS NULL`,
          gte(schema.seoTopics.createdAt, new Date(0)),
        ),
      )
      .limit(20);
    if (!pending.length) return { scored: 0 };
    const out = z.object({
      items: z.array(
        z.object({
          index: z.number().int().min(0),
          format: z.enum(SEO_ARTICLE_FORMATS),
          subjectId: z.enum(['math', 'russian', 'general']),
          factors: researchOutputSchema.shape.topics.element.shape.factors,
          reasoning: z.string().max(800),
        }),
      ),
    });
    const { data } = await ai.json(
      {
        agent: 'research',
        purpose: 'topics.score',
        taskId: ctx.task.id,
        tier: 'cheap',
        effort: 'low',
        maxTokens: 4000,
        system: SYSTEM,
        prompt: `Оцени темы по 7 факторам (0–10; competition 10 = очень высокая конкуренция):\n${pending.map((t, i) => `${i}. ${t.title} — запрос «${t.primaryKeyword ?? t.title}». ${t.reasoning ?? ''}`).join('\n')}`,
      },
      out,
    );
    let scored = 0;
    for (const it of data.items) {
      const t = pending[it.index];
      if (!t) continue;
      await db
        .update(schema.seoTopics)
        .set({
          factors: it.factors,
          format: it.format,
          subjectId: it.subjectId === 'general' ? null : it.subjectId,
          priority: topicPriority(it.factors, settings.priorityWeights),
          reasoning: `${t.reasoning ?? ''}\n${it.reasoning}`.trim(),
          updatedAt: deps.now(),
        })
        .where(eq(schema.seoTopics.id, t.id));
      scored++;
    }
    await ctx.log('topics.scored', `Оценено тем: ${scored}`);
    return { scored };
  };
}
