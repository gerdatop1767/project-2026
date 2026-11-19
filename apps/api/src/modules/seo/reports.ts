import { schema, type Database } from '@zybrilka/db';
import { articleSeoScore, percentChange } from '@zybrilka/shared';
import { sql } from 'drizzle-orm';
import { rows } from '../admin/sql.js';

/**
 * SEO Center reports (docs/SEO_CENTER.md). Every number comes from a table
 * filled by a real source; when a source has no rows for the window the
 * value is `null` and the UI shows «Нет данных». Nothing is estimated.
 */

export function mskToday(now = new Date()): string {
  return new Date(now.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface Window {
  from: string;
  /** exclusive */
  to: string;
}

export function windows(days: number, now = new Date()): { current: Window; previous: Window } {
  const to = addDays(mskToday(now), 1);
  const from = addDays(to, -days);
  return { current: { from, to }, previous: { from: addDays(from, -days), to: from } };
}

const mskTs = (w: Window) => ({
  from: sql`(${w.from}::date)::timestamp AT TIME ZONE 'Europe/Moscow'`,
  to: sql`(${w.to}::date)::timestamp AT TIME ZONE 'Europe/Moscow'`,
});

interface Kpis {
  organicVisits: number | null;
  organicUsers: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  avgPosition: number | null;
  top3: number | null;
  top10: number | null;
  top50: number | null;
  publishedArticles: number;
  externalPublished: number;
  seoRegistrations: number;
  organicGoalReaches: number | null;
  conversion: number | null;
}

async function kpis(db: Database, w: Window): Promise<Kpis> {
  const ts = mskTs(w);
  const [traffic] = await rows<{
    n: number;
    visits: number | null;
    users: number | null;
    goals: number | null;
  }>(
    db,
    sql`SELECT count(*)::int AS n, sum(visits)::int AS visits, sum(users)::int AS users, sum(goal_reaches)::int AS goals
        FROM seo_traffic_daily WHERE source = 'organic' AND page = '' AND date >= ${w.from}::date AND date < ${w.to}::date`,
  );
  const [search] = await rows<{
    n: number;
    impressions: number | null;
    clicks: number | null;
    pos: number | null;
  }>(
    db,
    sql`SELECT count(*)::int AS n, sum(impressions)::int AS impressions, sum(clicks)::int AS clicks,
          (sum(position * impressions) FILTER (WHERE position IS NOT NULL) / nullif(sum(impressions) FILTER (WHERE position IS NOT NULL), 0))::float8 AS pos
        FROM (SELECT impressions, clicks, (position)::text::float8 AS position FROM seo_search_metrics
              WHERE query <> '' AND date >= ${w.from}::date AND date < ${w.to}::date) s`,
  );
  const [tops] = await rows<{ top3: number; top10: number; top50: number; n: number }>(
    db,
    sql`SELECT count(*) FILTER (WHERE p <= 3)::int AS top3, count(*) FILTER (WHERE p <= 10)::int AS top10,
               count(*) FILTER (WHERE p <= 50)::int AS top50, count(*)::int AS n
        FROM (SELECT engine, query, sum((position)::text::float8 * impressions) / nullif(sum(impressions), 0) AS p
              FROM seo_search_metrics WHERE query <> '' AND position IS NOT NULL
                AND date >= ${w.from}::date AND date < ${w.to}::date GROUP BY engine, query) q WHERE p IS NOT NULL`,
  );
  const [counts] = await rows<{ published: number; external: number; regs: number }>(
    db,
    sql`SELECT
          (SELECT count(*)::int FROM seo_articles WHERE published_at >= ${ts.from} AND published_at < ${ts.to}) AS published,
          (SELECT count(*)::int FROM seo_external_posts WHERE status = 'published' AND published_at >= ${ts.from} AND published_at < ${ts.to}) AS external,
          (SELECT count(*)::int FROM user_attributions ua JOIN campaigns c ON c.id = ua.campaign_id
             WHERE (c.source = 'seo' OR c.channel = 'seo_external') AND ua.created_at >= ${ts.from} AND ua.created_at < ${ts.to}) AS regs`,
  );
  const hasTraffic = (traffic?.n ?? 0) > 0;
  const hasSearch = (search?.n ?? 0) > 0;
  const impressions = hasSearch ? (search!.impressions ?? 0) : null;
  const clicks = hasSearch ? (search!.clicks ?? 0) : null;
  const organicVisits = hasTraffic ? (traffic!.visits ?? 0) : null;
  const goals = hasTraffic ? traffic!.goals : null;
  const regs = counts?.regs ?? 0;
  const convBase = goals ?? regs;
  return {
    organicVisits,
    organicUsers: hasTraffic ? (traffic!.users ?? 0) : null,
    impressions,
    clicks,
    ctr: impressions && clicks !== null ? Math.round((clicks / impressions) * 10000) / 100 : null,
    avgPosition: hasSearch && search!.pos !== null ? Math.round(search!.pos * 10) / 10 : null,
    top3: hasSearch ? (tops?.top3 ?? 0) : null,
    top10: hasSearch ? (tops?.top10 ?? 0) : null,
    top50: hasSearch ? (tops?.top50 ?? 0) : null,
    publishedArticles: counts?.published ?? 0,
    externalPublished: counts?.external ?? 0,
    seoRegistrations: regs,
    organicGoalReaches: goals,
    conversion: organicVisits ? Math.round((convBase / organicVisits) * 10000) / 100 : null,
  };
}

export async function overviewReport(db: Database, days: number, now = new Date()) {
  const { current, previous } = windows(days, now);
  const [cur, prev] = await Promise.all([kpis(db, current), kpis(db, previous)]);
  const compare = Object.fromEntries(
    (Object.keys(cur) as (keyof Kpis)[]).map((k) => [k, percentChange(cur[k], prev[k])]),
  );

  const series = await rows<{
    date: string;
    organic: number | null;
    published: number;
    position: number | null;
    indexed: number | null;
    externalClicks: number;
    registrations: number;
    goals: number | null;
  }>(
    db,
    sql`WITH d AS (SELECT generate_series(${current.from}::date, ${addDays(current.to, -1)}::date, '1 day')::date AS date)
        SELECT d.date::text AS date,
          (SELECT sum(visits)::int FROM seo_traffic_daily t WHERE t.date = d.date AND t.source = 'organic' AND t.page = '') AS organic,
          (SELECT sum(goal_reaches)::int FROM seo_traffic_daily t WHERE t.date = d.date AND t.source = 'organic' AND t.page = '') AS goals,
          (SELECT count(*)::int FROM seo_articles a WHERE (a.published_at AT TIME ZONE 'Europe/Moscow')::date = d.date) AS published,
          (SELECT (sum((position)::text::float8 * impressions) / nullif(sum(impressions), 0))::float8 FROM seo_search_metrics m
             WHERE m.date = d.date AND m.query <> '' AND m.position IS NOT NULL) AS position,
          (SELECT sum(indexed_count)::int FROM seo_index_status i WHERE i.date = d.date AND i.page = '') AS indexed,
          (SELECT count(*)::int FROM analytics_events e JOIN campaigns c ON c.id = e.campaign_id
             WHERE e.type = 'campaign_click' AND c.channel = 'seo_external'
               AND (e.occurred_at AT TIME ZONE 'Europe/Moscow')::date = d.date) AS "externalClicks",
          (SELECT count(*)::int FROM user_attributions ua JOIN campaigns c ON c.id = ua.campaign_id
             WHERE (c.source = 'seo' OR c.channel = 'seo_external')
               AND (ua.created_at AT TIME ZONE 'Europe/Moscow')::date = d.date) AS registrations
        FROM d ORDER BY d.date`,
  );

  const [totals] = await rows<{ published: number; external: number; indexed: number | null }>(
    db,
    sql`SELECT (SELECT count(*)::int FROM seo_articles WHERE status = 'published') AS published,
               (SELECT count(*)::int FROM seo_external_posts WHERE status = 'published') AS external,
               (SELECT sum(indexed_count)::int FROM seo_index_status i
                 WHERE i.page = '' AND i.date = (SELECT max(date) FROM seo_index_status WHERE page = '')) AS indexed`,
  );
  const [indexedArticles] = await rows<{ n: number; known: number }>(
    db,
    sql`SELECT count(DISTINCT a.id) FILTER (WHERE s.state = 'indexed')::int AS n, count(DISTINCT s.page)::int AS known
        FROM seo_articles a LEFT JOIN seo_index_status s ON s.page = '/blog/' || a.slug
        WHERE a.status = 'published'`,
  );

  const integrations = await db.select().from(schema.seoIntegrations);
  return {
    days,
    window: current,
    previousWindow: previous,
    current: cur,
    previous: prev,
    compare,
    totals: {
      publishedArticles: totals?.published ?? 0,
      externalPublished: totals?.external ?? 0,
      indexedPages: totals?.indexed ?? null,
      indexedArticles: indexedArticles && indexedArticles.known > 0 ? indexedArticles.n : null,
    },
    series,
    sources: Object.fromEntries(
      integrations.map((i) => [
        i.kind,
        { status: i.status, lastSyncAt: i.lastSyncAt, lastError: i.lastError },
      ]),
    ),
  };
}

/** Per-article real metrics over the last `days` (28 by default) + SEO Score. */
export async function articleMetrics(db: Database, days = 28, now = new Date()) {
  const { current } = windows(days, now);
  const ts = mskTs(current);
  const list = await rows<{
    id: string;
    impressions: number | null;
    clicks: number | null;
    position: number | null;
    visits: number | null;
    avgSeconds: number | null;
    views: number | null;
    registrations: number;
    ctaClicks: number;
    hasSearch: boolean;
    hasTraffic: boolean;
  }>(
    db,
    sql`SELECT a.id::text AS id,
          s.impressions, s.clicks, s.position, t.visits, t.avg_seconds AS "avgSeconds", t.views,
          coalesce(r.n, 0)::int AS registrations, coalesce(k.n, 0)::int AS "ctaClicks",
          (s.page IS NOT NULL) AS "hasSearch", (t.page IS NOT NULL) AS "hasTraffic"
        FROM seo_articles a
        LEFT JOIN (SELECT page, sum(impressions)::int AS impressions, sum(clicks)::int AS clicks,
                     (sum((position)::text::float8 * impressions) FILTER (WHERE position IS NOT NULL)
                       / nullif(sum(impressions) FILTER (WHERE position IS NOT NULL), 0))::float8 AS position
                   FROM seo_search_metrics WHERE date >= ${current.from}::date AND date < ${current.to}::date GROUP BY page) s
          ON s.page = '/blog/' || a.slug
        LEFT JOIN (SELECT page, sum(visits) FILTER (WHERE source = 'organic')::int AS visits, sum(visits)::int AS views,
                     avg((avg_visit_seconds)::text::float8)::float8 AS avg_seconds
                   FROM seo_traffic_daily WHERE page <> '' AND date >= ${current.from}::date AND date < ${current.to}::date GROUP BY page) t
          ON t.page = '/blog/' || a.slug
        LEFT JOIN (SELECT ua.campaign_id, count(*) AS n FROM user_attributions ua
                   WHERE ua.created_at >= ${ts.from} GROUP BY ua.campaign_id) r ON r.campaign_id = a.campaign_id
        LEFT JOIN (SELECT campaign_id, count(*) AS n FROM analytics_events
                   WHERE type = 'campaign_click' AND occurred_at >= ${ts.from} GROUP BY campaign_id) k ON k.campaign_id = a.campaign_id`,
  );
  const searchConnected =
    (await rows<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM seo_search_metrics`))[0]!.n >
    0;
  const trafficConnected =
    (await rows<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM seo_traffic_daily`))[0]!.n >
    0;
  const map = new Map<string, ReturnType<typeof shape>>();
  function shape(r: (typeof list)[number]) {
    const impressions = searchConnected ? (r.impressions ?? 0) : null;
    const clicks = searchConnected ? (r.clicks ?? 0) : null;
    const position = r.position;
    const organicVisits = trafficConnected ? (r.visits ?? 0) : null;
    return {
      impressions,
      clicks,
      ctr: impressions && clicks !== null ? Math.round((clicks / impressions) * 10000) / 100 : null,
      position: position === null ? null : Math.round(position * 10) / 10,
      organicVisits,
      views: trafficConnected ? (r.views ?? 0) : null,
      registrations: r.registrations,
      ctaClicks: r.ctaClicks,
      seoScore: articleSeoScore({
        impressions,
        clicks,
        position,
        organicVisits,
        registrations: r.registrations,
        avgVisitSeconds: r.avgSeconds,
      }),
    };
  }
  for (const r of list) map.set(r.id, shape(r));
  return map;
}

/** Agent status: what ran, what failed, what it cost. */
export async function agentStatusReport(db: Database, now = new Date()) {
  const today = mskToday(now);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [usage] = await rows<{
    dayCost: number;
    monthCost: number;
    dayCalls: number;
    monthCalls: number;
    monthIn: number;
    monthOut: number;
    weekCost: number;
  }>(
    db,
    sql`SELECT
          coalesce(sum((cost_usd)::text::numeric) FILTER (WHERE at >= (${today}::date)::timestamp AT TIME ZONE 'Europe/Moscow'), 0)::float8 AS "dayCost",
          coalesce(sum((cost_usd)::text::numeric) FILTER (WHERE at >= now() - interval '7 days'), 0)::float8 AS "weekCost",
          coalesce(sum((cost_usd)::text::numeric), 0)::float8 AS "monthCost",
          count(*) FILTER (WHERE at >= (${today}::date)::timestamp AT TIME ZONE 'Europe/Moscow')::int AS "dayCalls",
          count(*)::int AS "monthCalls",
          coalesce(sum(input_tokens + cache_read_tokens + cache_write_tokens), 0)::int AS "monthIn",
          coalesce(sum(output_tokens), 0)::int AS "monthOut"
        FROM seo_ai_usage WHERE at >= (${monthStart}::date)::timestamp AT TIME ZONE 'Europe/Moscow'`,
  );
  const [tasks] = await rows<{
    queued: number;
    running: number;
    doneToday: number;
    failedToday: number;
    lastStarted: string | null;
    nextRun: string | null;
  }>(
    db,
    sql`SELECT count(*) FILTER (WHERE status = 'queued')::int AS queued,
               count(*) FILTER (WHERE status = 'running')::int AS running,
               count(*) FILTER (WHERE status = 'done' AND finished_at >= now() - interval '24 hours')::int AS "doneToday",
               count(*) FILTER (WHERE status = 'failed' AND finished_at >= now() - interval '24 hours')::int AS "failedToday",
               max(started_at)::text AS "lastStarted",
               min(run_after) FILTER (WHERE status = 'queued')::text AS "nextRun"
        FROM seo_tasks`,
  );
  const [made] = await rows<{ articles: number; posts: number; topics: number; keywords: number }>(
    db,
    sql`SELECT (SELECT count(*)::int FROM seo_articles WHERE generated_by IS NOT NULL) AS articles,
               (SELECT count(*)::int FROM seo_external_posts) AS posts,
               (SELECT count(*)::int FROM seo_topics) AS topics,
               (SELECT count(*)::int FROM seo_keywords) AS keywords`,
  );
  const [heartbeat] = await db
    .select()
    .from(schema.appSettings)
    .where(sql`${schema.appSettings.key} = 'seo.agent.heartbeat'`);
  return {
    usage: usage!,
    tasks: tasks!,
    made: made!,
    heartbeat: heartbeat ? { value: heartbeat.value, at: heartbeat.updatedAt } : null,
  };
}
