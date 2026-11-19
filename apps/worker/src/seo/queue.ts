import { randomUUID } from 'node:crypto';
import { loadSeoSettings, schema, writeSeoLog, type Database } from '@zybrilka/db';
import type { SeoAgent } from '@zybrilka/shared';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { rows } from './sql.js';
import { AiBlocked, AiInvalidOutput } from './ai.js';

export type SeoTask = typeof schema.seoTasks.$inferSelect;

export interface TaskContext {
  task: SeoTask;
  /** Enqueue a follow-up task (idempotent by key). */
  enqueue: (t: {
    kind: string;
    agent: SeoAgent;
    key: string;
    payload?: Record<string, unknown>;
    articleId?: string | null;
    priority?: number;
    runAfter?: Date;
  }) => Promise<boolean>;
  log: (
    action: string,
    message: string,
    extra?: {
      level?: 'info' | 'warn' | 'error';
      articleId?: string | null;
      details?: Record<string, unknown>;
    },
  ) => Promise<void>;
}

export type TaskHandler = (ctx: TaskContext) => Promise<Record<string, unknown> | void>;

/** Errors that will not get better by retrying. */
export class PermanentError extends Error {}

const LEASE_MS = 20 * 60_000;
const TASK_TIMEOUT_MS = 15 * 60_000;

/**
 * The SEO agent's queue on Postgres (docs/SEO_CENTER.md §2). Claiming is a
 * single UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED), so two
 * workers never take the same task. A task holds a lease; if the worker
 * dies, `recoverExpired` puts it back. Retries back off 1 / 4 / 16 min.
 */
export class SeoQueue {
  private readonly workerId = `w-${randomUUID().slice(0, 8)}`;

  constructor(
    private readonly opts: {
      db: Database;
      logger: Logger;
      handlers: Partial<Record<string, TaskHandler>>;
      now?: () => Date;
    },
  ) {}

  private now() {
    return this.opts.now?.() ?? new Date();
  }

  /** Leases that expired (worker crash/restart) → back to the queue, counted as an attempt. */
  async recoverExpired() {
    const back = await this.opts.db
      .update(schema.seoTasks)
      .set({ status: 'queued', lockedUntil: null, lockedBy: null, error: 'lease_expired' })
      .where(
        and(eq(schema.seoTasks.status, 'running'), lt(schema.seoTasks.lockedUntil, this.now())),
      )
      .returning({ id: schema.seoTasks.id });
    if (back.length) this.opts.logger.warn({ count: back.length }, 'seo: recovered expired tasks');
    return back.length;
  }

  async claim(): Promise<SeoTask | null> {
    const now = this.now();
    const lease = new Date(now.getTime() + LEASE_MS);
    const [row] = await rows<{ id: string }>(
      this.opts.db,
      sql`UPDATE seo_tasks SET status = 'running', attempts = attempts + 1, locked_until = ${lease.toISOString()},
            locked_by = ${this.workerId}, started_at = ${now.toISOString()}
          WHERE id = (SELECT id FROM seo_tasks WHERE status = 'queued' AND run_after <= ${now.toISOString()}
                      ORDER BY priority DESC, run_after ASC LIMIT 1 FOR UPDATE SKIP LOCKED)
          RETURNING id::text AS id`,
    );
    if (!row) return null;
    const [task] = await this.opts.db
      .select()
      .from(schema.seoTasks)
      .where(eq(schema.seoTasks.id, row.id));
    return task ?? null;
  }

  /** Takes and runs at most `limit` tasks. Returns how many ran. */
  async process(limit = 3): Promise<number> {
    const settings = await loadSeoSettings(this.opts.db);
    if (settings.emergencyStop) return 0;
    await this.recoverExpired();
    let ran = 0;
    for (; ran < limit; ran++) {
      const task = await this.claim();
      if (!task) break;
      await this.runOne(task);
    }
    return ran;
  }

  private context(task: SeoTask): TaskContext {
    const db = this.opts.db;
    return {
      task,
      enqueue: async (t) => {
        const r = await db
          .insert(schema.seoTasks)
          .values({
            kind: t.kind,
            agent: t.agent,
            idempotencyKey: t.key,
            payload: t.payload ?? {},
            articleId: t.articleId ?? null,
            priority: t.priority ?? 50,
            runAfter: t.runAfter ?? this.now(),
            parentId: task.id,
          })
          .onConflictDoNothing()
          .returning({ id: schema.seoTasks.id });
        return r.length > 0;
      },
      log: (action, message, extra) =>
        writeSeoLog(db, {
          agent: task.agent as SeoAgent,
          action,
          message,
          level: extra?.level,
          taskId: task.id,
          articleId: extra?.articleId ?? task.articleId,
          details: extra?.details,
        }),
    };
  }

  async runOne(task: SeoTask) {
    const handler = this.opts.handlers[task.kind];
    const ctx = this.context(task);
    const finish = (set: Partial<typeof schema.seoTasks.$inferInsert>) =>
      this.opts.db
        .update(schema.seoTasks)
        .set({ lockedUntil: null, lockedBy: null, finishedAt: this.now(), ...set })
        .where(eq(schema.seoTasks.id, task.id));
    if (!handler) {
      await finish({ status: 'failed', error: `no handler for ${task.kind}` });
      return;
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        handler(ctx),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`timeout after ${TASK_TIMEOUT_MS / 60000} min`)),
            TASK_TIMEOUT_MS,
          );
        }),
      ]);
      await finish({ status: 'done', result: result ?? {}, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Budget/stop/missing key: not the task's fault — park it, don't burn attempts.
      if (err instanceof AiBlocked && err.reason !== 'refusal') {
        await finish({
          status: 'blocked',
          error: err.reason,
          attempts: Math.max(0, task.attempts - 1),
        });
        await ctx.log(
          'task.blocked',
          `Задача ${task.kind} остановлена: ${blockedText[err.reason]}`,
          { level: 'warn' },
        );
        return;
      }
      const permanent =
        err instanceof PermanentError || (err instanceof AiBlocked && err.reason === 'refusal');
      const retry = !permanent && task.attempts < task.maxAttempts;
      if (retry) {
        const delay = 60_000 * 4 ** (task.attempts - 1) * (err instanceof AiInvalidOutput ? 1 : 1);
        await finish({
          status: 'queued',
          error: message.slice(0, 1000),
          runAfter: new Date(this.now().getTime() + delay),
          finishedAt: null,
        });
      } else {
        await finish({ status: 'failed', error: message.slice(0, 1000) });
      }
      this.opts.logger.warn({ err, kind: task.kind, attempt: task.attempts }, 'seo task failed');
      await ctx.log(
        'task.failed',
        `Ошибка ${task.kind} (попытка ${task.attempts}/${task.maxAttempts})${retry ? ', повторим позже' : ''}: ${message.slice(0, 300)}`,
        {
          level: retry ? 'warn' : 'error',
        },
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

const blockedText: Record<string, string> = {
  emergency_stop: 'аварийная остановка',
  budget_daily: 'исчерпан дневной бюджет AI',
  budget_monthly: 'исчерпан месячный бюджет AI',
  not_configured: 'не задан ANTHROPIC_API_KEY',
};
