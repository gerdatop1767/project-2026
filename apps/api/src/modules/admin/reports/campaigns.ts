import { schema } from '@zybrilka/db';
import type { Database } from '@zybrilka/db';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isAllowedCampaignTarget, newCampaignSlug } from '../../analytics/campaignLinks.js';
import { ATTRIBUTION_WINDOW_DAYS } from '../../analytics/recorder.js';
import type { Period } from '../period.js';
import { one, rows } from './common.js';

const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

const text = (max: number) => z.string().trim().min(1).max(max);
export const campaignCreateSchema = z.object({
  name: text(120),
  source: text(60).regex(/^[\p{L}\p{N} ._-]+$/u),
  channel: text(60).regex(/^[\p{L}\p{N} ._-]+$/u),
  creative: z.string().trim().max(120).optional(),
  targetPath: z.string().trim().max(130).refine(isAllowedCampaignTarget, 'target_not_allowed'),
});
export const campaignStatusSchema = z.object({
  status: z.enum(['active', 'disabled', 'archived']),
  confirm: z.literal(true),
});

export async function createCampaign(
  db: Database,
  actorUserId: string,
  input: z.infer<typeof campaignCreateSchema>,
) {
  for (let i = 0; i < 5; i++) {
    const [row] = await db
      .insert(schema.campaigns)
      .values({
        slug: newCampaignSlug(),
        name: input.name,
        source: input.source.toLowerCase(),
        channel: input.channel.toLowerCase(),
        creative: input.creative || null,
        targetPath: input.targetPath,
        createdBy: actorUserId,
      })
      .onConflictDoNothing({ target: schema.campaigns.slug })
      .returning();
    if (row) return row;
  }
  throw new Error('could not allocate a campaign slug');
}

export async function setCampaignStatus(
  db: Database,
  id: string,
  status: 'active' | 'disabled' | 'archived',
) {
  const [before] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id));
  if (!before) return null;
  const [after] = await db
    .update(schema.campaigns)
    .set({ status, updatedAt: new Date() })
    .where(eq(schema.campaigns.id, id))
    .returning();
  return { before, after: after! };
}

/**
 * Per-campaign metrics for the period (docs/ADMIN.md §Атрибуция):
 * - clicks: counted link opens (link-preview bots excluded) / Mini App
 *   launches with this start_param;
 * - unique visitors: distinct browsers among those clicks;
 * - registrations: accounts whose attribution names this campaign
 *   (first touch, within the window), registered in the period;
 * - started / first answer / 5 / 10: those accounts' training so far;
 * - D7 / D30: those accounts active again ≥7 / ≥30 days after registering;
 * - guestAnswered: campaign browsers that checked ≥1 answer without an account.
 */
