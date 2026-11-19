import { randomUUID } from 'node:crypto';
import { loadSeoSettings, schema, writeSeoLog, type Database } from '@zybrilka/db';
import type { SeoAgent } from '@zybrilka/shared';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { rows } from './sql.js';
import { AiBlocked } from './ai.js';
import { runInTaskScope } from './taskScope.js';

export type SeoTask = typeof schema.seoTasks.$inferSelect;
/** A transaction handle (the callback argument of `db.transaction`). */
export type SeoTx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface TaskContext {
  task: SeoTask;
  /** Aborted on timeout or emergency stop; the AI gateway and fetch already honour it. */
  signal: AbortSignal;
  /** True when this run is the task's last allowed attempt. */
  lastAttempt: boolean;
  /**
   * Fenced write: runs `fn` in a transaction that first locks this task's
   * row and checks this worker still owns it (status running, lockedBy = me).
   * A worker that lost its lease gets TaskAborted('lease_lost') and writes
   * nothing — the new owner's result is the only one that lands.
   */
  commit: <T>(fn: (tx: SeoTx) => Promise<T>) => Promise<T>;
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

/** Why a running task was cancelled (AbortSignal.reason). */
export class TaskAborted extends Error {
  constructor(public reasonCode: 'timeout' | 'emergency_stop' | 'lease_lost') {
    super(
      reasonCode === 'timeout'
        ? 'task timed out and was cancelled'
        : reasonCode === 'lease_lost'
          ? 'lease lost: another worker owns the task'
          : 'emergency stop',
    );
  }
}

const DEFAULTS = {
  /** A lease is short and renewed by the heartbeat while the task really runs. */
  leaseMs: 5 * 60_000,
  heartbeatMs: 60_000,
  taskTimeoutMs: 15 * 60_000,
  /** Retry pauses: 1, 4, 16 … minutes. */
  backoffBaseMs: 60_000,
};

/**
 * The SEO agent's queue on Postgres (docs/SEO_CENTER.md §2).
 * - Claiming is one UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED):
 *   two workers never take the same task, a re-delivered task runs once.
 * - A running task holds a short lease that a heartbeat renews while the
 *   handler is alive. Only a dead worker's lease expires, and only then is
 *   the task re-queued (`recoverExpired`) — a live, slow task is never
 *   started a second time in parallel.
 * - Timeout and emergency stop ABORT the handler (AbortSignal reaches the
 *   model request and HTTP calls); the queue waits until the handler has
 *   actually stopped before releasing the task.
 * - Results are written only while this worker still owns the lease.
 */
export class SeoQueue {
  private readonly workerId = `w-${randomUUID().slice(0, 8)}`;

  constructor(
    private readonly opts: {
      db: Database;
      logger: Logger;
      handlers: Partial<Record<string, TaskHandler>>;
      now?: () => Date;
      leaseMs?: number;
      heartbeatMs?: number;
      taskTimeoutMs?: number;
      backoffBaseMs?: number;
    },
  ) {}

  private get cfg() {
    return {
      leaseMs: this.opts.leaseMs ?? DEFAULTS.leaseMs,
      heartbeatMs: this.opts.heartbeatMs ?? DEFAULTS.heartbeatMs,
      taskTimeoutMs: this.opts.taskTimeoutMs ?? DEFAULTS.taskTimeoutMs,
      backoffBaseMs: this.opts.backoffBaseMs ?? DEFAULTS.backoffBaseMs,
    };
  }

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
    const lease = new Date(now.getTime() + this.cfg.leaseMs);
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

  private context(task: SeoTask, signal: AbortSignal): TaskContext {
    const db = this.opts.db;
    return {
      task,
      signal,
      lastAttempt: task.attempts >= task.maxAttempts,
      commit: (fn) =>
        db.transaction(async (tx) => {
          const [own] = await tx
            .select({ id: schema.seoTasks.id })
            .from(schema.seoTasks)
            .where(
              and(
                eq(schema.seoTasks.id, task.id),
                eq(schema.seoTasks.status, 'running'),
                eq(schema.seoTasks.lockedBy, this.workerId),
              ),
            )
            .for('update');
          if (!own) throw new TaskAborted('lease_lost');
          return fn(tx);
        }),
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
    const controller = new AbortController();
    const ctx = this.context(task, controller.signal);
    const db = this.opts.db;
    // Writes the outcome only if this worker still owns the task.
    const finish = (set: Partial<typeof schema.seoTasks.$inferInsert>) =>
      db
        .update(schema.seoTasks)
        .set({ lockedUntil: null, lockedBy: null, finishedAt: this.now(), ...set })
        .where(
          and(
            eq(schema.seoTasks.id, task.id),
            eq(schema.seoTasks.status, 'running'),
            eq(schema.seoTasks.lockedBy, this.workerId),
          ),
        );
    if (!handler) {
      await finish({ status: 'failed', error: `no handler for ${task.kind}` });
      return;
    }

    const { leaseMs, heartbeatMs, taskTimeoutMs, backoffBaseMs } = this.cfg;
    // Heartbeat: renew the lease while the handler lives; abort it on emergency stop.
    let beating = Promise.resolve();
    const heartbeat = setInterval(() => {
      beating = (async () => {
        const renewed = await db
          .update(schema.seoTasks)
          .set({ lockedUntil: new Date(this.now().getTime() + leaseMs) })
          .where(
            and(
              eq(schema.seoTasks.id, task.id),
              eq(schema.seoTasks.status, 'running'),
              eq(schema.seoTasks.lockedBy, this.workerId),
            ),
          )
          .returning({ id: schema.seoTasks.id });
        // Someone else owns the task now (our lease expired and it was re-claimed):
        // stop spending on a result that can no longer be saved.
        if (renewed.length === 0 && !controller.signal.aborted) {
          controller.abort(new TaskAborted('lease_lost'));
          return;
        }
        if (!controller.signal.aborted && (await loadSeoSettings(db)).emergencyStop) {
          controller.abort(new TaskAborted('emergency_stop'));
        }
      })().catch((err: unknown) => this.opts.logger.warn({ err }, 'seo task heartbeat failed'));
    }, heartbeatMs);
    const timer = setTimeout(() => controller.abort(new TaskAborted('timeout')), taskTimeoutMs);

    try {
      // Awaited to the end: after an abort the handler unwinds (its model and
      // HTTP calls reject with the abort) before the task is released.
      const result = await runInTaskScope({ signal: controller.signal, taskId: task.id }, () =>
        handler(ctx),
      );
      if (controller.signal.aborted) throw controller.signal.reason;
      await finish({ status: 'done', result: result ?? {}, error: null });
    } catch (caught) {
      const err = controller.signal.aborted ? (controller.signal.reason as unknown) : caught;
      const message = err instanceof Error ? err.message : String(err);
      // Not ours any more: the new owner records the outcome. Nothing to write.
      if (err instanceof TaskAborted && err.reasonCode === 'lease_lost') {
        this.opts.logger.warn(
          { task: task.id, kind: task.kind },
          'seo task: lease lost, result dropped',
        );
        return;
      }
      // Budget/stop/missing key: not the task's fault — park it, don't burn attempts.
      const blockedReason =
        err instanceof AiBlocked && err.reason !== 'refusal'
          ? err.reason
          : err instanceof TaskAborted && err.reasonCode === 'emergency_stop'
            ? 'emergency_stop'
            : null;
      if (blockedReason) {
        await finish({
          status: 'blocked',
          error: blockedReason,
          attempts: Math.max(0, task.attempts - 1),
        });
        await ctx.log(
          'task.blocked',
          `Задача ${task.kind} остановлена: ${blockedText[blockedReason]}`,
          { level: 'warn' },
        );
        return;
      }
      const permanent =
        err instanceof PermanentError || (err instanceof AiBlocked && err.reason === 'refusal');
      const retry = !permanent && task.attempts < task.maxAttempts;
      if (retry) {
        const delay = backoffBaseMs * 4 ** (task.attempts - 1);
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
        { level: retry ? 'warn' : 'error' },
      );
    } finally {
      clearTimeout(timer);
      clearInterval(heartbeat);
      await beating;
    }
  }
}

const blockedText: Record<string, string> = {
  emergency_stop: 'аварийная остановка',
  budget_daily: 'исчерпан дневной бюджет AI',
  budget_monthly: 'исчерпан месячный бюджет AI',
  not_configured: 'не задан ANTHROPIC_API_KEY',
};
