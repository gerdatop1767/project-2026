import { loadIntegration, schema, type Database } from '@zybrilka/db';
import { normalizeQuery, type SeoIntegrationKind } from '@zybrilka/shared';
import { eq, sql } from 'drizzle-orm';
import { mskDate, type SeoDeps } from '../deps.js';
import {
  GoogleSearchConsole,
  IntegrationError,
  telegramChannelCheck,
  YandexMetrika,
  YandexWebmaster,
} from '../integrations/clients.js';
import { PermanentError, type TaskHandler } from '../queue.js';

/**
 * Analytics Agent: pulls real data from the connected official APIs into
 * seo_search_metrics / seo_traffic_daily / seo_index_status. Upserts by
 * natural key, so re-syncing a day never double-counts. A source that is
 * not connected is skipped — its numbers stay «Нет данных».
 */

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return url;
  }
}

async function setStatus(
  db: Database,
  kind: string,
  patch: {
    status: string;
    lastError?: string | null;
    lastSyncAt?: Date;
    lastCheckAt?: Date;
    config?: Record<string, unknown>;
  },
) {
  await db
    .update(schema.seoIntegrations)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.seoIntegrations.kind, kind));
}

async function upsertSearch(
  db: Database,
  engine: string,
  rows: {
    date: string;
    page: string;
    query: string;
    impressions: number;
    clicks: number;
    position: number | null;
  }[],
) {
  for (const r of rows) {
    const values = {
      engine,
      date: r.date,
      page: r.page,
      query: r.query.slice(0, 300),
      impressions: r.impressions,
      clicks: r.clicks,
      position: r.position,
      syncedAt: new Date(),
    };
    await db
      .insert(schema.seoSearchMetrics)
      .values(values)
      .onConflictDoUpdate({
        target: [
          schema.seoSearchMetrics.engine,
          schema.seoSearchMetrics.date,
          schema.seoSearchMetrics.page,
          schema.seoSearchMetrics.query,
        ],
        set: {
          impressions: values.impressions,
          clicks: values.clicks,
          position: values.position,
          syncedAt: values.syncedAt,
        },
      });
  }
}

export async function syncWebmaster(deps: SeoDeps, token: string, days: number) {
  const { db } = deps;
  const wm = new YandexWebmaster(deps.fetch, token);
  const userId = await wm.userId();
  const hostId = await wm.hostId(userId, deps.origin);
  const today = mskDate(deps.now());
  let rowsCount = 0;
  // Webmaster data lags 2–5 days; re-read the window each time (upsert).
  for (let i = 2; i < 2 + days; i++) {
    const day = addDays(today, -i);
    const queries = await wm.popularQueries(userId, hostId, day);
    await upsertSearch(
      db,
      'yandex',
      queries.map((q) => ({
        date: day,
        page: '',
        query: q.query,
        impressions: q.shows,
        clicks: q.clicks,
        position: q.position,
      })),
    );
    rowsCount += queries.length;
  }
  const summary = await wm.summary(userId, hostId);
  const values = {
    engine: 'yandex',
    date: today,
    page: '',
    indexedCount: summary.searchable_pages_count ?? null,
    excludedCount: summary.excluded_pages_count ?? null,
    state: 'summary',
    details: { sqi: summary.sqi ?? null, problems: summary.site_problems ?? {} },
    syncedAt: new Date(),
  };
  await db
    .insert(schema.seoIndexStatus)
    .values(values)
    .onConflictDoUpdate({
      target: [
        schema.seoIndexStatus.engine,
        schema.seoIndexStatus.date,
        schema.seoIndexStatus.page,
      ],
      set: values,
    });
  // Which blog articles are in Yandex search right now.
  const inSearch = new Set<string>();
  for (let offset = 0; offset < 2000; offset += 100) {
    const page = await wm.inSearchSamples(userId, hostId, 100, offset);
    for (const s of page.samples) inSearch.add(pathOf(s.url));
    if (offset + 100 >= page.count) break;
  }
  const articles = await db
    .select({ slug: schema.seoArticles.slug })
    .from(schema.seoArticles)
    .where(sql`${schema.seoArticles.publishedAt} IS NOT NULL`);
  for (const a of articles) {
    const p = `/blog/${a.slug}`;
    const v = {
      engine: 'yandex',
      date: today,
      page: p,
      state: inSearch.has(p) ? 'indexed' : 'not_indexed',
      syncedAt: new Date(),
    };
    await db
      .insert(schema.seoIndexStatus)
      .values(v)
      .onConflictDoUpdate({
        target: [
          schema.seoIndexStatus.engine,
          schema.seoIndexStatus.date,
          schema.seoIndexStatus.page,
        ],
        set: v,
      });
  }
  await setStatus(db, 'yandex_webmaster', {
    status: 'connected',
    lastError: null,
    lastSyncAt: new Date(),
    config: { hostId, userId },
  });
  return { queries: rowsCount, indexed: summary.searchable_pages_count ?? null };
}