export async function campaignsReport(
  db: Database,
  period: Period,
  opts: { includeArchived: boolean },
) {
  const s = ts(period.startUtc);
  const e = ts(period.endUtc);
  const items = await rows<Record<string, unknown>>(
    db,
    sql`SELECT c.id, c.slug, c.name, c.source, c.channel, c.creative, c.target_path AS "targetPath", c.status,
      c.created_at::text AS "createdAt",
      (SELECT count(*)::int FROM analytics_events x WHERE x.type = 'campaign_click' AND x.campaign_id = c.id AND x.occurred_at >= ${s} AND x.occurred_at < ${e}) AS clicks,
      (SELECT count(DISTINCT x.visitor_id)::int FROM analytics_events x WHERE x.type = 'campaign_click' AND x.campaign_id = c.id AND x.occurred_at >= ${s} AND x.occurred_at < ${e}) AS "uniqueVisitors",
      (SELECT count(DISTINCT v.id)::int FROM analytics_visitors v JOIN analytics_events x ON x.visitor_id = v.id AND x.type = 'answer_checked' AND x.user_id IS NULL
        WHERE v.campaign_id = c.id AND x.occurred_at >= ${s} AND x.occurred_at < ${e}) AS "guestAnswered",
      cu.registrations, cu.started, cu.a1, cu.a5, cu.a10, cu.d7, cu.d30, cu.d7eligible, cu.d30eligible
      FROM campaigns c
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS registrations,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM analytics_events x WHERE x.user_id = u.id AND x.type = 'task_started') OR st.n > 0)::int AS started,
          count(*) FILTER (WHERE st.n >= 1)::int AS a1,
          count(*) FILTER (WHERE st.n >= 5)::int AS a5,
          count(*) FILTER (WHERE st.n >= 10)::int AS a10,
          count(*) FILTER (WHERE st.last_at >= u.created_at + interval '7 days')::int AS d7,
          count(*) FILTER (WHERE st.last_at >= u.created_at + interval '30 days')::int AS d30,
          count(*) FILTER (WHERE u.created_at <= now() - interval '7 days')::int AS d7eligible,
          count(*) FILTER (WHERE u.created_at <= now() - interval '30 days')::int AS d30eligible
        FROM user_attributions ua JOIN users u ON u.id = ua.user_id
        LEFT JOIN LATERAL (SELECT count(*) AS n, max(a.created_at) AS last_at FROM attempts a WHERE a.user_id = u.id) st ON true
        WHERE ua.campaign_id = c.id AND u.created_at >= ${s} AND u.created_at < ${e}
      ) cu ON true
      WHERE ${opts.includeArchived ? sql`true` : sql`c.status <> 'archived'`}
      ORDER BY c.created_at DESC LIMIT 500`,
  );
  const attribution = await one<{ total: number; attributed: number; unknown: number }>(
    db,
    sql`SELECT count(*)::int AS total,
      count(ua.campaign_id)::int AS attributed,
      (count(*) - count(ua.campaign_id))::int AS unknown
      FROM users u LEFT JOIN user_attributions ua ON ua.user_id = u.id
      WHERE EXISTS (SELECT 1 FROM auth_identities ai WHERE ai.user_id = u.id)
        AND u.created_at >= ${s} AND u.created_at < ${e}`,
  );
  return {
    attributionWindowDays: ATTRIBUTION_WINDOW_DAYS,
    registrations: {
      ...attribution,
      unknownShare: attribution.total > 0 ? attribution.unknown / attribution.total : null,
    },
    items: items.map((item): Record<string, unknown> => ({
      ...item,
      conversion:
        Number(item.uniqueVisitors) > 0
          ? Number(item.registrations) / Number(item.uniqueVisitors)
          : null,
    })),
    searchIntegrations: {
      yandexWebmaster: 'not_connected' as const,
      googleSearchConsole: 'not_connected' as const,
    },
  };
}

export async function campaignDailyReport(db: Database, id: string, period: Period) {
  const [campaign] = await rows<Record<string, unknown>>(
    db,
    sql`SELECT id, slug, name, source, channel, creative, target_path AS "targetPath", status, created_at::text AS "createdAt"
      FROM campaigns WHERE id = ${id}`,
  );
  if (!campaign) return null;
  const s = ts(period.startUtc);
  const e = ts(period.endUtc);
  const daily = await rows<{
    day: string;
    clicks: number;
    uniqueVisitors: number;
    registrations: number;
  }>(
    db,
    sql`SELECT d.day::text AS day,
      (SELECT count(*)::int FROM analytics_events x WHERE x.type = 'campaign_click' AND x.campaign_id = ${id}
        AND (x.occurred_at AT TIME ZONE 'Europe/Moscow')::date = d.day) AS clicks,
      (SELECT count(DISTINCT x.visitor_id)::int FROM analytics_events x WHERE x.type = 'campaign_click' AND x.campaign_id = ${id}
        AND (x.occurred_at AT TIME ZONE 'Europe/Moscow')::date = d.day) AS "uniqueVisitors",
      (SELECT count(*)::int FROM user_attributions ua JOIN users u ON u.id = ua.user_id WHERE ua.campaign_id = ${id}
        AND (u.created_at AT TIME ZONE 'Europe/Moscow')::date = d.day) AS registrations
      FROM generate_series(${period.from}::date, ${period.to}::date, interval '1 day') AS d(day)
      WHERE d.day >= (${s} AT TIME ZONE 'Europe/Moscow')::date AND d.day < (${e} AT TIME ZONE 'Europe/Moscow')::date
      ORDER BY 1`,
  );
  return { campaign, daily: daily.map((d) => ({ ...d, day: d.day.slice(0, 10) })) };
}
