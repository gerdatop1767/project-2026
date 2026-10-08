import type { Database } from '@zybrilka/db';
import { schema } from '@zybrilka/db';
import type { ProgressByTaskNumberQuery, ProgressByTopicQuery } from '@zybrilka/shared';
import {
  and,
  asc,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  sql,
} from 'drizzle-orm';
import { taskIdsForCollectionOrVariant } from '../tasks/repo.js';

export async function getTotals(db: Database, userId: string) {
  const [row] = await db
    .select({
      solved: count(),
      correct: count(sql`case when ${schema.attempts.isCorrect} then 1 end`),
    })
    .from(schema.attempts)
    .where(eq(schema.attempts.userId, userId));
  return { solved: row?.solved ?? 0, correct: row?.correct ?? 0 };
}

export async function getBySubject(db: Database, userId: string) {
  return db
    .select({
      subjectId: schema.tasks.subjectId,
      solved: count(),
      correct: count(sql`case when ${schema.attempts.isCorrect} then 1 end`),
    })
    .from(schema.attempts)
    .innerJoin(schema.tasks, eq(schema.attempts.taskId, schema.tasks.id))
    .where(eq(schema.attempts.userId, userId))
    .groupBy(schema.tasks.subjectId);
}

/**
 * "Решено" — count of DISTINCT tasks (by `taskId`, never `taskNumber`)
 * this user has at least one correct attempt on, per subject. Additive
 * to `getBySubject`'s `solved`/`correct`/`accuracyPercent` above (an
 * attempt-ROW count, a legitimately different metric several other
 * screens already rely on — see `getSummary`'s doc comment) — this is
 * a separate query, never a replacement, so re-solving the same task
 * 100 times only ever counts once, and two different tasks that happen
 * to share a `taskNumber` (e.g. Вариант 1's №7 and Вариант 2's №7,
 * different `taskId`s) are correctly counted as 2.
 */
export async function getUniqueSolvedBySubject(db: Database, userId: string) {
  return db
    .select({
      subjectId: schema.tasks.subjectId,
      uniqueSolved: countDistinct(
        sql`case when ${schema.attempts.isCorrect} then ${schema.attempts.taskId} end`,
      ),
    })
    .from(schema.attempts)
    .innerJoin(schema.tasks, eq(schema.attempts.taskId, schema.tasks.id))
    .where(eq(schema.attempts.userId, userId))
    .groupBy(schema.tasks.subjectId);
}

export async function getByTaskNumber(db: Database, userId: string) {
  return db
    .select({
      subjectId: schema.tasks.subjectId,
      taskNumber: schema.tasks.taskNumber,
      solved: count(),
      correct: count(sql`case when ${schema.attempts.isCorrect} then 1 end`),
    })
    .from(schema.attempts)
    .innerJoin(schema.tasks, eq(schema.attempts.taskId, schema.tasks.id))
    .where(eq(schema.attempts.userId, userId))
    .groupBy(schema.tasks.subjectId, schema.tasks.taskNumber);
}

export async function getByTopic(db: Database, userId: string) {
  return db
    .select({
      topicId: schema.tasks.topicId,
      topicName: schema.topics.name,
      solved: count(),
      correct: count(sql`case when ${schema.attempts.isCorrect} then 1 end`),
    })
    .from(schema.attempts)
    .innerJoin(schema.tasks, eq(schema.attempts.taskId, schema.tasks.id))
    .innerJoin(schema.topics, eq(schema.tasks.topicId, schema.topics.id))
    .where(eq(schema.attempts.userId, userId))
    .groupBy(schema.tasks.topicId, schema.topics.name);
}

/**
 * Real per-task-number coverage — `total` is how many distinct
 * *published* tasks exist for a number under the given subject/
 * collection/variant scope (the exact same scoping GET /tasks and
 * GET /tasks/random use, via `taskIdsForCollectionOrVariant`); no
 * collection/variant filter means "every source" (the aggregate bank),
 * one of them means "only that source" — never a hardcoded id.
 * `completed` counts distinct tasks (not attempt rows) this user has
 * answered at least once, so a repeated attempt on the same task never
 * inflates it, and another user's attempts never affect it.
 */
