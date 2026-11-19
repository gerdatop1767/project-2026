import {
  lastActiveSql,
  loadPlanDays,
  planDayActuals,
  schema,
  type Database,
  type LearningPlanRow,
} from '@zybrilka/db';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  FREQUENCY_RULES,
  PROGRESS_SEND_WINDOW,
  allExamSkills,
  calculateSkillMastery,
  examSkillInfo,
  localClock,
  planControlText,
  planGoalReachedText,
  planProgress,
  planTodayText,
  progressImprovedText,
  skillLevel,
  type NotificationPreferences,
  type ProgressNotificationKind,
} from '@zybrilka/shared';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { progressKeyboard } from '../bot/messages.js';
import { TelegramApiError, type TelegramClient } from '../telegram/client.js';

export interface ProgressNotifierOptions {
  db: Database;
  telegram: TelegramClient;
  logger: Logger;
  siteUrl: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Sends per run. */
  batchSize?: number;
  pauseMs?: number;
}

const DAY = 86_400_000;
const MAX_ATTEMPTS = 5;
const RETRY_GIVE_UP_MS = 6 * 60 * 60_000;
const examKeys = allExamSkills().map((s) => s.key);

type Row = Record<string, unknown>;
const rowsOf = (result: unknown): Row[] =>
  Array.isArray(result) ? (result as Row[]) : ((result as { rows?: Row[] }).rows ?? []);

interface Candidate {
  readonly kind: ProgressNotificationKind;
  readonly dedupKey: string;
  readonly text: string;
  readonly subjectId?: string;
  readonly payload: Record<string, unknown>;
}

export interface ProgressRunResult {
  checked: number;
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Progress and plan messages through the existing bot (docs/learning/
 * PERSONAL-PLANS.md § Уведомления), run in the worker's job loop:
 * - only to a linked, started and unblocked Telegram, with the student's
 *   settings (`notification_preferences`; no row = on, unless notifications
 *   were switched off altogether in the daily-reminder settings);
 * - in the student's local time 10:00–21:00, at most two a day;
 * - each message has a dedup key (plan + day, plan, skill + week) and is
 *   claimed in `progress_notifications` before sending — the same message is
 *   never sent twice, whatever restarts or parallel workers;
 * - Telegram errors as for reminders: a retry for what provably did not
 *   arrive, nothing for what may have been shown, a block marks the chat.
 */
export class ProgressNotifier {
  private readonly batchSize: number;
  private readonly pauseMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly o: ProgressNotifierOptions) {
    this.batchSize = o.batchSize ?? 30;
    this.pauseMs = o.pauseMs ?? 100;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private now() {
    return this.o.now?.() ?? new Date();
  }

  async recoverInterrupted(): Promise<number> {
    const rows = await this.o.db
      .update(schema.progressNotifications)
      .set({ status: 'uncertain', lastError: 'interrupted' })
      .where(eq(schema.progressNotifications.status, 'sending'))
      .returning({ id: schema.progressNotifications.id });
    return rows.length;
  }

  async run(): Promise<ProgressRunResult> {
    const now = this.now();
    const result: ProgressRunResult = { checked: 0, sent: 0, failed: 0, skipped: 0 };
    let budget = this.batchSize;
    budget -= await this.retries(now, result);
    if (budget <= 0) return result;

    // Who can get one: linked + reachable, and something to say — an
    // active plan or answers in the last 14 days.
    const since = new Date(now.getTime() - 14 * DAY).toISOString();
    const candidates = rowsOf(
      await this.o.db.execute(sql`
        SELECT u.id AS user_id, c.chat_id,
          coalesce(r.timezone, 'Europe/Moscow') AS timezone,
          r.enabled AS daily_enabled,
          p.progress_enabled, p.plan_reminders_enabled, p.frequency
        FROM users u
        JOIN auth_identities ai ON ai.user_id = u.id AND ai.provider = 'telegram'
        JOIN telegram_bot_chats c ON c.chat_id::text = ai.provider_user_id AND c.blocked_at IS NULL
        LEFT JOIN reminder_settings r ON r.user_id = u.id
        LEFT JOIN notification_preferences p ON p.user_id = u.id
        WHERE EXISTS (SELECT 1 FROM learning_plans lp WHERE lp.user_id = u.id AND lp.status IN ('active', 'completed')
                        AND lp.updated_at > ${since}::timestamptz)
           OR ${lastActiveSql(sql`u.id`)} > ${since}::timestamptz
        ORDER BY u.id`),
    );
    for (const c of candidates) {
      if (budget <= 0) break;
      result.checked++;
      const prefs = effectivePreferences(c);
      if (!prefs.progressEnabled && !prefs.planRemindersEnabled) continue;
      const userId = String(c.user_id);
      const chatId = Number(c.chat_id);
      let clock: { date: string; minutes: number };
      try {
        clock = localClock(now, String(c.timezone));
      } catch {
        clock = localClock(now, 'Europe/Moscow');
      }
      if (
        clock.minutes < PROGRESS_SEND_WINDOW.fromMinute ||
        clock.minutes >= PROGRESS_SEND_WINDOW.toMinute
      ) {
        continue;
      }
      const [{ n }] = (await this.o.db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.progressNotifications)
        .where(
          and(
            eq(schema.progressNotifications.userId, userId),
            eq(schema.progressNotifications.localDate, clock.date),
            inArray(schema.progressNotifications.status, ['sending', 'sent', 'uncertain', 'retry']),
          ),
        )) as [{ n: number }];
      let quota = FREQUENCY_RULES[prefs.frequency].maxPerDay - n;
      if (quota <= 0) continue;
      const messages = await this.messagesFor(userId, prefs, clock, now);
      for (const m of messages) {
        if (quota <= 0 || budget <= 0) break;
        const claimed = await this.claim(userId, chatId, clock.date, m);
        if (!claimed) continue;
        quota--;
        budget--;
        const outcome = await this.send(claimed, chatId, m, now);
        if (outcome === 'sent') result.sent++;
        else result.failed++;
        if (outcome === 'stop') return result;
        await this.sleep(this.pauseMs);
      }
    }
    return result;
  }

