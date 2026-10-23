import { schema } from '@zybrilka/db';
import type { Database } from '@zybrilka/db';
import rateLimit from '@fastify/rate-limit';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { rejectCrossSiteWrites } from '../../plugins/authSession.js';
import type { RequestMetrics } from '../../plugins/requestMetrics.js';
import { requireAdmin } from './access.js';
import { writeAudit } from './audit.js';
import { PeriodError, periodQuerySchema, resolvePeriod, type Period } from './period.js';
import { computeAlerts } from './reports/alerts.js';
import {
  campaignCreateSchema,
  campaignDailyReport,
  campaignsReport,
  campaignStatusSchema,
  createCampaign,
  setCampaignStatus,
} from './reports/campaigns.js';
import { rows } from './reports/common.js';
import {
  complaintCardReport,
  complaintListQuerySchema,
  complaintsListReport,
  complaintUpdateSchema,
  DuplicateTargetError,
  updateComplaint,
} from './reports/complaints.js';
import {
  subjectDetailReport,
  subjectsReport,
  taskCardReport,
  taskListQuerySchema,
  tasksListReport,
} from './reports/content.js';
import { exportCsv, exportKinds } from './reports/export.js';
import { funnelReport, retentionReport, thresholdsReport } from './reports/funnels.js';
import { growthReport } from './reports/growth.js';
import { healthReport } from './reports/health.js';
import { overviewReport } from './reports/overview.js';
import { qualityReport } from './reports/quality.js';
import { streaksReport } from './reports/streaks.js';
import {
  adminSettingsSchema,
  loadSettings,
  notificationChannels,
  saveSettings,
} from './reports/settings.js';
import { userCardReport, userListQuerySchema, usersListReport } from './reports/users.js';
import {
  adminNotificationSettingsSchema,
  loadNotificationSettings,
  notificationsReport,
  saveNotificationSettings,
} from './reports/notifications.js';
import { enqueueNotification } from '../notifications/outbox.js';

export interface AdminRoutesOptions {
  db: Database;
  config: Config;
  metrics: RequestMetrics;
  version: string;
}

const idParams = z.object({ id: z.uuid() });
const subjectParams = z.object({ id: z.string().regex(/^[a-z_]{1,32}$/) });

class BadInput extends Error {
  constructor(public code: string) {
    super(code);
  }
}

function parse<T extends z.ZodType>(
  schemaDef: T,
  value: unknown,
  code = 'invalid_query',
): z.infer<T> {
  const result = schemaDef.safeParse(value);
  if (!result.success) throw new BadInput(code);
  return result.data;
}

function periodOf(request: FastifyRequest): Period {
  return resolvePeriod(parse(periodQuerySchema, request.query));
}

function describePeriod(p: Period) {
  return {
    preset: p.preset,
    from: p.from,
    to: p.to,
    days: p.days,
    granularity: p.granularity,
    timezone: p.timezone,
    previous: { from: p.previous.from, to: p.previous.to },
  };
}

/**
 * /api/v1/admin/* — the owner-only admin API (docs/ADMIN.md). Every route
 * registered in this scope runs behind `requireAdmin` (401/403 before any
 * handler, body parsing or query), the cross-site write guard and a
 * per-account rate limit. Writes need `confirm: true` where they change
 * what users see, and every write and export goes to the audit log.
 * Errors never echo internals: 5xx is a bare `internal_error`.
 */