export async function getByTaskNumberWithTotals(
  db: Database,
  userId: string,
  filters: ProgressByTaskNumberQuery,
) {
  const conditions = [eq(schema.tasks.status, 'published' as const)];
  if (filters.subject) conditions.push(eq(schema.tasks.subjectId, filters.subject));
  const scoped = taskIdsForCollectionOrVariant(db, filters);
  if (scoped) conditions.push(inArray(schema.tasks.id, scoped));
  const where = and(...conditions);

  const totals = await db
    .select({
      subjectId: schema.tasks.subjectId,
      taskNumber: schema.tasks.taskNumber,
      total: count(),
    })
    .from(schema.tasks)
    .where(where)
    .groupBy(schema.tasks.subjectId, schema.tasks.taskNumber);

  const completed = await db
    .select({
      subjectId: schema.tasks.subjectId,
      taskNumber: schema.tasks.taskNumber,
      completed: countDistinct(schema.tasks.id),
    })
    .from(schema.tasks)
    .innerJoin(
      schema.attempts,
      and(eq(schema.attempts.taskId, schema.tasks.id), eq(schema.attempts.userId, userId)),
    )
    .where(where)
    .groupBy(schema.tasks.subjectId, schema.tasks.taskNumber);

  const completedByKey = new Map(
    completed.map((row) => [`${row.subjectId}:${row.taskNumber}`, row.completed]),
  );

  // Accuracy — real correct/total ATTEMPTS for this number (same
  // attempts-based convention as every other accuracy in the app, e.g.
  // ProgressSummary's own `accuracyPercent`), never conflated with
  // `completed` above (which counts unique SOLVED tasks, not attempts).
  const attemptStats = await db
    .select({
      subjectId: schema.tasks.subjectId,
      taskNumber: schema.tasks.taskNumber,
      attempts: count(),
      correct: count(sql`case when ${schema.attempts.isCorrect} then 1 end`),
    })
    .from(schema.attempts)
    .innerJoin(schema.tasks, eq(schema.attempts.taskId, schema.tasks.id))
    .where(and(eq(schema.attempts.userId, userId), where))
    .groupBy(schema.tasks.subjectId, schema.tasks.taskNumber);
  const attemptStatsByKey = new Map(
    attemptStats.map((row) => [
      `${row.subjectId}:${row.taskNumber}`,
      { attempts: row.attempts, correct: row.correct },
    ]),
  );

  return totals.map((row) => {
    const key = `${row.subjectId}:${row.taskNumber}`;
    const stats = attemptStatsByKey.get(key);
    const attempts = stats?.attempts ?? 0;
    const correct = stats?.correct ?? 0;
    return {
      subjectId: row.subjectId,
      taskNumber: row.taskNumber,
      total: row.total,
      completed: completedByKey.get(key) ?? 0,
      correct,
      incorrect: attempts - correct,
      accuracyPercent: attempts === 0 ? null : Math.round((correct / attempts) * 100),
    };
  });
}

/**
 * Same shape/semantics as `getByTaskNumberWithTotals` — grouped by real
 * DB topic (via `tasks.topicId`) instead of task number. A task with no
 * topic assigned is excluded from every group rather than counted
 * under a fake "no topic" bucket.
 */
export async function getByTopicWithTotals(
  db: Database,
  userId: string,
  filters: ProgressByTopicQuery,
) {
  const conditions = [
    eq(schema.tasks.status, 'published' as const),
    isNotNull(schema.tasks.topicId),
  ];
  if (filters.subject) conditions.push(eq(schema.tasks.subjectId, filters.subject));
  const scoped = taskIdsForCollectionOrVariant(db, filters);
  if (scoped) conditions.push(inArray(schema.tasks.id, scoped));
  const where = and(...conditions);

  const totals = await db
    .select({
      topicId: schema.tasks.topicId,
      topicName: schema.topics.name,
      total: count(),
    })
    .from(schema.tasks)
    .innerJoin(schema.topics, eq(schema.tasks.topicId, schema.topics.id))
    .where(where)
    .groupBy(schema.tasks.topicId, schema.topics.name);

  const completed = await db
    .select({
      topicId: schema.tasks.topicId,
      completed: countDistinct(schema.tasks.id),
    })
    .from(schema.tasks)
    .innerJoin(
      schema.attempts,
      and(eq(schema.attempts.taskId, schema.tasks.id), eq(schema.attempts.userId, userId)),
    )
    .where(where)
    .groupBy(schema.tasks.topicId);

  const completedByTopic = new Map(completed.map((row) => [row.topicId, row.completed]));

  return totals.map((row) => ({
    topicId: row.topicId!,
    topicName: row.topicName,
    total: row.total,
    completed: completedByTopic.get(row.topicId) ?? 0,
  }));
}

/**
 * Real per-day activity for the current user over the last `days`
 * calendar days (UTC day boundary — this API has no other timezone
 * convention to match). `solved` dedupes to distinct tasks attempted
 * that day (a repeated attempt on the same task, same day, still
 * counts once); `correct` is the subset of those distinct tasks with
 * at least one correct attempt that same day. Only days with at least
 * one attempt are returned — callers zero-fill the requested range.
 */