  /** What this student should hear about now, most important first. */
  private async messagesFor(
    userId: string,
    prefs: NotificationPreferences,
    clock: { date: string; minutes: number },
    now: Date,
  ): Promise<Candidate[]> {
    const out: Candidate[] = [];
    const plans = await this.o.db
      .select()
      .from(schema.learningPlans)
      .where(
        and(
          eq(schema.learningPlans.userId, userId),
          inArray(schema.learningPlans.status, ['active', 'completed']),
          gte(schema.learningPlans.updatedAt, new Date(now.getTime() - 14 * DAY)),
        ),
      )
      .orderBy(desc(schema.learningPlans.createdAt));
    for (const plan of plans) {
      out.push(...(await this.planMessages(plan, prefs, clock, now)));
    }
    if (prefs.progressEnabled) {
      out.push(
        ...(await this.improvements(
          userId,
          now,
          clock.date,
          FREQUENCY_RULES[prefs.frequency].improvementPoints,
        )),
      );
    }
    return out;
  }

  private async planMessages(
    plan: LearningPlanRow,
    prefs: NotificationPreferences,
    clock: { date: string; minutes: number },
    now: Date,
  ): Promise<Candidate[]> {
    const days = await loadPlanDays(this.o.db, plan.id);
    if (days.length === 0) return [];
    const actuals = await planDayActuals(this.o.db, plan, days);
    const progress = planProgress(days, actuals, clock.date);
    const focus = plan.focus[0];
    const title = focus ? (examSkillInfo(focus.skillKey)?.title ?? focus.title) : 'план';
    const out: Candidate[] = [];

    let status = plan.status;
    if (status === 'active' && progress.finished) {
      const [done] = await this.o.db
        .update(schema.learningPlans)
        .set({
          status: 'completed',
          completedAt: now,
          updatedAt: now,
          result: { progress, completedOn: clock.date },
        })
        .where(and(eq(schema.learningPlans.id, plan.id), eq(schema.learningPlans.status, 'active')))
        .returning({ status: schema.learningPlans.status });
      if (done) status = 'completed';
    }

    if (status === 'completed' && prefs.progressEnabled && progress.percent >= 70) {
      let attempts = 0;
      let correct = 0;
      for (const d of days) {
        if (focus && d.skillKey !== focus.skillKey) continue;
        const a = actuals.get(d.dayIndex);
        if (a) {
          attempts += a.attempts;
          correct += a.correct;
        }
      }
      const accInPlan = attempts >= 5 ? Math.round((correct / attempts) * 100) : null;
      const delta =
        accInPlan !== null && focus?.accuracy !== null && focus?.accuracy !== undefined
          ? accInPlan - focus.accuracy
          : null;
      out.push({
        kind: 'plan_goal_reached',
        dedupKey: `goal:${plan.id}`,
        subjectId: plan.subjectId,
        text: planGoalReachedText({
          kind: plan.kind,
          title,
          tasks: progress.tasksDone,
          accuracyDelta: delta,
        }),
        payload: { planId: plan.id, tasks: progress.tasksDone, accuracyDelta: delta },
      });
      return out;
    }
    if (status !== 'active') return out;

    const last = days[days.length - 1]!;
    const lastDone = (actuals.get(last.dayIndex)?.attempts ?? 0) >= last.targetTasks;
    if (prefs.progressEnabled && last.date === clock.date && !last.skipped && !lastDone) {
      out.push({
        kind: 'plan_control',
        dedupKey: `control:${plan.id}`,
        subjectId: plan.subjectId,
        text: planControlText({ kind: plan.kind }),
        payload: { planId: plan.id },
      });
    }
    const rules = FREQUENCY_RULES[prefs.frequency];
    if (
      prefs.planRemindersEnabled &&
      rules.planReminders &&
      clock.minutes >= rules.planFromMinute
    ) {
      const today = days.find(
        (d) => d.date === clock.date && d.activity !== 'rest' && !d.skipped && d.skillKey,
      );
      const done = today ? (actuals.get(today.dayIndex)?.attempts ?? 0) : 0;
      if (today && today !== last && done < today.targetTasks) {
        out.push({
          kind: 'plan_today',
          dedupKey: `today:${plan.id}:${today.date}`,
          subjectId: plan.subjectId,
          text: planTodayText({
            title: examSkillInfo(today.skillKey!)?.title ?? title,
            tasks: today.targetTasks - done,
          }),
          payload: { planId: plan.id, dayIndex: today.dayIndex },
        });
      }
    }
    return out;
  }

