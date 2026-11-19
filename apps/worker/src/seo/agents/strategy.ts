import { loadSeoSettings, saveSeoSettings, schema, writeSeoLog } from '@zybrilka/db';
import { articleSeoScore, SEO_LEARNING_KINDS, type SeoPriorityWeights } from '@zybrilka/shared';
import { and, eq, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { SeoDeps } from '../deps.js';
import type { TaskHandler } from '../queue.js';
import { rows } from '../sql.js';

/**
 * Strategy + Optimization Agents (docs/SEO_CENTER.md §8). Learning here is
 * arithmetic on stored real metrics, not prose:
 *  1. seo_insights — per format / subject / platform / title pattern: sample
 *     size and measured averages (28 days);
 *  2. priority weights — each topic factor is correlated with the measured
 *     SEO Score of the articles written from those topics; weights move by
 *     at most 20 % a week, only with ≥ 8 scored articles;
 *  3. earlier decisions are re-measured and get an outcome;
 *  4. the model only WRITES UP the computed numbers (observations,
 *     hypotheses, plan) — it is told to use nothing else.
 */

const MIN_SAMPLE = 8;

interface ArticleStat {
  id: string;
  title: string;
  slug: string;
  format: string | null;
  subjectId: string | null;
  factors: Record<string, number> | null;
  impressions: number;
  clicks: number;
  position: number | null;
  prevPosition: number | null;
  prevClicks: number;
  visits: number | null;
  registrations: number;
  publishedAt: Date;
}

export async function articleStats(
  deps: SeoDeps,
): Promise<{ list: ArticleStat[]; search: boolean; traffic: boolean }> {
  const { db } = deps;
  const list = await rows<ArticleStat>(
    db,
    sql`SELECT a.id::text AS id, a.title, a.slug, a.format, a.subject_id AS "subjectId", t.factors, a.published_at AS "publishedAt",
          coalesce(cur.impressions, 0)::int AS impressions, coalesce(cur.clicks, 0)::int AS clicks, cur.position,
          prev.position AS "prevPosition", coalesce(prev.clicks, 0)::int AS "prevClicks",
          tr.visits, coalesce(r.n, 0)::int AS registrations
        FROM seo_articles a
        LEFT JOIN seo_topics t ON t.id = a.topic_id
        LEFT JOIN (SELECT page, sum(impressions) AS impressions, sum(clicks) AS clicks,
                     (sum((position)::text::float8 * impressions) / nullif(sum(impressions), 0))::float8 AS position
                   FROM seo_search_metrics WHERE date >= current_date - 28 GROUP BY page) cur ON cur.page = '/blog/' || a.slug
        LEFT JOIN (SELECT page, sum(clicks) AS clicks,
                     (sum((position)::text::float8 * impressions) / nullif(sum(impressions), 0))::float8 AS position
                   FROM seo_search_metrics WHERE date >= current_date - 56 AND date < current_date - 28 GROUP BY page) prev ON prev.page = '/blog/' || a.slug
        LEFT JOIN (SELECT page, sum(visits)::int AS visits FROM seo_traffic_daily WHERE source = 'organic' AND date >= current_date - 28 GROUP BY page) tr ON tr.page = '/blog/' || a.slug
        LEFT JOIN (SELECT campaign_id, count(*) AS n FROM user_attributions WHERE created_at >= now() - interval '28 days' GROUP BY campaign_id) r ON r.campaign_id = a.campaign_id
        WHERE a.published_at IS NOT NULL AND a.published_at < now() - interval '7 days'`,
  );
  const [{ s, t } = { s: 0, t: 0 }] = await rows<{ s: number; t: number }>(
    db,
    sql`SELECT (SELECT count(*)::int FROM seo_search_metrics WHERE page LIKE '/blog/%') AS s, (SELECT count(*)::int FROM seo_traffic_daily) AS t`,
  );
  return { list, search: s > 0, traffic: t > 0 };
}

export function scoreOf(a: ArticleStat, search: boolean, traffic: boolean) {
  return articleSeoScore({
    impressions: search ? a.impressions : null,
    clicks: search ? a.clicks : null,
    position: a.position,
    organicVisits: traffic ? (a.visits ?? 0) : null,
    registrations: a.registrations,
  });
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    dx += (xs[i]! - mx) ** 2;
    dy += (ys[i]! - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

/** New weights from factor↔score correlations (pure; unit-tested). */
export function adjustWeights(
  weights: SeoPriorityWeights,
  samples: { factors: Record<string, number>; score: number }[],
): { weights: SeoPriorityWeights; correlations: Record<string, number | null>; changed: boolean } {
  const correlations: Record<string, number | null> = {};
  const next = { ...weights };
  if (samples.length < MIN_SAMPLE) return { weights, correlations, changed: false };
  for (const key of Object.keys(weights) as (keyof SeoPriorityWeights)[]) {
    // competition is inverted in the priority formula: high competition should hurt.
    const xs = samples.map((s) =>
      key === 'competition' ? 10 - (s.factors[key] ?? 5) : (s.factors[key] ?? 5),
    );
    const r = pearson(
      xs,
      samples.map((s) => s.score),
    );
    correlations[key] = r === null ? null : Math.round(r * 100) / 100;
    if (r === null || Math.abs(r) < 0.15) continue;
    next[key] = Math.min(
      0.5,
      Math.max(0.03, weights[key] * (1 + Math.max(-0.2, Math.min(0.2, r * 0.3)))),
    );
  }
  const total = Object.values(next).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(next) as (keyof SeoPriorityWeights)[])
    next[k] = Math.round((next[k] / total) * 1000) / 1000;
  const changed = (Object.keys(next) as (keyof SeoPriorityWeights)[]).some(
    (k) => Math.abs(next[k] - weights[k]) >= 0.005,
  );
  return { weights: changed ? next : weights, correlations, changed };
}

function titlePattern(title: string): string {
  if (/\?$/.test(title.trim())) return 'question';
  if (/\b20\d\d\b/.test(title)) return 'with_year';
  if (/\b\d+\b/.test(title)) return 'with_number';
  if (/как |how/i.test(title)) return 'how_to';
  return 'plain';
}

const writeupSchema = z.object({
  entries: z
    .array(
      z.object({
        kind: z.enum(SEO_LEARNING_KINDS),
        title: z.string().min(5).max(200),
        body: z.string().min(20).max(2000),
      }),
    )
    .max(12),
  nextWeekPlan: z.array(z.string().min(5).max(300)).max(10),
});

export function weeklyStrategyHandler(deps: SeoDeps): TaskHandler {
  return async (ctx) => {
    const { db, ai } = deps;
    const settings = await loadSeoSettings(db);
    const { list, search, traffic } = await articleStats(deps);
    const scored = list.map((a) => ({ ...a, score: scoreOf(a, search, traffic) }));

    // 1. Knowledge base (only dimensions with data).
    const groups: Record<string, Map<string, typeof scored>> = {
      format: new Map(),
      subject: new Map(),
      title_pattern: new Map(),
    };
    for (const a of scored) {
      const add = (dim: string, v: string) =>
        groups[dim]!.set(v, [...(groups[dim]!.get(v) ?? []), a]);
      add('format', a.format ?? 'unknown');
      add('subject', a.subjectId ?? 'general');
      add('title_pattern', titlePattern(a.title));
    }
    const avg = (xs: (number | null)[]) => {
      const v = xs.filter((x): x is number => x !== null);
      return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null;
    };
    const insightRows: {
      dimension: string;
      value: string;
      sampleSize: number;
      metrics: Record<string, number | null>;
    }[] = [];
    for (const [dimension, map] of Object.entries(groups)) {
      for (const [value, arts] of map) {
        insightRows.push({
          dimension,
          value,
          sampleSize: arts.length,
          metrics: {
            avgScore: avg(arts.map((a) => a.score)),
            avgImpressions: search ? avg(arts.map((a) => a.impressions)) : null,
            avgClicks: search ? avg(arts.map((a) => a.clicks)) : null,
            avgCtr: search
              ? avg(arts.map((a) => (a.impressions ? (a.clicks / a.impressions) * 100 : null)))
              : null,
            avgPosition: avg(arts.map((a) => a.position)),
            registrations: arts.reduce((s, a) => s + a.registrations, 0),
          },
        });
      }
    }
    const platformPerf = await rows<{
      value: string;
      posts: number;
      clicks: number;
      registrations: number;
    }>(
      db,
      sql`SELECT p.slug AS value, count(DISTINCT ep.id)::int AS posts,
            (SELECT count(*)::int FROM analytics_events e JOIN seo_external_posts x ON x.campaign_id = e.campaign_id
               WHERE x.platform_id = p.id AND e.type = 'campaign_click' AND e.occurred_at >= now() - interval '28 days') AS clicks,
            (SELECT count(*)::int FROM user_attributions ua JOIN seo_external_posts x ON x.campaign_id = ua.campaign_id
               WHERE x.platform_id = p.id AND ua.created_at >= now() - interval '28 days') AS registrations
          FROM seo_platforms p JOIN seo_external_posts ep ON ep.platform_id = p.id AND ep.status = 'published'
          GROUP BY p.id, p.slug`,
    );
    for (const p of platformPerf)
      insightRows.push({
        dimension: 'platform',
        value: p.value,
        sampleSize: p.posts,
        metrics: {
          clicks: p.clicks,
          registrations: p.registrations,
          clicksPerPost: p.posts ? Math.round((p.clicks / p.posts) * 10) / 10 : null,
        },
      });
    for (const r of insightRows) {
      await db
        .insert(schema.seoInsights)
        .values({ ...r, windowDays: 28, computedAt: new Date() })
        .onConflictDoUpdate({
          target: [
            schema.seoInsights.dimension,
            schema.seoInsights.value,
            schema.seoInsights.windowDays,
          ],
          set: { sampleSize: r.sampleSize, metrics: r.metrics, computedAt: new Date() },
        });
    }

    // 2. Priority weights from real outcomes.
    const samples = scored
      .filter((a) => a.factors && a.score !== null)
      .map((a) => ({ factors: a.factors!, score: a.score! }));
    const adj = adjustWeights(settings.priorityWeights, samples);
    if (adj.changed) {
      await saveSeoSettings(db, { ...settings, priorityWeights: adj.weights }, null);
      await db.insert(schema.seoLearningLog).values({
        kind: 'strategy_change',
        title: 'Пересчитаны веса приоритета тем',
        body: `По ${samples.length} статьям с реальными метриками: корреляции факторов с SEO Score ${JSON.stringify(adj.correlations)}. Новые веса применяются к следующим исследованиям.`,
        evidence: {
          before: settings.priorityWeights,
          after: adj.weights,
          correlations: adj.correlations,
          sample: samples.length,
        },
      });
    }

    // 3. Re-measure earlier decisions (≥ 14 days old).
    const due = await db
      .select()
      .from(schema.seoLearningLog)
      .where(
        and(
          eq(schema.seoLearningLog.status, 'active'),
          sql`${schema.seoLearningLog.kind} IN ('decision', 'strategy_change')`,
          lt(schema.seoLearningLog.at, new Date(deps.now().getTime() - 14 * 24 * 3600_000)),
        ),
      );
    const avgScoreNow = avg(scored.map((a) => a.score));
    for (const d of due) {
      const before = (d.evidence?.avgScoreAtDecision as number | undefined) ?? null;
      const outcome =
        before === null || avgScoreNow === null
          ? 'Недостаточно данных для оценки результата.'
          : `Средний SEO Score статей: было ${before}, стало ${avgScoreNow} (${avgScoreNow >= before ? '+' : ''}${Math.round((avgScoreNow - before) * 10) / 10}).`;
      await db
        .update(schema.seoLearningLog)
        .set({ status: 'evaluated', outcome, evaluatedAt: new Date() })
        .where(eq(schema.seoLearningLog.id, d.id));
    }

    // 4. Write-up (only when there is something measured to talk about).
    if (scored.length === 0 || (!search && !traffic && platformPerf.length === 0)) {
      await db
        .insert(schema.seoLearningLog)
        .values({
          kind: 'observation',
          title: 'Недостаточно данных',
          body: `Опубликованных статей старше 7 дней: ${scored.length}. Поисковые данные: ${search ? 'есть' : 'нет'}, Метрика: ${traffic ? 'есть' : 'нет'}. Стратегия не меняется, пока нет реальных метрик.`,
          evidence: { articles: scored.length, search, traffic },
        });
      await ctx.log(
        'strategy.skipped',
        'Недельная стратегия: недостаточно реальных данных — без изменений',
      );
      return { articles: scored.length, changedWeights: false };
    }
    const top = [...scored].filter((a) => a.score !== null).sort((x, y) => y.score! - x.score!);
    const { data } = await ai.json(
      {
        agent: 'strategy',
        purpose: 'strategy.weekly',
        taskId: ctx.task.id,
        tier: 'strong',
        effort: 'high',
        maxTokens: 6000,
        system: `Ты — руководитель SEO блога «Зубрилки». Пишешь журнал обучения по ПЕРЕДАННЫМ цифрам. Запрещено: придумывать числа, проценты и тренды, которых нет в данных; делать выводы по выборке меньше 3 статей без пометки «гипотеза». Каждая запись ссылается на конкретные цифры из данных.`,
        prompt: `Данные за 28 дней (только реальные метрики; null = нет данных).
Статьи (лучшие и худшие по SEO Score):
${[...top.slice(0, 10), ...top.slice(-5)].map((a) => `- «${a.title}» [${a.format}, ${a.subjectId ?? 'general'}]: score ${a.score}, показы ${search ? a.impressions : 'null'}, клики ${search ? a.clicks : 'null'}, позиция ${a.position?.toFixed(1) ?? 'null'} (было ${a.prevPosition?.toFixed(1) ?? 'null'}), визиты ${a.visits ?? 'null'}, регистрации ${a.registrations}`).join('\n')}

База знаний (группы):
${insightRows.map((r) => `- ${r.dimension}=${r.value} (n=${r.sampleSize}): ${JSON.stringify(r.metrics)}`).join('\n')}

Изменение весов приоритета: ${adj.changed ? JSON.stringify({ before: settings.priorityWeights, after: adj.weights }) : `нет (выборка ${samples.length}, нужно ≥ ${MIN_SAMPLE})`}
Оценённые прошлые решения: ${due.length}

Сформулируй: наблюдения (observation), закономерности (pattern), гипотезы (hypothesis), решения (decision) и план на неделю.`,
      },
      writeupSchema,
    );
    for (const e of data.entries) {
      await db
        .insert(schema.seoLearningLog)
        .values({
          kind: e.kind,
          title: e.title,
          body: e.body,
          evidence: { avgScoreAtDecision: avgScoreNow, articles: scored.length },
          status: e.kind === 'decision' ? 'active' : 'info',
        });
    }
    await db
      .insert(schema.seoLearningLog)
      .values({
        kind: 'decision',
        title: 'План на неделю',
        body: data.nextWeekPlan.map((p) => `• ${p}`).join('\n'),
        evidence: { avgScoreAtDecision: avgScoreNow, articles: scored.length },
      });
    await ctx.log(
      'strategy.done',
      `Недельная стратегия: статей ${scored.length}, записей в журнал ${data.entries.length + 1}, веса ${adj.changed ? 'обновлены' : 'без изменений'}`,
    );
    await ctx.enqueue({
      kind: 'refresh_articles',
      agent: 'optimization',
      key: `refresh_articles:${ctx.task.id}`,
      priority: 40,
    });
    return { articles: scored.length, changedWeights: adj.changed };
  };
}

/** Optimization Agent: articles that lost positions/clicks → update (pending revision, reviewed). */
export function refreshArticlesHandler(deps: SeoDeps): TaskHandler {
  return async (ctx) => {
    const { db } = deps;
    const settings = await loadSeoSettings(db);
    const { list } = await articleStats(deps);
    const declining = list.filter(
      (a) =>
        (a.position !== null && a.prevPosition !== null && a.position - a.prevPosition >= 3) ||
        (a.prevClicks >= 10 && a.clicks <= a.prevClicks * 0.6),
    );
    // Content older than a year is re-checked for freshness regardless of metrics.
    const stale = list.filter(
      (a) => deps.now().getTime() - new Date(a.publishedAt).getTime() > 330 * 24 * 3600_000,
    );
    const targets = [...new Map([...declining, ...stale].map((a) => [a.id, a])).values()].slice(
      0,
      Math.max(1, settings.articlesPerDay),
    );
    for (const a of targets) {
      const why = declining.includes(a)
        ? `Статья теряет позиции/клики: позиция ${a.prevPosition?.toFixed(1) ?? '—'} → ${a.position?.toFixed(1) ?? '—'}, клики ${a.prevClicks} → ${a.clicks}.`
        : 'Статье больше 11 месяцев — проверить актуальность фактов (новый год ЕГЭ).';
      await db
        .insert(schema.seoLearningLog)
        .values({
          kind: 'decision',
          title: `Обновить «${a.title}»`,
          body: why,
          relatedId: a.id,
          evidence: {
            position: a.position,
            prevPosition: a.prevPosition,
            clicks: a.clicks,
            prevClicks: a.prevClicks,
          },
        });
      if (settings.mode !== 'manual') {
        await ctx.enqueue({
          kind: 'write_article',
          agent: 'content',
          key: `update:${a.id}:${new Date().toISOString().slice(0, 10)}`,
          articleId: a.id,
          payload: {
            articleId: a.id,
            instructions: `${why} Обнови статью: проверь факты по официальным источникам на текущий год, улучши ответ на основной запрос, заголовок и вступление, добавь недостающие разделы и FAQ.`,
          },
          priority: 45,
        });
      }
      await writeSeoLog(db, {
        agent: 'optimization',
        action: 'article.flagged',
        message: why,
        articleId: a.id,
      });
    }
    return {
      declining: declining.length,
      stale: stale.length,
      queued: settings.mode === 'manual' ? 0 : targets.length,
    };
  };
}
