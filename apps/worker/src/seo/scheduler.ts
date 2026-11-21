import {
  enqueueSeoTask,
  ensureSeoDefaults,
  gateReasonText,
  loadSeoSettings,
  publishSeoArticle,
  schema,
  writeSeoLog,
} from '@zybrilka/db';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { analyticsHandlers } from './agents/index.js';
import { mskDate, type SeoDeps } from './deps.js';
import { SeoQueue, type TaskHandler } from './queue.js';
import { PENDING } from './ai.js';
import { taskScopedFetch } from './taskScope.js';

export const SEO_HEARTBEAT_KEY = 'seo.agent.heartbeat';

/** Moscow HH:MM of `d`. */
function mskTime(d: Date) {
  return new Date(d.getTime() + 3 * 3600_000).toISOString().slice(11, 16);
}

/** ISO week id (Moscow), e.g. 2026-W47. */
export function isoWeek(d: Date): string {
  const msk = new Date(d.getTime() + 3 * 3600_000);
  const t = new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * The daily/weekly plan. Each step is an idempotent queue task keyed by
 * the day/week, so a restart, a second worker or a manual run on the same
 * day never duplicates work.
 */
export function cycleHandlers(): Record<string, TaskHandler> {
  return {
    cycle_daily: async (ctx) => {
      const day = String(ctx.task.payload.day ?? ctx.task.idempotencyKey);
      await ctx.enqueue({
        kind: 'sync_metrics',
        agent: 'analytics',
        key: `sync_metrics:${day}`,
        priority: 90,
      });
      await ctx.enqueue({
        kind: 'score_topics',
        agent: 'research',
        key: `score_topics:${day}`,
        priority: 75,
      });
      await ctx.enqueue({
        kind: 'research',
        agent: 'research',
        key: `research:${day}`,
        payload: { planWriting: true },
        priority: 70,
      });
      await ctx.log(
        'cycle.daily',
        `Дневной цикл ${day}: синхронизация метрик, оценка тем, исследование и план статей`,
      );
    },
    cycle_weekly: async (ctx) => {
      const week = String(ctx.task.payload.week ?? ctx.task.idempotencyKey);
      await ctx.enqueue({
        kind: 'sync_metrics',
        agent: 'analytics',
        key: `sync_metrics_weekly:${week}`,
        payload: { days: 28 },
        priority: 90,
      });
      await ctx.enqueue({
        kind: 'technical_audit',
        agent: 'technical',
        key: `technical_audit:${week}`,
        priority: 60,
      });
      await ctx.enqueue({
        kind: 'competitors',
        agent: 'competitor',
        key: `competitors:${week}`,
        priority: 40,
      });
      await ctx.enqueue({
        kind: 'weekly_strategy',
        agent: 'strategy',
        key: `weekly_strategy:${week}`,
        priority: 50,
        runAfter: new Date(Date.now() + 30 * 60_000),
      });
      await ctx.log('cycle.weekly', `Недельный цикл ${week}: аудит, конкуренты, стратегия`);
    },
  };
}

export class SeoScheduler {
  readonly queue: SeoQueue;
  constructor(
    private readonly deps: SeoDeps,
    queueOptions: Partial<
      Pick<
        ConstructorParameters<typeof SeoQueue>[0],
        'leaseMs' | 'heartbeatMs' | 'taskTimeoutMs' | 'backoffBaseMs'
      >
    > = {},
  ) {
    // Agents' HTTP calls are cancelled together with their task (timeout / stop).
    const agentDeps: SeoDeps = { ...deps, fetch: taskScopedFetch(deps.fetch) };
    this.queue = new SeoQueue({
      db: deps.db,
      logger: deps.logger,
      now: deps.now,
      handlers: { ...cycleHandlers(), ...analyticsHandlers(agentDeps) },
      ...queueOptions,
    });
  }

  /**
   * Housekeeping, safe to run any time (also during an emergency stop):
   * - an AI budget reservation older than an hour belongs to a worker that
   *   died mid-request: it keeps its worst-case cost (the real spend is
   *   unknown, so the budget errs on the safe side) and is marked abandoned;
   * - an article left in «Исследование»/«Генерация» with no queued or
   *   running task for it (a crash before this fix, or a lost task) gets
   *   «Ошибка» with the reason, instead of hanging there forever.
   */
  async sweep() {
    const { db } = this.deps;
    const now = this.deps.now();
    await db
      .update(schema.seoAiUsage)
      .set({ error: 'abandoned' })
      .where(
        and(
          eq(schema.seoAiUsage.error, PENDING),
          lte(schema.seoAiUsage.at, new Date(now.getTime() - 3600_000)),
        ),
      );
    const stuck = await db
      .update(schema.seoArticles)
      .set({
        status: 'error',
        error: 'Генерация прервалась без активной задачи — запустите «Написать» ещё раз',
        updatedAt: now,
      })
      .where(
        and(
          inArray(schema.seoArticles.status, ['research', 'generating']),
          lte(schema.seoArticles.updatedAt, new Date(now.getTime() - 30 * 60_000)),
          sql`NOT EXISTS (SELECT 1 FROM seo_tasks t WHERE t.article_id = ${schema.seoArticles.id}
                AND t.status IN ('queued', 'running'))`,
        ),
      )
      .returning({ id: schema.seoArticles.id, title: schema.seoArticles.title });
    for (const a of stuck) {
      await writeSeoLog(db, {
        agent: 'content',
        level: 'warn',
        action: 'article.stuck_recovered',
        message: `«${a.title}»: генерация прервалась, статья переведена в «Ошибка»`,
        articleId: a.id,
      });
    }
    return { stuckArticles: stuck.length };
  }

  async init() {
    await ensureSeoDefaults(this.deps.db);
    // Record whether the AI key exists (the admin shows it; the key itself never leaves the env).
    const status = this.deps.ai.configured ? 'connected' : 'not_configured';
    await this.deps.db
      .insert(schema.seoIntegrations)
      .values({ kind: 'anthropic', status, config: {} })
      .onConflictDoUpdate({
        target: schema.seoIntegrations.kind,
        set: { status, updatedAt: new Date() },
      });
    await this.queue.recoverExpired();
  }

  /** Runs every minute. */
  async tick() {
    const { db } = this.deps;
    const now = this.deps.now();
    await this.sweep();
    const settings = await loadSeoSettings(db);
    await db
      .insert(schema.appSettings)
      .values({
        key: SEO_HEARTBEAT_KEY,
        value: {
          at: now.toISOString(),
          enabled: settings.enabled,
          stopped: settings.emergencyStop,
          ai: this.deps.ai.configured,
        },
      })
      .onConflictDoUpdate({
        target: schema.appSettings.key,
        set: {
          value: {
            at: now.toISOString(),
            enabled: settings.enabled,
            stopped: settings.emergencyStop,
            ai: this.deps.ai.configured,
          },
          updatedAt: now,
        },
      });
    if (settings.emergencyStop) return;

    const day = mskDate(now);
    if (settings.enabled && mskTime(now) >= settings.dailyRunTime) {
      if (
        await enqueueSeoTask(db, {
          kind: 'cycle_daily',
          agent: 'system',
          idempotencyKey: `cycle_daily:${day}`,
          payload: { day },
          priority: 95,
        })
      ) {
        // New day: tasks parked by yesterday's daily budget may run again.
        await db
          .update(schema.seoTasks)
          .set({ status: 'queued', runAfter: now, error: null })
          .where(
            and(eq(schema.seoTasks.status, 'blocked'), eq(schema.seoTasks.error, 'budget_daily')),
          );
        const isMonday = new Date(now.getTime() + 3 * 3600_000).getUTCDay() === 1;
        if (isMonday) {
          const week = isoWeek(now);
          await enqueueSeoTask(db, {
            kind: 'cycle_weekly',
            agent: 'system',
            idempotencyKey: `cycle_weekly:${week}`,
            payload: { week },
            priority: 94,
          });
        }
      }
    }
    // Tasks parked because the key was missing: run once it is set.
    if (this.deps.ai.configured) {
      await db
        .update(schema.seoTasks)
        .set({ status: 'queued', runAfter: now, error: null })
        .where(
          and(eq(schema.seoTasks.status, 'blocked'), eq(schema.seoTasks.error, 'not_configured')),
        );
    }
    await this.publishDue();
    await this.distributeNew();
  }

  /** Scheduled articles whose time came (auto mode or scheduled by the owner). */
  async publishDue() {
    const { db } = this.deps;
    const settings = await loadSeoSettings(db);
    if (settings.publishingPaused) return;
    const due = await db
      .select({ id: schema.seoArticles.id, title: schema.seoArticles.title })
      .from(schema.seoArticles)
      .where(
        and(
          eq(schema.seoArticles.status, 'scheduled'),
          lte(schema.seoArticles.scheduledFor, this.deps.now()),
        ),
      )
      .limit(5);
    for (const a of due) {
      const out = await publishSeoArticle(db, a.id, { kind: 'agent' });
      if (!out.ok && out.reason === 'fact_check') {
        // Edited after scheduling, or the check no longer holds: back to the
        // owner (not retried every tick, not published).
        await db
          .update(schema.seoArticles)
          .set({ status: 'review', scheduledFor: null, updatedAt: this.deps.now() })
          .where(and(eq(schema.seoArticles.id, a.id), eq(schema.seoArticles.status, 'scheduled')));
        await writeSeoLog(db, {
          agent: 'content',
          level: 'warn',
          action: 'article.publish_blocked',
          message: `«${a.title}» не опубликована — гейт публикации: ${gateReasonText(out.gate.reasons)}. Статья возвращена на проверку`,
          articleId: a.id,
          details: { reasons: out.gate.reasons },
        });
      } else if (!out.ok) {
        await writeSeoLog(db, {
          agent: 'content',
          level: 'warn',
          action: 'article.publish_skipped',
          message: `«${a.title}» не опубликована: ${out.reason}`,
          articleId: a.id,
        });
      }
    }
  }

  /** Newly published articles get distribution tasks (once per article). */
  async distributeNew() {
    const { db } = this.deps;
    const settings = await loadSeoSettings(db);
    if (!settings.enabled || settings.mode === 'manual' || settings.maxExternalPostsPerDay === 0)
      return;
    const fresh = await db
      .select({ id: schema.seoArticles.id })
      .from(schema.seoArticles)
      .where(
        and(
          inArray(schema.seoArticles.status, ['published']),
          sql`${schema.seoArticles.publishedAt} > now() - interval '3 days'`,
        ),
      );
    for (const a of fresh) {
      await enqueueSeoTask(db, {
        kind: 'distribute',
        agent: 'distribution',
        idempotencyKey: `distribute:${a.id}`,
        articleId: a.id,
        payload: { articleId: a.id },
        priority: 50,
      });
    }
  }
}