export async function syncMetrika(
  deps: SeoDeps,
  token: string,
  config: Record<string, unknown>,
  days: number,
) {
  const { db } = deps;
  const m = new YandexMetrika(
    deps.fetch,
    token,
    Number(config.counterId),
    config.registrationGoalId ? Number(config.registrationGoalId) : undefined,
  );
  const today = mskDate(deps.now());
  const from = addDays(today, -days);
  const to = addDays(today, -1);
  const rows = [...(await m.bySource(from, to)), ...(await m.blogPages(from, to))];
  for (const r of rows) {
    const values = {
      date: r.date,
      source: r.source,
      page: r.page.replace(/\/+$/, ''),
      visits: r.visits,
      users: r.users,
      goalReaches: r.goalReaches,
      avgVisitSeconds: r.avgVisitSeconds,
      bounceRate: r.bounceRate,
      syncedAt: new Date(),
    };
    await db
      .insert(schema.seoTrafficDaily)
      .values(values)
      .onConflictDoUpdate({
        target: [
          schema.seoTrafficDaily.date,
          schema.seoTrafficDaily.source,
          schema.seoTrafficDaily.page,
        ],
        set: values,
      });
  }
  await setStatus(db, 'yandex_metrika', {
    status: 'connected',
    lastError: null,
    lastSyncAt: new Date(),
  });
  return { rows: rows.length };
}

export async function syncGsc(
  deps: SeoDeps,
  serviceAccount: string,
  config: Record<string, unknown>,
  days: number,
) {
  const { db } = deps;
  const gsc = new GoogleSearchConsole(deps.fetch, serviceAccount, String(config.siteUrl));
  const today = mskDate(deps.now());
  const rows = await gsc.query(addDays(today, -(days + 2)), addDays(today, -3));
  await upsertSearch(
    db,
    'google',
    rows.map((r) => ({
      date: r.date,
      page: pathOf(r.page),
      query: r.query,
      impressions: r.impressions,
      clicks: r.clicks,
      position: r.position,
    })),
  );
  // Whole-site query rows (page '') so engine totals compare with Yandex.
  const byQuery = new Map<
    string,
    { date: string; query: string; impressions: number; clicks: number; posSum: number }
  >();
  for (const r of rows) {
    const k = `${r.date}|${r.query}`;
    const e = byQuery.get(k) ?? {
      date: r.date,
      query: r.query,
      impressions: 0,
      clicks: 0,
      posSum: 0,
    };
    e.impressions += r.impressions;
    e.clicks += r.clicks;
    e.posSum += r.position * r.impressions;
    byQuery.set(k, e);
  }
  await upsertSearch(
    db,
    'google',
    [...byQuery.values()].map((e) => ({
      date: e.date,
      page: '',
      query: e.query,
      impressions: e.impressions,
      clicks: e.clicks,
      position: e.impressions ? e.posSum / e.impressions : null,
    })),
  );
  // Positions on keywords (latest week, impression-weighted).
  await db.execute(sql`UPDATE seo_keywords k SET position_google = to_jsonb(s.p), positions_updated_at = now()
    FROM (SELECT query, sum((position)::text::float8 * impressions) / nullif(sum(impressions), 0) AS p FROM seo_search_metrics
          WHERE engine = 'google' AND page = '' AND date >= current_date - 7 GROUP BY query) s
    WHERE s.p IS NOT NULL AND k.normalized = lower(regexp_replace(s.query, '[^[:alnum:]]+', ' ', 'g'))`);
  await setStatus(db, 'google_search_console', {
    status: 'connected',
    lastError: null,
    lastSyncAt: new Date(),
  });
  return { rows: rows.length };
}

async function updateYandexPositions(db: Database) {
  const latest = await db
    .select({
      query: schema.seoSearchMetrics.query,
      p: sql<
        number | null
      >`sum((${schema.seoSearchMetrics.position})::text::float8 * ${schema.seoSearchMetrics.impressions}) / nullif(sum(${schema.seoSearchMetrics.impressions}), 0)`,
    })
    .from(schema.seoSearchMetrics)
    .where(
      sql`${schema.seoSearchMetrics.engine} = 'yandex' AND ${schema.seoSearchMetrics.date} >= current_date - 7`,
    )
    .groupBy(schema.seoSearchMetrics.query);
  for (const r of latest) {
    if (r.p === null) continue;
    await db
      .update(schema.seoKeywords)
      .set({ positionYandex: Math.round(Number(r.p) * 10) / 10, positionsUpdatedAt: new Date() })
      .where(eq(schema.seoKeywords.normalized, normalizeQuery(r.query)));
  }
}

