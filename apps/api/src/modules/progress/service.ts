import type { Database } from '@zybrilka/db';
import {
  calculateMedian,
  calculateSpeedSignal,
  computeCurrentStreak,
  detectErrorSignatures,
  toMoscowDateString,
  type ProgressByTaskNumberQuery,
  type ProgressByTaskNumberResponse,
  type ProgressByTopicQuery,
  type ProgressByTopicResponse,
  type ProgressDailyResponse,
  type ProgressSummary,
  type SpeedBaselineSource,
  type StreakResponse,
  type TaskNumberStatisticsDetail,
} from '@zybrilka/shared';
import { buildDetectionInput } from '../learning/errorSignatures/service.js';
import * as repo from './repo.js';

/** How many of the most recent attempts count as "recent" for the
 * recent-vs-previous comparison and `recentAverageTimeMs` — same
 * window size as the mastery formula's own recency window
 * (`RECENCY_WINDOW_SIZE` in packages/shared/src/learning/mastery.ts),
 * reused here for consistency rather than inventing a second number. */
const RECENT_WINDOW_SIZE = 10;
/** Below this many attempts, "recent" is too thin to report at all —
 * never a 1-attempt "100% recent accuracy". */
const MIN_ATTEMPTS_FOR_RECENT = 3;

function accuracy(solved: number, correct: number): number {
  if (solved === 0) return 0;
  return Math.round((correct / solved) * 1000) / 10;
}

export async function getSummary(db: Database, userId: string): Promise<ProgressSummary> {
  const [totals, bySubject, byTaskNumber, byTopic, timedAttempts, uniqueSolvedBySubject] =
    await Promise.all([
      repo.getTotals(db, userId),
      repo.getBySubject(db, userId),
      repo.getByTaskNumber(db, userId),
      repo.getByTopic(db, userId),
      repo.getTimedAttemptsBySubjectRaw(db, userId),
      repo.getUniqueSolvedBySubject(db, userId),
    ]);
  const uniqueSolvedBySubjectId = new Map(
    uniqueSolvedBySubject.map((row) => [row.subjectId, row.uniqueSolved]),
  );

  const timesBySubject = new Map<string, number[]>();
  for (const row of timedAttempts) {
    const list = timesBySubject.get(row.subjectId);
    if (list) list.push(row.timeSpentMs);
    else timesBySubject.set(row.subjectId, [row.timeSpentMs]);
  }
  const timeBySubject = Array.from(timesBySubject.entries()).map(([subjectId, times]) => ({
    subjectId,
    averageTimeMs: Math.round(times.reduce((sum, t) => sum + t, 0) / times.length),
    medianTimeMs: Math.round(calculateMedian(times)!),
    timedAttempts: times.length,
  }));

  return {
    solvedTotal: totals.solved,
    correctTotal: totals.correct,
    incorrectTotal: totals.solved - totals.correct,
    accuracyPercent: accuracy(totals.solved, totals.correct),
    bySubject: bySubject.map((row) => ({
      subjectId: row.subjectId,
      solved: row.solved,
      correct: row.correct,
      accuracyPercent: accuracy(row.solved, row.correct),
      // Distinct tasks with >=1 correct attempt — see
      // getUniqueSolvedBySubject's doc comment. 0, never missing, for a
      // subject with attempts but no correct one yet.
      uniqueSolved: uniqueSolvedBySubjectId.get(row.subjectId) ?? 0,
    })),
    byTaskNumber: byTaskNumber.map((row) => ({
      subjectId: row.subjectId,
      taskNumber: row.taskNumber,
      solved: row.solved,
      correct: row.correct,
      accuracyPercent: accuracy(row.solved, row.correct),
    })),
    byTopic: byTopic
      .filter((row) => row.topicId !== null)
      .map((row) => ({
        topicId: row.topicId!,
        topicName: row.topicName,
        solved: row.solved,
        correct: row.correct,
        accuracyPercent: accuracy(row.solved, row.correct),
      })),
    timeBySubject,
  };
}

export async function getByTaskNumberWithTotals(
  db: Database,
  userId: string,
  filters: ProgressByTaskNumberQuery,
): Promise<ProgressByTaskNumberResponse> {
  const items = await repo.getByTaskNumberWithTotals(db, userId, filters);
  return { items };
}

