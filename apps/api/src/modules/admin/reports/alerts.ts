import type { Database } from '@zybrilka/db';
import { sql } from 'drizzle-orm';
import type { RequestMetrics } from '../../../plugins/requestMetrics.js';
import { guestAnswers, one, registeredAttempts } from './common.js';
import type { AdminSettings } from './settings.js';

export interface Alert {
  type:
    | 'service_down'
    | 'solves_drop'
    | 'error_rate'
    | 'complaints_rise'
    | 'accuracy_shift'
    | 'auth_failures';
  severity: 'critical' | 'warning';
  title: string;
  detail: string;
}

/**
 * Оповещения: computed on request from live data — one entry per alert
 * type at most (that is the deduplication), each only above its minimum
 * volume, with the numbers that tripped it. Nothing is sent anywhere: no
 * external channel is connected (see settings.notificationChannels).
 * Import failures are not observable from the API (imports run as deploy
 * scripts), so there is no import alert — the page says so.
 */
export async function computeAlerts(
  db: Database,
  metrics: RequestMetrics,
  settings: AdminSettings,
): Promise<{ alerts: Alert[]; checkedAt: string }> {
  const a = settings.alerts;
  const alerts: Alert[] = [];
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  try {
    await db.execute(sql`select 1`);
  } catch {
    return {
      checkedAt: new Date().toISOString(),
      alerts: [
        {
          type: 'service_down',
          severity: 'critical',
          title: 'База данных недоступна',
          detail: 'API не может выполнить запрос к базе данных.',
        },
      ],
    };
  }

  const answers = await one<{
    last24: number;
    prev7: number;
    correct24: number;
    last30: number;
    correct30: number;
    complaints24: number;
    complaints30: number;
  }>(
    db,
    sql`SELECT
      (SELECT count(*) FROM ${registeredAttempts} x WHERE x.created_at >= now() - interval '24 hours')::int
        + (SELECT count(*) FROM ${guestAnswers} g WHERE g.occurred_at >= now() - interval '24 hours')::int AS last24,
      (SELECT count(*) FROM ${registeredAttempts} x WHERE x.created_at >= now() - interval '8 days' AND x.created_at < now() - interval '24 hours')::int
        + (SELECT count(*) FROM ${guestAnswers} g WHERE g.occurred_at >= now() - interval '8 days' AND g.occurred_at < now() - interval '24 hours')::int AS prev7,
      (SELECT count(*) FROM ${registeredAttempts} x WHERE x.created_at >= now() - interval '24 hours' AND x.is_correct)::int AS correct24,
      (SELECT count(*) FROM ${registeredAttempts} x WHERE x.created_at >= now() - interval '30 days')::int AS last30,
      (SELECT count(*) FROM ${registeredAttempts} x WHERE x.created_at >= now() - interval '30 days' AND x.is_correct)::int AS correct30,
      (SELECT count(*) FROM task_complaints c WHERE c.created_at >= now() - interval '24 hours')::int AS complaints24,
      (SELECT count(*) FROM task_complaints c WHERE c.created_at >= now() - interval '30 days')::int AS complaints30`,
  );

  const dailyAvg = answers.prev7 / 7;
  if (dailyAvg >= a.solvesMinDaily && answers.last24 < dailyAvg * a.solvesDropShare) {
    alerts.push({
      type: 'solves_drop',
      severity: 'warning',
      title: 'Резкое падение решений',
      detail: `За 24 часа ${answers.last24} ответов при среднем ${Math.round(dailyAvg)} в день за прошлую неделю (порог ${pct(a.solvesDropShare)}).`,
    });
  }

  const hour = metrics.recent(Date.now() - 60 * 60 * 1000);
  const errors = hour.filter((s) => s.status >= 500).length;
  if (hour.length >= a.errorMinRequests && errors / hour.length >= a.errorRate) {
    alerts.push({
      type: 'error_rate',
      severity: 'critical',
      title: 'Рост ошибок API',
      detail: `${errors} из ${hour.length} запросов за час завершились ошибкой сервера (${pct(errors / hour.length)}, порог ${pct(a.errorRate)}).`,
    });
  }

  const complaintsAvg = answers.complaints30 / 30;
  if (
    answers.complaints24 >= a.complaintsMin &&
    answers.complaints24 >= complaintsAvg * a.complaintsFactor
  ) {
    alerts.push({
      type: 'complaints_rise',
      severity: 'warning',
      title: 'Рост жалоб',
      detail: `${answers.complaints24} жалоб за 24 часа при среднем ${complaintsAvg.toFixed(1)} в день за 30 дней.`,
    });
  }

  const regs24 = await one<{ n: number }>(
    db,
    sql`SELECT count(*)::int AS n FROM ${registeredAttempts} x WHERE x.created_at >= now() - interval '24 hours'`,
  );
  if (regs24.n >= a.accuracyMinAnswers && answers.last30 >= a.accuracyMinAnswers) {
    const acc24 = answers.correct24 / regs24.n;
    const acc30 = answers.correct30 / answers.last30;
    if (Math.abs(acc24 - acc30) >= a.accuracyShift) {
      alerts.push({
        type: 'accuracy_shift',
        severity: 'warning',
        title: 'Аномальная точность ответов',
        detail: `Точность за 24 часа ${pct(acc24)}, за 30 дней ${pct(acc30)} — возможна ошибка в проверке или в ответах заданий.`,
      });
    }
  }

  const auth = hour.filter(
    (s) => s.route.startsWith('/api/v1/auth/') && s.route !== '/api/v1/auth/me',
  );
  const authFailed = auth.filter((s) => s.status >= 500).length;
  if (auth.length >= a.authMinRequests && authFailed / auth.length >= a.authFailureRate) {
    alerts.push({
      type: 'auth_failures',
      severity: 'critical',
      title: 'Проблемы со входом',
      detail: `${authFailed} из ${auth.length} запросов входа за час завершились ошибкой сервера.`,
    });
  }
  return { alerts, checkedAt: new Date().toISOString() };
}