export function syncMetricsHandler(deps: SeoDeps): TaskHandler {
  return async (ctx) => {
    const days = Number((ctx.task.payload as { days?: number }).days ?? 7);
    const result: Record<string, unknown> = {};
    const sources: [
      SeoIntegrationKind,
      (secret: string, config: Record<string, unknown>) => Promise<unknown>,
    ][] = [
      ['yandex_webmaster', (s) => syncWebmaster(deps, s, days)],
      ['yandex_metrika', (s, c) => syncMetrika(deps, s, c, days)],
      ['google_search_console', (s, c) => syncGsc(deps, s, c, days)],
    ];
    for (const [kind, run] of sources) {
      const integ = await loadIntegration(deps.db, deps.secretsKey, kind);
      if (!integ?.secret) {
        result[kind] = 'not_connected';
        continue;
      }
      try {
        result[kind] = await run(integ.secret, integ.config);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result[kind] = { error: message };
        await setStatus(deps.db, kind, { status: 'error', lastError: message.slice(0, 500) });
        await ctx.log('sync.error', `${kind}: ${message.slice(0, 300)}`, { level: 'error' });
      }
    }
    await updateYandexPositions(deps.db);
    await ctx.log('sync.done', `Синхронизация метрик: ${JSON.stringify(result).slice(0, 400)}`);
    return result;
  };
}

/** Admin → «Проверить»: a real call to the provider; the status shown is what it answered. */
export function checkIntegrationHandler(deps: SeoDeps): TaskHandler {
  return async (ctx) => {
    const kind = (ctx.task.payload as { kind: SeoIntegrationKind }).kind;
    const { db } = deps;
    const integ = await loadIntegration(db, deps.secretsKey, kind);
    if (!integ) throw new PermanentError(`${kind} is not configured`);
    try {
      let note = 'ok';
      switch (kind) {
        case 'anthropic':
          note = deps.ai.configured
            ? 'ANTHROPIC_API_KEY задан в окружении worker'
            : 'ANTHROPIC_API_KEY не задан';
          if (!deps.ai.configured) throw new IntegrationError('anthropic', 0, note);
          break;
        case 'yandex_webmaster': {
          if (!integ.secret) throw new IntegrationError(kind, 0, 'нет токена');
          const wm = new YandexWebmaster(deps.fetch, integ.secret);
          const uid = await wm.userId();
          note = `host ${await wm.hostId(uid, deps.origin)}`;
          break;
        }
        case 'yandex_metrika': {
          if (!integ.secret) throw new IntegrationError(kind, 0, 'нет токена');
          const today = mskDate(deps.now());
          await new YandexMetrika(
            deps.fetch,
            integ.secret,
            Number(integ.config.counterId),
          ).bySource(addDays(today, -1), addDays(today, -1));
          note = `счётчик ${String(integ.config.counterId)}`;
          break;
        }
        case 'google_search_console': {
          if (!integ.secret) throw new IntegrationError(kind, 0, 'нет JSON сервисного аккаунта');
          const today = mskDate(deps.now());
          await new GoogleSearchConsole(
            deps.fetch,
            integ.secret,
            String(integ.config.siteUrl),
          ).query(addDays(today, -5), addDays(today, -4), ['date']);
          break;
        }
        case 'indexnow': {
          const res = await deps.fetch(
            `${deps.origin}/blog/indexnow-${String(integ.config.key)}.txt`,
            { signal: AbortSignal.timeout(15_000) },
          );
          if (!res.ok || (await res.text()).trim() !== integ.config.key)
            throw new IntegrationError(kind, res.status, 'файл ключа недоступен на сайте');
          note = 'файл ключа доступен';
          break;
        }
        case 'telegram_channel':
          if (!deps.telegramBotToken)
            throw new IntegrationError(kind, 0, 'TELEGRAM_BOT_TOKEN не задан');
          note = await telegramChannelCheck(
            deps.fetch,
            deps.telegramBotToken,
            String(integ.config.channelId),
          );
          break;
        case 'vk':
          if (!integ.secret) throw new IntegrationError(kind, 0, 'нет токена сообщества');
          note = 'токен сохранён; проверка — первой публикацией';
          break;
      }
      await setStatus(db, kind, { status: 'connected', lastError: null, lastCheckAt: new Date() });
      await ctx.log('integration.ok', `${kind}: подключено (${note})`);
      return { ok: true, note };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await setStatus(db, kind, {
        status: 'error',
        lastError: message.slice(0, 500),
        lastCheckAt: new Date(),
      });
      await ctx.log('integration.error', `${kind}: ${message.slice(0, 300)}`, { level: 'error' });
      return { ok: false, error: message };
    }
  };
}