export const adminRoutes: FastifyPluginAsync<AdminRoutesOptions> = async (
  app,
  { db, config, metrics, version },
) => {
  await app.register(rateLimit, {
    global: true,
    max: 240,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.sessionUserId ?? request.ip,
  });
  app.addHook('onRequest', requireAdmin(db, config.ADMIN_OWNER_USER_IDS));
  app.addHook('onRequest', rejectCrossSiteWrites);

  app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, request, reply) => {
    if (error instanceof BadInput) return reply.code(400).send({ error: error.code });
    if (error instanceof PeriodError) return reply.code(400).send({ error: error.message });
    if (error.statusCode === 429) return reply.code(429).send({ error: 'rate_limited' });
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: 'bad_request' });
    }
    request.log.error({ err: error }, 'admin request failed');
    return reply.code(500).send({ error: 'internal_error' });
  });

  const actor = (request: FastifyRequest) => request.sessionUserId!;
  const audit = (
    request: FastifyRequest,
    entry: Omit<Parameters<typeof writeAudit>[1], 'actorUserId'>,
  ) => writeAudit(db, { ...entry, actorUserId: actor(request) });
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found' });

  app.get('/admin/me', async (request) => ({
    userId: request.sessionUserId,
    role: 'owner' as const,
  }));

  // ── Обзор / рост ──────────────────────────────────────────────────────
  app.get('/admin/overview', async (request) => {
    const period = periodOf(request);
    return { period: describePeriod(period), ...(await overviewReport(db, period)) };
  });
  app.get('/admin/growth', async (request) => {
    const period = periodOf(request);
    return { period: describePeriod(period), ...(await growthReport(db, period)) };
  });

  // ── Задания и предметы ────────────────────────────────────────────────
  app.get('/admin/content/subjects', async (request) => {
    const period = periodOf(request);
    return { period: describePeriod(period), items: await subjectsReport(db, period) };
  });
  app.get('/admin/content/subjects/:id', async (request, reply) => {
    const { id } = parse(subjectParams, request.params, 'invalid_id');
    const period = periodOf(request);
    const report = await subjectDetailReport(db, id, period);
    return report ? { period: describePeriod(period), ...report } : notFound(reply);
  });
  app.get('/admin/content/tasks', async (request) => {
    const query = request.query as Record<string, unknown>;
    const period = periodOf(request);
    const filters = parse(taskListQuerySchema, query);
    return { period: describePeriod(period), ...(await tasksListReport(db, period, filters)) };
  });
  app.get('/admin/content/tasks/:id', async (request, reply) => {
    const { id } = parse(idParams, request.params, 'invalid_id');
    const period = periodOf(request);
    const card = await taskCardReport(db, id, period);
    return card ? { period: describePeriod(period), ...card } : notFound(reply);
  });
  const taskStatusBody = z.object({
    status: z.enum(schema.taskStatuses),
    confirm: z.literal(true),
  });
  app.post('/admin/content/tasks/:id/status', async (request, reply) => {
    const { id } = parse(idParams, request.params, 'invalid_id');
    const body = parse(taskStatusBody, request.body, 'invalid_body');
    const [before] = await db
      .select({ status: schema.tasks.status })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, id));
    if (!before) return notFound(reply);
    await db.transaction(async (tx) => {
      await tx
        .update(schema.tasks)
        .set({ status: body.status, updatedAt: new Date() })
        .where(eq(schema.tasks.id, id));
      await writeAudit(tx, {
        actorUserId: actor(request),
        action: 'task.status_changed',
        objectType: 'task',
        objectId: id,
        result: 'ok',
        details: { from: before.status, to: body.status },
      });
    });
    return { id, status: body.status, previousStatus: before.status };
  });

  // ── Пользователи ─────────────────────────────────────────────────────
  app.get('/admin/users', async (request) =>
    usersListReport(db, parse(userListQuerySchema, request.query)),
  );
  app.get('/admin/users/:id', async (request, reply) => {
    const { id } = parse(idParams, request.params, 'invalid_id');
    const card = await userCardReport(db, id);
    return card ?? notFound(reply);
  });
  app.post('/admin/users/:id/revoke-sessions', async (request, reply) => {
    const { id } = parse(idParams, request.params, 'invalid_id');
    parse(z.object({ confirm: z.literal(true) }), request.body, 'invalid_body');
    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, id));
    if (!user) return notFound(reply);
    if (id === actor(request)) return reply.code(400).send({ error: 'cannot_revoke_own_sessions' });
    const revoked = await db
      .delete(schema.authSessions)
      .where(and(eq(schema.authSessions.userId, id), gt(schema.authSessions.expiresAt, new Date())))
      .returning({ id: schema.authSessions.id });
    await audit(request, {
      action: 'user.sessions_revoked',
      objectType: 'user',
      objectId: id,
      result: 'ok',
      details: { sessions: revoked.length },
    });
    return { revoked: revoked.length };
  });

  // ── Воронки и удержание ──────────────────────────────────────────────
  app.get('/admin/funnels', async (request) => {
    const period = periodOf(request);
    return { period: describePeriod(period), ...(await funnelReport(db, period)) };
  });
  app.get('/admin/thresholds', async (request) => {
    const period = periodOf(request);
    return { period: describePeriod(period), ...(await thresholdsReport(db, period)) };
  });
  const retentionQuery = z.object({
    cohort: z.enum(['week', 'month']).default('week'),
    basis: z.enum(['registration', 'first_activity']).default('registration'),
    count: z.coerce.number().int().min(2).max(26).default(12),
  });
  app.get('/admin/retention', async (request) =>
    retentionReport(db, parse(retentionQuery, request.query)),
  );

  // ── Серии ────────────────────────────────────────────────────────────
  app.get('/admin/streaks', async (request) => {
    const period = periodOf(request);
    return { period: describePeriod(period), ...(await streaksReport(db, period)) };
  });

  // ── Кампании и ссылки ────────────────────────────────────────────────
  const linkFor = (slug: string) => ({
    web: new URL(`/api/v1/go/${slug}`, config.WEB_BASE_URL).toString(),
    telegramStartParam: slug,
  });
  app.get('/admin/campaigns', async (request) => {
    const period = periodOf(request);
    const { archived } = parse(z.object({ archived: z.enum(['0', '1']).default('0') }), {
      archived: (request.query as Record<string, unknown>).archived,
    });
    const report = await campaignsReport(db, period, { includeArchived: archived === '1' });
    return {
      period: describePeriod(period),
      ...report,
      items: report.items.map((item) => ({ ...item, link: linkFor(String(item.slug)) })),
    };
  });
  app.post('/admin/campaigns', async (request, reply) => {
    const body = campaignCreateSchema.safeParse(request.body);
    if (!body.success) {
      const targetIssue = body.error.issues.some((i) => i.message === 'target_not_allowed');
      return reply.code(400).send({ error: targetIssue ? 'target_not_allowed' : 'invalid_body' });
    }
    const campaign = await createCampaign(db, actor(request), body.data);
    await audit(request, {
      action: 'campaign.created',
      objectType: 'campaign',
      objectId: campaign.id,
      result: 'ok',
      details: { name: campaign.name, source: campaign.source, targetPath: campaign.targetPath },
    });
    return reply.code(201).send({ ...campaign, link: linkFor(campaign.slug) });
  });
  app.get('/admin/campaigns/:id', async (request, reply) => {
    const { id } = parse(idParams, request.params, 'invalid_id');
    const period = periodOf(request);
    const report = await campaignDailyReport(db, id, period);
    if (!report) return notFound(reply);
    return {
      period: describePeriod(period),
      ...report,
      link: linkFor(String(report.campaign.slug)),
    };
  });
  app.patch('/admin/campaigns/:id/status', async (request, reply) => {
    const { id } = parse(idParams, request.params, 'invalid_id');
    const body = parse(campaignStatusSchema, request.body, 'invalid_body');
    const changed = await setCampaignStatus(db, id, body.status);
    if (!changed) return notFound(reply);
    await audit(request, {
      action: 'campaign.status_changed',
      objectType: 'campaign',
      objectId: id,
      result: 'ok',
      details: { from: changed.before.status, to: changed.after.status },
    });
    return changed.after;
  });

  // ── Жалобы ───────────────────────────────────────────────────────────
  app.get('/admin/complaints', async (request) =>
    complaintsListReport(db, parse(complaintListQuerySchema, request.query)),
  );
  app.get('/admin/complaints/:id', async (request, reply) => {
    const { id } = parse(idParams, request.params, 'invalid_id');
    return (await complaintCardReport(db, id, config.WEB_BASE_URL)) ?? notFound(reply);
  });
  app.patch('/admin/complaints/:id', async (request, reply) => {
    const { id } = parse(idParams, request.params, 'invalid_id');
    const patch = parse(complaintUpdateSchema, request.body, 'invalid_body');
    let changed: Awaited<ReturnType<typeof updateComplaint>>;
    try {
      changed = await updateComplaint(db, id, patch, actor(request));
    } catch (error) {
      if (error instanceof DuplicateTargetError) throw new BadInput(error.code);
      throw error;
    }
    if (!changed) return notFound(reply);
    const details: Record<string, unknown> = {};
    if (changed.status && changed.status !== changed.before.status) {
      details.status = { from: changed.before.status, to: changed.status };
    }
    if (patch.internalComment !== undefined) details.internalCommentChanged = true;
    if (patch.duplicateOf !== undefined) {
      details.duplicateOf = changed.after.duplicateOfId;
    }
    await audit(request, {
      action: 'complaint.updated',
      objectType: 'complaint',
      objectId: id,
      result: 'ok',
      details,
    });
    return changed.after;
  });

  // ── Качество, техсостояние, оповещения ───────────────────────────────
  app.get('/admin/quality', async (request) => {
    const period = periodOf(request);
    return {
      period: describePeriod(period),
      ...(await qualityReport(db, period, await loadSettings(db))),
    };
  });
  app.get('/admin/health', async () => healthReport(db, metrics, version));
  app.get('/admin/alerts', async () => ({
    ...(await computeAlerts(db, metrics, await loadSettings(db))),
    channels: notificationChannels(Boolean(config.TELEGRAM_BOT_TOKEN)),
    notObservable: ['import_failure'],
  }));

  // ── Управление ───────────────────────────────────────────────────────
  const auditQuery = z.object({
    action: z
      .string()
      .max(64)
      .regex(/^[a-z_.]*$/)
      .optional(),
    objectType: z.enum(['task', 'complaint', 'campaign', 'user', 'settings', 'export']).optional(),
    objectId: z.string().max(64).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(10).max(100).default(50),
  });
  app.get('/admin/audit', async (request) => {
    const q = parse(auditQuery, request.query);
    const where = sql.join(
      [
        sql`true`,
        ...(q.action ? [sql`l.action = ${q.action}`] : []),
        ...(q.objectType ? [sql`l.object_type = ${q.objectType}`] : []),
        ...(q.objectId ? [sql`l.object_id = ${q.objectId}`] : []),
      ],
      sql` AND `,
    );
    const [total] = await rows<{ n: number }>(
      db,
      sql`SELECT count(*)::int AS n FROM admin_audit_log l WHERE ${where}`,
    );
    const items = await rows<Record<string, unknown>>(
      db,
      sql`SELECT l.id, l.actor_user_id AS "actorUserId", l.action, l.object_type AS "objectType", l.object_id AS "objectId",
        l.result, l.details, l.created_at::text AS "createdAt"
        FROM admin_audit_log l WHERE ${where} ORDER BY l.created_at DESC, l.id
        LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
    );
    return { total: total?.n ?? 0, page: q.page, pageSize: q.pageSize, items };
  });
  app.get('/admin/settings', async () => ({
    settings: await loadSettings(db),
    defaults: adminSettingsSchema.parse({}),
    channels: notificationChannels(Boolean(config.TELEGRAM_BOT_TOKEN)),
    integrations: {
      yandexWebmaster: 'not_connected',
      googleSearchConsole: 'not_connected',
    },
  }));
  app.put('/admin/settings', async (request) => {
    const next = parse(adminSettingsSchema, request.body, 'invalid_body');
    const before = await loadSettings(db);
    await saveSettings(db, next);
    await audit(request, {
      action: 'settings.updated',
      objectType: 'settings',
      objectId: 'admin.settings',
      result: 'ok',
      details: { before, after: next },
    });
    return { settings: next };
  });

  // ── Уведомления в Telegram (только владельцу) ─────────────────────────
  app.get('/admin/notifications', async () =>
    notificationsReport(db, config.ADMIN_OWNER_USER_IDS, Boolean(config.TELEGRAM_BOT_TOKEN)),
  );
  app.put('/admin/notifications', async (request) => {
    const next = parse(adminNotificationSettingsSchema.strict(), request.body, 'invalid_body');
    const before = await loadNotificationSettings(db);
    await saveNotificationSettings(db, next);
    await audit(request, {
      action: 'notifications.updated',
      objectType: 'settings',
      objectId: 'admin.notifications',
      result: 'ok',
      details: { before, after: next },
    });
    return { settings: next };
  });
  app.post(
    '/admin/notifications/test',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      await enqueueNotification(db, request.log, {
        kind: 'test',
        data: { at: new Date().toISOString() },
      });
      await audit(request, {
        action: 'notifications.test',
        objectType: 'settings',
        objectId: 'admin.notifications',
        result: 'ok',
      });
      return reply.code(202).send({ queued: true });
    },
  );

  // ── CSV ──────────────────────────────────────────────────────────────
  app.get('/admin/export/:kind', async (request, reply) => {
    const { kind } = parse(z.object({ kind: z.enum(exportKinds) }), request.params, 'invalid_kind');
    const period = periodOf(request);
    const { csv, rows: count, truncated } = await exportCsv(db, kind, period, request.query);
    await audit(request, {
      action: 'export.csv',
      objectType: 'export',
      objectId: kind,
      result: 'ok',
      details: { from: period.from, to: period.to, rows: count, truncated },
    });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header(
        'content-disposition',
        `attachment; filename="zybrilka-${kind}-${period.from}_${period.to}.csv"`,
      )
      .send(csv);
  });
};
