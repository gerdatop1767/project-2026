import type { Database } from '@zybrilka/db';
import { sql } from 'drizzle-orm';
import { percentile, type RequestMetrics } from '../../../plugins/requestMetrics.js';
import { one } from './common.js';

/**
 * Техническое состояние. Only what the API process can know reliably;
 * anything else is reported as unknown ("Нет данных"), never guessed.
 * No secrets, environment values, file system or shell access, and no
 * restart button — this page only reads.
 */
export async function healthReport(db: Database, metrics: RequestMetrics, version: string) {
  const now = Date.now();
  let dbStatus: 'ok' | 'down' = 'ok';
  let dbLatencyMs: number | null = null;
  const t0 = performance.now();
  try {
    await db.execute(sql`select 1`);
    dbLatencyMs = Math.round((performance.now() - t0) * 10) / 10;
  } catch {
    dbStatus = 'down';
  }
  const hour = metrics.recent(now - 60 * 60 * 1000);
  const quarter = hour.filter((s) => s.at >= now - 15 * 60 * 1000);
  const errors = new Map<
    string,
    { route: string; method: string; status: number; count: number }
  >();
  for (const s of hour) {
    if (s.status < 500) continue;
    const key = `${s.method} ${s.route} ${s.status}`;
    const entry = errors.get(key) ?? {
      route: s.route,
      method: s.method,
      status: s.status,
      count: 0,
    };
    entry.count++;
    errors.set(key, entry);
  }
  const route = (prefix: string) => hour.filter((s) => s.route.startsWith(prefix));
  const checks = route('/api/v1/tasks/:id/attempt');
  const auth = route('/api/v1/auth/');
  const vk = auth.filter((s) => s.route.includes('/vk/'));
  const failed = (list: typeof hour, from = 400) => list.filter((s) => s.status >= from).length;

  let analytics: { lastEventAt: string | null } = { lastEventAt: null };
  let lastContentUpdate: string | null = null;
  if (dbStatus === 'ok') {
    analytics = await one<{ lastEventAt: string | null }>(
      db,
      sql`SELECT max(occurred_at)::text AS "lastEventAt" FROM analytics_events`,
    );
    lastContentUpdate = (
      await one<{ at: string | null }>(db, sql`SELECT max(updated_at)::text AS at FROM tasks`)
    ).at;
  }

  return {
    api: {
      status: 'ok' as const,
      version,
      processStartedAt: new Date(metrics.startedAt).toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    },
    database: { status: dbStatus, latencyMs: dbLatencyMs },
    requests: {
      sinceStart: { total: metrics.total, serverErrors: metrics.serverErrors },
      lastHour: {
        total: hour.length,
        serverErrors: failed(hour, 500),
        errorRate: hour.length > 0 ? failed(hour, 500) / hour.length : null,
      },
      latencyLast15m: {
        samples: quarter.length,
        p50: percentile(
          quarter.map((s) => s.ms),
          50,
        ),
        p95: percentile(
          quarter.map((s) => s.ms),
          95,
        ),
      },
      topErrors: [...errors.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    },
    answerChecks: {
      lastHour: checks.length,
      rejected: failed(checks, 400),
      serverErrors: failed(checks, 500),
    },
    auth: {
      lastHour: auth.length,
      failed: failed(auth),
      serverErrors: failed(auth, 500),
      vkRequests: vk.length,
      vkFailed: failed(vk),
    },
    analytics,
    content: { lastTaskUpdate: lastContentUpdate },
    // Not observable from the API process — reported as unknown on purpose.
    unknown: {
      worker: 'Нет данных: фоновый процесс не сообщает о себе в API',
      backups: 'Нет данных: резервные копии делаются вне приложения',
      imports:
        'Нет данных: импорт заданий выполняется скриптами при деплое (sync-content), их журнал — в логах контейнера',
    },
  };
}