  /** A skill whose mastery grew by 15+ points against two weeks ago. */
  private async improvements(
    userId: string,
    now: Date,
    date: string,
    improvementPoints: number,
  ): Promise<Candidate[]> {
    const rows = await this.o.db
      .select({
        slug: schema.skills.slug,
        taskId: schema.attempts.taskId,
        isCorrect: schema.attempts.isCorrect,
        createdAt: schema.attempts.createdAt,
        difficulty: schema.tasks.difficulty,
      })
      .from(schema.attempts)
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.attempts.taskId))
      .innerJoin(schema.taskSkills, eq(schema.taskSkills.taskId, schema.attempts.taskId))
      .innerJoin(schema.skills, eq(schema.skills.id, schema.taskSkills.skillId))
      .where(and(eq(schema.attempts.userId, userId), inArray(schema.skills.slug, examKeys)));
    const bySkill = new Map<string, typeof rows>();
    for (const r of rows) bySkill.set(r.slug, [...(bySkill.get(r.slug) ?? []), r]);
    const cutoff = now.getTime() - 14 * DAY;
    const week = isoWeek(date);
    const out: Candidate[] = [];
    for (const [slug, list] of bySkill) {
      const recent = list.filter((r) => r.createdAt.getTime() >= now.getTime() - 7 * DAY);
      if (recent.length < 3) continue;
      const before = calculateSkillMastery(list.filter((r) => r.createdAt.getTime() < cutoff));
      const current = calculateSkillMastery(list);
      const lb = skillLevel(before);
      const lc = skillLevel(current);
      if (lb === 'none' || lb === 'low_data' || lc === 'none' || lc === 'low_data') continue;
      if (current.mastery - before.mastery < improvementPoints) continue;
      const info = examSkillInfo(slug);
      if (!info) continue;
      out.push({
        kind: 'progress_improved',
        dedupKey: `improved:${userId}:${slug}:${week}`,
        subjectId: info.subjectId,
        text: progressImprovedText({
          subjectId: info.subjectId,
          examNumber: info.examNumber,
          title: info.title,
          from: before.mastery,
          to: current.mastery,
        }),
        payload: { skillKey: slug, from: before.mastery, to: current.mastery },
      });
    }
    return out;
  }

  private async claim(
    userId: string,
    chatId: number,
    localDate: string,
    m: Candidate,
  ): Promise<{ id: string; attempts: number } | null> {
    const [row] = await this.o.db
      .insert(schema.progressNotifications)
      .values({
        userId,
        kind: m.kind,
        dedupKey: m.dedupKey,
        chatId,
        localDate,
        payload: { ...m.payload, subjectId: m.subjectId ?? null, text: m.text },
        status: 'sending',
        attempts: 1,
        createdAt: this.now(),
      })
      .onConflictDoNothing()
      .returning({
        id: schema.progressNotifications.id,
        attempts: schema.progressNotifications.attempts,
      });
    return row ?? null;
  }

  private async retries(now: Date, result: ProgressRunResult): Promise<number> {
    const due = await this.o.db
      .select()
      .from(schema.progressNotifications)
      .where(
        and(
          eq(schema.progressNotifications.status, 'retry'),
          sql`${schema.progressNotifications.nextAttemptAt} <= ${now.toISOString()}::timestamptz`,
        ),
      )
      .limit(this.batchSize);
    let used = 0;
    for (const r of due) {
      if (r.createdAt.getTime() < now.getTime() - RETRY_GIVE_UP_MS) {
        await this.finish(r.id, { status: 'failed', lastError: 'gave_up' });
        result.failed++;
        continue;
      }
      const [claimed] = await this.o.db
        .update(schema.progressNotifications)
        .set({ status: 'sending', attempts: sql`${schema.progressNotifications.attempts} + 1` })
        .where(
          and(
            eq(schema.progressNotifications.id, r.id),
            eq(schema.progressNotifications.status, 'retry'),
          ),
        )
        .returning({
          id: schema.progressNotifications.id,
          attempts: schema.progressNotifications.attempts,
        });
      if (!claimed) continue;
      used++;
      const payload = r.payload as { text?: string; subjectId?: string | null };
      const outcome = await this.send(
        claimed,
        r.chatId,
        {
          kind: r.kind as ProgressNotificationKind,
          dedupKey: r.dedupKey,
          text: payload.text ?? '',
          subjectId: payload.subjectId ?? undefined,
          payload: r.payload,
        },
        now,
      );
      if (outcome === 'sent') result.sent++;
      else result.failed++;
      if (outcome === 'stop') return Number.POSITIVE_INFINITY;
    }
    return used;
  }

  private finish(id: string, set: Partial<typeof schema.progressNotifications.$inferInsert>) {
    return this.o.db
      .update(schema.progressNotifications)
      .set(set)
      .where(eq(schema.progressNotifications.id, id));
  }

  private async send(
    row: { id: string; attempts: number },
    chatId: number,
    m: Candidate,
    now: Date,
  ): Promise<'sent' | 'failed' | 'stop'> {
    try {
      await this.o.telegram.sendMessage(chatId, m.text, {
        replyMarkup: progressKeyboard(this.o.siteUrl, m.subjectId),
      });
      await this.finish(row.id, { status: 'sent', sentAt: this.now(), lastError: null });
      return 'sent';
    } catch (error) {
      const kind = error instanceof TelegramApiError ? error.kind : 'unknown';
      const retryIn = (ms: number, code: string) =>
        row.attempts >= MAX_ATTEMPTS
          ? this.finish(row.id, { status: 'failed', lastError: code })
          : this.finish(row.id, {
              status: 'retry',
              lastError: code,
              nextAttemptAt: new Date(now.getTime() + ms),
            });
      let stop = false;
      if (error instanceof TelegramApiError && kind === 'network') {
        stop = true;
        if (error.network?.maybeDelivered === false)
          await retryIn(5 * 60_000 * row.attempts, 'network');
        else await this.finish(row.id, { status: 'uncertain', lastError: 'network_unknown' });
      } else if (error instanceof TelegramApiError && kind === 'rate_limited') {
        stop = true;
        await retryIn(Math.max(error.retryAfter ?? 5, 60) * 1000, 'rate_limited');
      } else if (kind === 'unreachable') {
        await this.finish(row.id, { status: 'unreachable', lastError: 'blocked' });
        await this.o.db
          .update(schema.telegramBotChats)
          .set({ blockedAt: now })
          .where(eq(schema.telegramBotChats.chatId, chatId));
      } else if (kind === 'unauthorized') {
        stop = true;
        await retryIn(30 * 60_000, 'unauthorized');
      } else {
        await this.finish(row.id, {
          status: kind === 'unknown' ? 'uncertain' : 'failed',
          lastError: kind,
        });
      }
      this.o.logger.warn({ kind, attempt: row.attempts }, 'progress notification not delivered');
      return stop ? 'stop' : 'failed';
    }
  }
}

function effectivePreferences(c: Row): NotificationPreferences {
  if (c.progress_enabled !== null && c.progress_enabled !== undefined) {
    return {
      progressEnabled: Boolean(c.progress_enabled),
      planRemindersEnabled: Boolean(c.plan_reminders_enabled),
      frequency: c.frequency === 'important' || c.frequency === 'extended' ? c.frequency : 'normal',
    };
  }
  if (c.daily_enabled === false) {
    return { progressEnabled: false, planRemindersEnabled: false, frequency: 'normal' };
  }
  return DEFAULT_NOTIFICATION_PREFERENCES;
}

/** ISO week «2026-W47» of a calendar date — one improvement message per skill a week. */
function isoWeek(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((d.getTime() - firstThursday.getTime()) / DAY - 3 + ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
