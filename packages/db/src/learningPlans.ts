import { localClock, type DayActual, type PlanDayState, type PlanActivity } from '@zybrilka/shared';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import type { Database } from './client.js';
import * as schema from './schema.js';

/**
 * Plan data shared by the API and the worker (docs/learning/PERSONAL-PLANS.md).
 * What a plan day «did» is never stored: it is counted here from `attempts`.
 */
export type LearningPlanRow = typeof schema.learningPlans.$inferSelect;

export async function loadPlanDays(db: Database, planId: string): Promise<PlanDayState[]> {
  const rows = await db
    .select()
    .from(schema.learningPlanDays)
    .where(eq(schema.learningPlanDays.planId, planId))
    .orderBy(asc(schema.learningPlanDays.dayIndex));
  return rows.map((r) => ({
    dayIndex: r.dayIndex,
    date: r.date,
    skillKey: r.skillKey,
    activity: r.activity as PlanActivity,
    targetTasks: r.targetTasks,
    difficulty: Math.min(3, Math.max(1, r.difficulty)) as 1 | 2 | 3,
    skipped: r.skipped,
  }));
}

/**
 * Per plan day: distinct tasks of the day's skill answered on the day's local
 * date (after the plan was created), and how many of them were answered right. Answering one task again
 * and again counts once — repetition cannot fill a day.
 */
export async function planDayActuals(
  db: Database,
  plan: Pick<LearningPlanRow, 'userId' | 'timezone' | 'createdAt'>,
  days: readonly PlanDayState[],
): Promise<Map<number, DayActual>> {
  const out = new Map<number, DayActual>();
  const skills = [...new Set(days.map((d) => d.skillKey).filter((k): k is string => !!k))];
  if (skills.length === 0 || days.length === 0) return out;
  const dates = days.map((d) => d.date).sort();
  // A day boundary in any timezone is within ±14 h of UTC midnight.
  const from = new Date(`${dates[0]}T00:00:00Z`);
  from.setUTCHours(from.getUTCHours() - 14);
  // Answers given before the plan existed never count towards it.
  if (plan.createdAt > from) from.setTime(plan.createdAt.getTime());
  const to = new Date(`${dates[dates.length - 1]}T00:00:00Z`);
  to.setUTCHours(to.getUTCHours() + 38);
  const rows = await db
    .select({
      taskId: schema.attempts.taskId,
      isCorrect: schema.attempts.isCorrect,
      createdAt: schema.attempts.createdAt,
      slug: schema.skills.slug,
    })
    .from(schema.attempts)
    .innerJoin(schema.taskSkills, eq(schema.taskSkills.taskId, schema.attempts.taskId))
    .innerJoin(schema.skills, eq(schema.skills.id, schema.taskSkills.skillId))
    .where(
      and(
        eq(schema.attempts.userId, plan.userId),
        inArray(schema.skills.slug, skills),
        gte(schema.attempts.createdAt, from),
        lt(schema.attempts.createdAt, to),
      ),
    );
  const byKey = new Map<string, Map<string, boolean>>();
  for (const r of rows) {
    const key = `${localDateOf(r.createdAt, plan.timezone)}|${r.slug}`;
    const tasks = byKey.get(key) ?? new Map<string, boolean>();
    tasks.set(r.taskId, (tasks.get(r.taskId) ?? false) || r.isCorrect);
    byKey.set(key, tasks);
  }
  for (const d of days) {
    if (!d.skillKey) continue;
    const tasks = byKey.get(`${d.date}|${d.skillKey}`);
    if (!tasks) continue;
    out.set(d.dayIndex, {
      attempts: tasks.size,
      correct: [...tasks.values()].filter(Boolean).length,
    });
  }
  return out;
}

export function localDateOf(at: Date, timezone: string): string {
  try {
    return localClock(at, timezone).date;
  } catch {
    return localClock(at, 'Europe/Moscow').date;
  }
}

/** The student's timezone: the daily-reminder setting, else Moscow. */
export async function userTimezone(db: Database, userId: string): Promise<string> {
  const [row] = await db
    .select({ timezone: schema.reminderSettings.timezone })
    .from(schema.reminderSettings)
    .where(eq(schema.reminderSettings.userId, userId));
  return row?.timezone ?? 'Europe/Moscow';
}
