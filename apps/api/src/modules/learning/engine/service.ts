import type { Database } from '@zybrilka/db';
import { schema } from '@zybrilka/db';
import {
  nextActionFor,
  recommendSkills,
  targetDifficultyFor,
  type LearningAnalyticsResponse,
  type LearningOverviewResponse,
  type LearningRecommendationsResponse,
  type PeriodStats,
  type SkillState,
} from '@zybrilka/shared';
import { and, eq } from 'drizzle-orm';
import { buildStudentModel, recentlyPracticedClean } from './model.js';
import { pickTasksForSkill } from './picker.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** «Мой прогресс» / «Навыки»: the whole student model. */
export async function getOverview(
  db: Database,
  userId: string,
  subjectId?: string,
): Promise<LearningOverviewResponse> {
  const model = await buildStudentModel(db, userId);
  return {
    hasProfile: model.hasProfile,
    subjects: subjectId ? model.subjects.filter((s) => s.subjectId === subjectId) : model.subjects,
  };
}

/**
 * Recommendations with concrete tasks: the engine's ranked skills, each with
 * the tasks the picker would serve first for it.
 */
export async function getRecommendations(
  db: Database,
  userId: string,
  options: { subjectId?: string; limit?: number; now?: Date } = {},
): Promise<LearningRecommendationsResponse> {
  const now = options.now ?? new Date();
  const [model, clean] = await Promise.all([
    buildStudentModel(db, userId, now),
    recentlyPracticedClean(db, userId, now),
  ]);
  const scoped = options.subjectId
    ? {
        ...model,
        subjects: model.subjects.filter((s) => s.subjectId === options.subjectId),
      }
    : model;
  const recs = recommendSkills(scoped, {
    now,
    recentlyPracticedClean: clean,
    limit: options.limit ?? 6,
  });
  const skillOf = new Map(scoped.subjects.flatMap((s) => s.skills.map((k) => [k.key, k] as const)));
  const recommendations = [];
  for (const r of recs) {
    const skill = skillOf.get(r.skillKey)!;
    const picked = await pickTasksForSkill(db, userId, {
      skillKey: r.skillKey,
      count: r.suggestedTasks,
      bucket: r.kind === 'repeated_errors' ? 'mistakes' : r.kind === 'stale' ? 'stale' : 'weak',
      targetDifficulty: targetDifficultyFor(skill.mastery, skill.level),
      now,
    });
    if (picked.length === 0) continue;
    recommendations.push({ ...r, taskIds: picked.map((p) => p.taskId) });
  }
  return { recommendations };
}

function periodOf(
  rows: readonly { isCorrect: boolean; taskId: string; createdAt: Date }[],
  since: number,
): PeriodStats {
  const list = rows.filter((r) => r.createdAt.getTime() >= since);
  const correct = list.filter((r) => r.isCorrect).length;
  return {
    attempts: list.length,
    correct,
    accuracy: list.length ? Math.round((correct / list.length) * 100) : null,
    solvedTasks: new Set(list.filter((r) => r.isCorrect).map((r) => r.taskId)).size,
  };
}

const keyOf = (s: SkillState) => s.key;

/** Smart analytics for one subject — the same model, more views of it. */
export async function getAnalytics(
  db: Database,
  userId: string,
  subjectId: string,
  now: Date = new Date(),
): Promise<LearningAnalyticsResponse | null> {
  const model = await buildStudentModel(db, userId, now, { allSubjects: true });
  const subject = model.subjects.find((s) => s.subjectId === subjectId);
  if (!subject) return null;

  const rows = await db
    .select({
      isCorrect: schema.attempts.isCorrect,
      taskId: schema.attempts.taskId,
      createdAt: schema.attempts.createdAt,
      timeSpentMs: schema.attempts.timeSpentMs,
    })
    .from(schema.attempts)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.attempts.taskId))
    .where(and(eq(schema.attempts.userId, userId), eq(schema.tasks.subjectId, subjectId)));
  const t = now.getTime();
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const measured = rows.filter((r) => r.timeSpentMs !== null && r.timeSpentMs > 0);
  const minutes = (list: typeof measured) =>
    Math.round(list.reduce((s, r) => s + Math.min(r.timeSpentMs!, 30 * 60_000), 0) / 60_000);

  const skills = subject.skills.filter((s) => s.examNumber !== null || s.attempts > 0);
  return {
    subjectId,
    periods: {
      day: periodOf(rows, startOfDay.getTime()),
      week: periodOf(rows, t - 7 * MS_PER_DAY),
      month: periodOf(rows, t - 30 * MS_PER_DAY),
      all: periodOf(rows, 0),
    },
    timeSpentMinutes: {
      week: minutes(measured.filter((r) => r.createdAt.getTime() >= t - 7 * MS_PER_DAY)),
      all: minutes(measured),
      measuredAttempts: measured.length,
    },
    byNumber: skills.map((s) => ({ ...s, nextAction: nextActionFor(s) })),
    strong: skills.filter((s) => s.level === 'strong').map(keyOf),
    weak: skills.filter((s) => s.level === 'weak').map(keyOf),
    insufficient: skills.filter((s) => s.level === 'none' || s.level === 'low_data').map(keyOf),
    declining: skills.filter((s) => s.trend === 'down').map(keyOf),
    improving: skills.filter((s) => s.trend === 'up').map(keyOf),
    errors: {
      mostWrong: skills
        .filter((s) => s.incorrect > 0)
        .sort((a, b) => b.incorrect - a.incorrect)
        .slice(0, 5)
        .map((s) => ({ skillKey: s.key, wrong: s.incorrect })),
      repeated: skills
        .filter((s) => s.repeatedErrorTasks > 0)
        .map((s) => ({ skillKey: s.key, tasks: s.repeatedErrorTasks })),
      afterExplanation: skills
        .filter((s) => s.stuckAfterExplanation > 0)
        .map((s) => ({ skillKey: s.key, tasks: s.stuckAfterExplanation })),
    },
  };
}