export async function getByTopicWithTotals(
  db: Database,
  userId: string,
  filters: ProgressByTopicQuery,
): Promise<ProgressByTopicResponse> {
  const items = await repo.getByTopicWithTotals(db, userId, filters);
  return { items };
}

export async function getDaily(
  db: Database,
  userId: string,
  days: number,
  subjectId?: string,
): Promise<ProgressDailyResponse> {
  const rows = await repo.getDaily(db, userId, days, subjectId);
  return {
    items: rows.map((row) => ({
      date: row.date,
      solved: row.solved,
      accuracyPercent: accuracy(row.solved, row.correct),
    })),
  };
}

/**
 * Statistics 2.0 — the "По номерам → №N" detail. A single bulk
 * `getAttemptsForTaskNumberDetail` query drives every count/time/error
 * metric in JS (Step 16: never one query per metric); skills and the
 * Speed Learning baselines need their own queries since they reach
 * beyond this attempt list (other tasks sharing a skill, the whole
 * subject, or global task-level stats), still just a handful total,
 * never N+1 per task number.
 */
export async function getTaskNumberStatisticsDetail(
  db: Database,
  userId: string,
  subjectId: string,
  taskNumber: number,
): Promise<TaskNumberStatisticsDetail> {
  const attemptRows = await repo.getAttemptsForTaskNumberDetail(db, userId, subjectId, taskNumber);

  const attempts = attemptRows.length;
  const uniqueTasksAttempted = new Set(attemptRows.map((r) => r.taskId)).size;
  const correctAttempts = attemptRows.filter((r) => r.isCorrect).length;
  const incorrectAttempts = attempts - correctAttempts;
  const acc = attempts === 0 ? null : accuracy(attempts, correctAttempts);

  const timedRows = attemptRows.filter(
    (r): r is typeof r & { timeSpentMs: number } => r.timeSpentMs !== null,
  );
  const timedAttempts = timedRows.length;
  const times = timedRows.map((r) => r.timeSpentMs);
  const averageTimeMs =
    timedAttempts === 0 ? null : Math.round(times.reduce((sum, t) => sum + t, 0) / timedAttempts);
  const medianTimeMs = timedAttempts === 0 ? null : Math.round(calculateMedian(times)!);

  const lastAttemptAt = attempts === 0 ? null : attemptRows[attempts - 1]!.createdAt.toISOString();

  // Error breakdown — the exact same deterministic detector the global
  // /me/learning/errors feed uses, just scoped to this attempt list
  // instead of the whole user (see errorSignatures/service.ts).
  const errorCounts = new Map<string, number>();
  for (const row of attemptRows) {
    for (const sig of detectErrorSignatures(buildDetectionInput(row))) {
      errorCounts.set(sig.code, (errorCounts.get(sig.code) ?? 0) + 1);
    }
  }
  const errorBreakdown = Array.from(errorCounts.entries())
    .map(([signature, count]) => ({ signature, count }))
    .sort((a, b) => b.count - a.count);

  // Skill breakdown — dedupe repeats from tasks sharing a skill; a
  // skill never attempted by this user reports mastery/attempts 0
  // (it IS linked to this task number, just with no real data yet).
  const skillRows = await repo.getSkillRowsForTaskNumber(db, userId, subjectId, taskNumber);
  const skillMap = new Map<
    string,
    { skillId: string; skillName: string; mastery: number; attempts: number }
  >();
  for (const row of skillRows) {
    if (!skillMap.has(row.skillId)) {
      skillMap.set(row.skillId, {
        skillId: row.skillId,
        skillName: row.skillName,
        mastery: row.mastery ?? 0,
        attempts: row.attempts ?? 0,
      });
    }
  }
  const skillBreakdown = Array.from(skillMap.values());

  // Recent (last RECENT_WINDOW_SIZE) vs the window immediately before
  // it — both require a real full-size window to report at all,
  // never a lopsided "3 vs 1" comparison.
  const recentCount = Math.min(RECENT_WINDOW_SIZE, attempts);
  const recentWindow = attemptRows.slice(attempts - recentCount);
  const recentAccuracy =
    attempts >= MIN_ATTEMPTS_FOR_RECENT
      ? accuracy(recentWindow.length, recentWindow.filter((r) => r.isCorrect).length)
      : null;
  const recentTimed = recentWindow
    .filter((r): r is typeof r & { timeSpentMs: number } => r.timeSpentMs !== null)
    .map((r) => r.timeSpentMs);
  const recentAverageTimeMs =
    recentTimed.length === 0
      ? null
      : Math.round(recentTimed.reduce((sum, t) => sum + t, 0) / recentTimed.length);

  const remainingBeforeRecent = attempts - recentCount;
  const previousCount = Math.min(RECENT_WINDOW_SIZE, remainingBeforeRecent);
  const previousAccuracy =
    previousCount >= MIN_ATTEMPTS_FOR_RECENT
      ? accuracy(
          previousCount,
          attemptRows
            .slice(remainingBeforeRecent - previousCount, remainingBeforeRecent)
            .filter((r) => r.isCorrect).length,
        )
      : null;

  // Chart series — capped for a readable chart, oldest -> newest.
  const TREND_LIMIT = 20;
  const accuracyTrend = attemptRows
    .slice(-TREND_LIMIT)
    .map((r) => ({ createdAt: r.createdAt.toISOString(), isCorrect: r.isCorrect }));
  const timeTrend = timedRows
    .slice(-TREND_LIMIT)
    .map((r) => ({ createdAt: r.createdAt.toISOString(), timeSpentMs: r.timeSpentMs }));

  // Speed Learning: baseline candidates in strict priority order —
  // taskNumber -> skill -> subject -> global task-level (last resort).
  const skillIds = skillBreakdown.map((s) => s.skillId);
  const [skillTimedRaw, subjectTimed, taskStatsRows, taskType] = await Promise.all([
    repo.getTimedAttemptsForSkills(db, userId, skillIds),
    repo.getTimedAttemptsForSubject(db, userId, subjectId),
    repo.getTaskStatisticsForTaskNumber(db, subjectId, taskNumber),
    repo.getDominantTopicNameForTaskNumber(db, subjectId, taskNumber),
  ]);
  const skillTimes = Array.from(new Map(skillTimedRaw.map((r) => [r.id, r.timeSpentMs])).values());

  function toBaseline(
    level: SpeedBaselineSource['level'],
    values: readonly number[],
    sampleSize = values.length,
  ): SpeedBaselineSource | null {
    const median = calculateMedian(values);
    return median === null ? null : { level, medianTimeMs: median, sampleSize };
  }

  const taskNumberBaseline = toBaseline('taskNumber', times);
  const skillBaseline = toBaseline('skill', skillTimes);
  const subjectBaseline = toBaseline(
    'subject',
    subjectTimed.map((r) => r.timeSpentMs),
  );
  const globalAverages = taskStatsRows
    .filter((r): r is { averageTimeMs: number; attempts: number } => r.averageTimeMs !== null)
    .map((r) => r);
  const globalBaseline = toBaseline(
    'global',
    globalAverages.map((r) => r.averageTimeMs),
    globalAverages.reduce((sum, r) => sum + r.attempts, 0),
  );

  const mostRecentTimedMs =
    timedRows.length > 0 ? timedRows[timedRows.length - 1]!.timeSpentMs : null;
  const speedSignal = calculateSpeedSignal(mostRecentTimedMs, [
    taskNumberBaseline,
    skillBaseline,
    subjectBaseline,
    globalBaseline,
  ]);

  return {
    subjectId,
    taskNumber,
    attempts,
    uniqueTasksAttempted,
    correctAttempts,
    incorrectAttempts,
    accuracy: acc,
    averageTimeMs,
    medianTimeMs,
    timedAttempts,
    lastAttemptAt,
    taskType,
    errorBreakdown,
    skillBreakdown,
    recentAccuracy,
    previousAccuracy,
    recentAverageTimeMs,
    accuracyTrend,
    timeTrend,
    speedSignal,
  };
}

/**
 * The real streak state — see `packages/shared/src/learning/streak.ts`
 * for the deterministic algorithm and why "today" is always resolved
 * server-side (Europe/Moscow), never trusted from the client. Frontend
 * only ever displays whatever this returns; it never computes a
 * streak number itself.
 */
export async function getStreak(db: Database, userId: string): Promise<StreakResponse> {
  const activityDates = await repo.getActivityDates(db, userId);
  const today = toMoscowDateString(new Date());
  const currentStreak = computeCurrentStreak(activityDates, today);
  const lastActiveDate = activityDates.length === 0 ? null : activityDates.sort().at(-1)!;
  return {
    currentStreak,
    lastActiveDate,
    isActiveToday: lastActiveDate === today,
  };
}