export async function getDaily(
  db: Database,
  userId: string,
  days: number,
  /** Scopes the activity to one subject's tasks — omitted means every
   * subject, same "no filter = aggregate" convention as the rest of
   * this module. */
  subjectId?: string,
) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (days - 1));
  since.setUTCHours(0, 0, 0, 0);

  const day = sql<string>`to_char(${schema.attempts.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const conditions = [eq(schema.attempts.userId, userId), gte(schema.attempts.createdAt, since)];
  if (subjectId) conditions.push(eq(schema.tasks.subjectId, subjectId));

  const query = db
    .select({
      date: day,
      solved: countDistinct(schema.attempts.taskId),
      correct: countDistinct(
        sql`case when ${schema.attempts.isCorrect} then ${schema.attempts.taskId} end`,
      ),
    })
    .from(schema.attempts);

  // Only joined when actually filtering by subject — every existing
  // caller (no subjectId) keeps the exact same query it had before.
  const rows = subjectId
    ? query.innerJoin(schema.tasks, eq(schema.attempts.taskId, schema.tasks.id))
    : query;

  return rows
    .where(and(...conditions))
    .groupBy(day)
    .orderBy(day);
}

/**
 * Statistics 2.0 — every timed attempt this user has made, with its
 * subject (one query, grouped/median'd in JS by `getTimeBySubject`
 * below) — `timeSpentMs` is the one column this can't aggregate in SQL
 * cheaply (needs a real median, not an average) so it's fetched raw.
 */
export async function getTimedAttemptsBySubjectRaw(
  db: Database,
  userId: string,
): Promise<{ subjectId: string; timeSpentMs: number }[]> {
  const rows = await db
    .select({ subjectId: schema.tasks.subjectId, timeSpentMs: schema.attempts.timeSpentMs })
    .from(schema.attempts)
    .innerJoin(schema.tasks, eq(schema.attempts.taskId, schema.tasks.id))
    .where(and(eq(schema.attempts.userId, userId), isNotNull(schema.attempts.timeSpentMs)));
  return rows.map((row) => ({ subjectId: row.subjectId, timeSpentMs: row.timeSpentMs! }));
}

export interface TaskNumberDetailAttemptRow {
  readonly taskId: string;
  readonly isCorrect: boolean;
  readonly createdAt: Date;
  readonly timeSpentMs: number | null;
  readonly answerRaw: string;
  readonly answerType: (typeof schema.taskAnswerTypes)[number];
  readonly correctAnswer: string;
}

/**
 * Every attempt this user has made on a task of this exact
 * (subject, taskNumber) — the one bulk query the whole task-number
 * detail is built from (Step 16: no per-metric N+1 queries). Ordered
 * oldest-first so recent/previous-window slicing in the service layer
 * is a plain array slice from the end.
 */
export async function getAttemptsForTaskNumberDetail(
  db: Database,
  userId: string,
  subjectId: string,
  taskNumber: number,
): Promise<TaskNumberDetailAttemptRow[]> {
  return db
    .select({
      taskId: schema.attempts.taskId,
      isCorrect: schema.attempts.isCorrect,
      createdAt: schema.attempts.createdAt,
      timeSpentMs: schema.attempts.timeSpentMs,
      answerRaw: schema.attempts.answerRaw,
      answerType: schema.tasks.answerType,
      correctAnswer: schema.tasks.correctAnswer,
    })
    .from(schema.attempts)
    .innerJoin(schema.tasks, eq(schema.attempts.taskId, schema.tasks.id))
    .where(
      and(
        eq(schema.attempts.userId, userId),
        eq(schema.tasks.subjectId, subjectId),
        eq(schema.tasks.taskNumber, taskNumber),
      ),
    )
    .orderBy(asc(schema.attempts.createdAt));
}

export interface SkillRowForTaskNumber {
  readonly skillId: string;
  readonly skillName: string;
  readonly mastery: number | null;
  readonly attempts: number | null;
}

/**
 * Every skill linked (via `task_skills`) to a task of this
 * (subject, taskNumber), with this user's real mastery for it — a
 * `leftJoin` so a skill the user has never attempted still appears
 * (mastery/attempts null, mapped to 0 in the service), never silently
 * dropped. A skill may repeat once per linked task sharing it; the
 * service dedupes by `skillId` (every repeat carries identical
 * mastery/attempts, since `user_skill_statistics` has one row per
 * (user, skill) regardless of how many tasks link to it).
 */
export async function getSkillRowsForTaskNumber(
  db: Database,
  userId: string,
  subjectId: string,
  taskNumber: number,
): Promise<SkillRowForTaskNumber[]> {
  return db
    .select({
      skillId: schema.skills.id,
      skillName: schema.skills.name,
      mastery: schema.userSkillStatistics.mastery,
      attempts: schema.userSkillStatistics.attempts,
    })
    .from(schema.taskSkills)
    .innerJoin(schema.tasks, eq(schema.taskSkills.taskId, schema.tasks.id))
    .innerJoin(schema.skills, eq(schema.taskSkills.skillId, schema.skills.id))
    .leftJoin(
      schema.userSkillStatistics,
      and(
        eq(schema.userSkillStatistics.skillId, schema.skills.id),
        eq(schema.userSkillStatistics.userId, userId),
      ),
    )
    .where(and(eq(schema.tasks.subjectId, subjectId), eq(schema.tasks.taskNumber, taskNumber)));
}

/**
 * Speed Learning baseline candidate (skill level): every timed attempt
 * this user has made on ANY task sharing one of the given skills — a
 * task linking to more than one of them would otherwise duplicate the
 * same attempt row per skill match, so this selects the attempt `id`
 * specifically to dedupe in the service layer.
 */
export async function getTimedAttemptsForSkills(
  db: Database,
  userId: string,
  skillIds: readonly string[],
): Promise<{ id: string; timeSpentMs: number }[]> {
  if (skillIds.length === 0) return [];
  const rows = await db
    .select({ id: schema.attempts.id, timeSpentMs: schema.attempts.timeSpentMs })
    .from(schema.attempts)
    .innerJoin(schema.taskSkills, eq(schema.taskSkills.taskId, schema.attempts.taskId))
    .where(
      and(
        eq(schema.attempts.userId, userId),
        inArray(schema.taskSkills.skillId, [...skillIds]),
        isNotNull(schema.attempts.timeSpentMs),
      ),
    );
  return rows.map((row) => ({ id: row.id, timeSpentMs: row.timeSpentMs! }));
}

/** Speed Learning baseline candidate (subject level): every timed
 * attempt this user has made anywhere in this subject. */
export async function getTimedAttemptsForSubject(
  db: Database,
  userId: string,
  subjectId: string,
): Promise<{ timeSpentMs: number }[]> {
  const rows = await db
    .select({ timeSpentMs: schema.attempts.timeSpentMs })
    .from(schema.attempts)
    .innerJoin(schema.tasks, eq(schema.attempts.taskId, schema.tasks.id))
    .where(
      and(
        eq(schema.attempts.userId, userId),
        eq(schema.tasks.subjectId, subjectId),
        isNotNull(schema.attempts.timeSpentMs),
      ),
    );
  return rows.map((row) => ({ timeSpentMs: row.timeSpentMs! }));
}

/** Speed Learning baseline candidate (global/task level, last resort):
 * the real, already-computed `task_statistics.averageTimeMs` for every
 * published task of this (subject, taskNumber) — never a per-user
 * figure, used only when no personal baseline has enough samples. */
export async function getTaskStatisticsForTaskNumber(
  db: Database,
  subjectId: string,
  taskNumber: number,
): Promise<{ averageTimeMs: number | null; attempts: number }[]> {
  return db
    .select({
      averageTimeMs: schema.taskStatistics.averageTimeMs,
      attempts: schema.taskStatistics.attempts,
    })
    .from(schema.taskStatistics)
    .innerJoin(schema.tasks, eq(schema.taskStatistics.taskId, schema.tasks.id))
    .where(and(eq(schema.tasks.subjectId, subjectId), eq(schema.tasks.taskNumber, taskNumber)));
}

/**
 * Statistics 2.0's "Тип задания" — the real topic name already
 * attached (via `tasks.topicId` -> `topics.name`) to this subject's
 * published tasks for this number, never inferred from user attempts.
 * A number's tasks almost always share one topic (e.g. №13 ->
 * "Тригонометрические уравнения"); if a number genuinely has more than
 * one (mixed demo/seed content), the one covering the most published
 * tasks wins — still pure task metadata, never a guess from statistics.
 * `null` when no published task of this number has a topic at all —
 * callers show an honest empty state, never an invented label.
 */
export async function getDominantTopicNameForTaskNumber(
  db: Database,
  subjectId: string,
  taskNumber: number,
): Promise<string | null> {
  const rows = await db
    .select({ topicName: schema.topics.name, taskCount: count() })
    .from(schema.tasks)
    .innerJoin(schema.topics, eq(schema.tasks.topicId, schema.topics.id))
    .where(
      and(
        eq(schema.tasks.subjectId, subjectId),
        eq(schema.tasks.taskNumber, taskNumber),
        eq(schema.tasks.status, 'published' as const),
      ),
    )
    .groupBy(schema.topics.name)
    .orderBy(desc(count()), asc(schema.topics.name));
  return rows[0]?.topicName ?? null;
}

/**
 * Every Europe/Moscow calendar day this user has real recorded
 * activity on — see `tasks/repo.ts`'s `recordDailyActivity` for where
 * rows here are written (one per user per day, enforced by the
 * table's own unique constraint, never computed/deduped here).
 */
export async function getActivityDates(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ activityDate: schema.userDailyActivity.activityDate })
    .from(schema.userDailyActivity)
    .where(eq(schema.userDailyActivity.userId, userId));
  return rows.map((r) => r.activityDate);
}
