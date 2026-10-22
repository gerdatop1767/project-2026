import type { Database } from '@zybrilka/db';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Period } from '../period.js';
import { guestAnswers, one, registeredAttempts, rows } from './common.js';

const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

/**
 * Задания и предметы. Counting rules (docs/ADMIN.md §Задания):
 * - attempts = every checked answer of a registered user (each row once, by id);
 * - correct / incorrect = attempts split by the server's grading;
 * - unique solvers = distinct users with ≥1 attempt on it;
 * - solved = distinct (user, task) with ≥1 correct attempt;
 * - repeats = attempts beyond a user's first on the same task;
 * - guest checks are shown separately (events, since tracking started).
 * A "hard" task is never called wrong for being hard: "hardest" needs a
 * minimum sample and is only a ranking by observed accuracy.
 */
export const MIN_SAMPLE = 20;

function periodAttempts(period: Period): SQL {
  return sql`(SELECT a.* FROM ${registeredAttempts} a WHERE a.created_at >= ${ts(period.startUtc)} AND a.created_at < ${ts(period.endUtc)})`;
}

const taskStatsSelect = sql`count(a.id)::int AS attempts,
  count(a.id) FILTER (WHERE a.is_correct)::int AS correct,
  count(a.id) FILTER (WHERE NOT a.is_correct)::int AS incorrect,
  count(DISTINCT a.user_id)::int AS "uniqueSolvers",
  count(DISTINCT CASE WHEN a.is_correct THEN a.user_id END)::int AS solved`;

export async function subjectsReport(db: Database, period: Period) {
  const pa = periodAttempts(period);
  return rows<{
    subjectId: string;
    name: string;
    tasks: number;
    published: number;
    attempts: number;
    correct: number;
    uniqueSolvers: number;
    guestChecks: number;
    openComplaints: number;
  }>(
    db,
    sql`SELECT s.id AS "subjectId", s.name,
      (SELECT count(*)::int FROM tasks t WHERE t.subject_id = s.id) AS tasks,
      (SELECT count(*)::int FROM tasks t WHERE t.subject_id = s.id AND t.status = 'published') AS published,
      (SELECT count(*)::int FROM ${pa} a JOIN tasks t ON t.id = a.task_id WHERE t.subject_id = s.id) AS attempts,
      (SELECT count(*)::int FROM ${pa} a JOIN tasks t ON t.id = a.task_id WHERE t.subject_id = s.id AND a.is_correct) AS correct,
      (SELECT count(DISTINCT a.user_id)::int FROM ${pa} a JOIN tasks t ON t.id = a.task_id WHERE t.subject_id = s.id) AS "uniqueSolvers",
      (SELECT count(*)::int FROM ${guestAnswers} g JOIN tasks t ON t.id = g.task_id WHERE t.subject_id = s.id
        AND g.occurred_at >= ${ts(period.startUtc)} AND g.occurred_at < ${ts(period.endUtc)}) AS "guestChecks",
      (SELECT count(*)::int FROM task_complaints c JOIN tasks t ON t.id = c.task_id WHERE t.subject_id = s.id AND c.status IN ('new', 'in_progress')) AS "openComplaints"
      FROM subjects s ORDER BY attempts DESC, s.name`,
  );
}

export async function subjectDetailReport(db: Database, subjectId: string, period: Period) {
  const subject = await rows<{ id: string; name: string }>(
    db,
    sql`SELECT id, name FROM subjects WHERE id = ${subjectId}`,
  );
  if (!subject[0]) return null;
  const pa = periodAttempts(period);
  const totals = await one<{
    attempts: number;
    correct: number;
    incorrect: number;
    uniqueSolvers: number;
    solvedPairs: number;
    userTaskPairs: number;
  }>(
    db,
    sql`SELECT count(*)::int AS attempts,
      count(*) FILTER (WHERE a.is_correct)::int AS correct,
      count(*) FILTER (WHERE NOT a.is_correct)::int AS incorrect,
      count(DISTINCT a.user_id)::int AS "uniqueSolvers",
      count(DISTINCT CASE WHEN a.is_correct THEN a.user_id::text || a.task_id::text END)::int AS "solvedPairs",
      count(DISTINCT a.user_id::text || a.task_id::text)::int AS "userTaskPairs"
      FROM ${pa} a JOIN tasks t ON t.id = a.task_id WHERE t.subject_id = ${subjectId}`,
  );
  const daily = await rows<{ day: string; attempts: number; correct: number }>(
    db,
    sql`SELECT ((a.created_at AT TIME ZONE 'Europe/Moscow')::date)::text AS day,
      count(*)::int AS attempts, count(*) FILTER (WHERE a.is_correct)::int AS correct
      FROM ${pa} a JOIN tasks t ON t.id = a.task_id WHERE t.subject_id = ${subjectId} GROUP BY 1 ORDER BY 1`,
  );
  const byNumber = await rows<{
    taskNumber: number;
    tasks: number;
    attempts: number;
    correct: number;
    incorrect: number;
    uniqueSolvers: number;
    solved: number;
    openComplaints: number;
  }>(
    db,
    sql`SELECT t.task_number AS "taskNumber", count(DISTINCT t.id)::int AS tasks, ${taskStatsSelect},
      (SELECT count(*)::int FROM task_complaints c JOIN tasks t2 ON t2.id = c.task_id
        WHERE t2.subject_id = ${subjectId} AND t2.task_number = t.task_number AND c.status IN ('new', 'in_progress')) AS "openComplaints"
      FROM tasks t LEFT JOIN ${pa} a ON a.task_id = t.id
      WHERE t.subject_id = ${subjectId} GROUP BY t.task_number ORDER BY t.task_number`,
  );
  const perTask = sql`SELECT t.id, t.task_number AS "taskNumber", t.status, left(t.condition_md, 140) AS preview, ${taskStatsSelect},
      (SELECT count(*)::int FROM task_complaints c WHERE c.task_id = t.id) AS complaints
      FROM tasks t LEFT JOIN ${pa} a ON a.task_id = t.id WHERE t.subject_id = ${subjectId} GROUP BY t.id`;
  type Row = {
    id: string;
    taskNumber: number;
    status: string;
    preview: string;
    attempts: number;
    correct: number;
    incorrect: number;
    uniqueSolvers: number;
    solved: number;
    complaints: number;
  };
  const popular = await rows<Row>(
    db,
    sql`SELECT * FROM (${perTask}) x WHERE x.attempts > 0 ORDER BY x.attempts DESC LIMIT 10`,
  );
  const hardest = await rows<Row>(
    db,
    sql`SELECT * FROM (${perTask}) x WHERE x.attempts >= ${MIN_SAMPLE}
      ORDER BY x.correct::float8 / x.attempts ASC, x.attempts DESC LIMIT 10`,
  );
  const complained = await rows<Row>(
    db,
    sql`SELECT * FROM (${perTask}) x WHERE x.complaints > 0 ORDER BY x.complaints DESC LIMIT 10`,
  );
  return {
    subject: subject[0],
    minSample: MIN_SAMPLE,
    totals: {
      ...totals,
      accuracy: totals.attempts > 0 ? totals.correct / totals.attempts : null,
      averageAttemptsPerTask:
        totals.userTaskPairs > 0 ? totals.attempts / totals.userTaskPairs : null,
      repeats: totals.attempts - totals.userTaskPairs,
    },
    daily,
    byNumber,
    top: { popular, hardest, complained },
  };
}

export const taskListQuerySchema = z.object({
  subject: z.string().max(32).optional(),
  number: z.coerce.number().int().min(1).max(40).optional(),
  status: z.enum(['draft', 'published', 'archived', 'needs_review']).optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['number', 'attempts', 'accuracy', 'complaints', 'updated']).default('number'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

export async function tasksListReport(
  db: Database,
  period: Period,
  q: z.infer<typeof taskListQuerySchema>,
) {
  const pa = periodAttempts(period);
  const where: SQL[] = [sql`true`];
  if (q.subject) where.push(sql`t.subject_id = ${q.subject}`);
  if (q.number) where.push(sql`t.task_number = ${q.number}`);
  if (q.status) where.push(sql`t.status = ${q.status}`);
  if (q.q) {
    const uuidLike = /^[0-9a-f-]{8,36}$/i.test(q.q);
    where.push(
      uuidLike
        ? sql`t.id::text LIKE ${q.q.toLowerCase() + '%'}`
        : sql`t.condition_md ILIKE ${'%' + q.q.replace(/[\\%_]/g, (c) => '\\' + c) + '%'}`,
    );
  }
  const whereSql = sql.join(where, sql` AND `);
  const dir = sql.raw(q.dir === 'desc' ? 'DESC' : 'ASC');
  const order = {
    number: sql`x."subjectId" ${dir}, x."taskNumber" ${dir}, x.id`,
    attempts: sql`x.attempts ${dir}, x.id`,
    accuracy: sql`(CASE WHEN x.attempts = 0 THEN NULL ELSE x.correct::float8 / x.attempts END) ${dir} NULLS LAST, x.id`,
    complaints: sql`x.complaints ${dir}, x.id`,
    updated: sql`x."updatedAt" ${dir}, x.id`,
  }[q.sort];
  const base = sql`SELECT t.id, t.subject_id AS "subjectId", t.task_number AS "taskNumber", t.status,
      t.source, t.source_year AS "sourceYear", t.updated_at::text AS "updatedAt",
      left(t.condition_md, 140) AS preview, ${taskStatsSelect},
      (SELECT count(*)::int FROM task_complaints c WHERE c.task_id = t.id) AS complaints
      FROM tasks t LEFT JOIN ${pa} a ON a.task_id = t.id WHERE ${whereSql} GROUP BY t.id`;
  const total = await one<{ n: number }>(
    db,
    sql`SELECT count(*)::int AS n FROM tasks t WHERE ${whereSql}`,
  );
  const items = await rows<Record<string, unknown>>(
    db,
    sql`SELECT * FROM (${base}) x ORDER BY ${order} LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
  );
  return { total: total.n, page: q.page, pageSize: q.pageSize, items };
}

export async function taskCardReport(db: Database, taskId: string, period: Period) {
  const [task] = await rows<Record<string, unknown>>(
    db,
    sql`SELECT t.id, t.subject_id AS "subjectId", s.name AS "subjectName", t.task_number AS "taskNumber",
      t.difficulty, t.status, t.answer_type AS "answerType", t.condition_md AS "conditionMd",
      t.correct_answer AS "correctAnswer", t.correct_answer_display AS "correctAnswerDisplay",
      t.explanation_md AS "explanationMd", t.hint_md AS "hintMd", t.image_url AS "imageUrl",
      t.source, t.source_url AS "sourceUrl", t.source_year AS "sourceYear",
      t.source_document AS "sourceDocument", t.source_variant AS "sourceVariant", t.source_page AS "sourcePage",
      tp.name AS "topicName", t.created_at::text AS "createdAt", t.updated_at::text AS "updatedAt"
      FROM tasks t JOIN subjects s ON s.id = t.subject_id LEFT JOIN topics tp ON tp.id = t.topic_id
      WHERE t.id = ${taskId}`,
  );
  if (!task) return null;
  const pa = periodAttempts(period);
  const periodStats = await one<Record<string, number>>(
    db,
    sql`SELECT ${taskStatsSelect} FROM ${pa} a WHERE a.task_id = ${taskId}`,
  );
  const allTime = await one<Record<string, number>>(
    db,
    sql`SELECT ${taskStatsSelect} FROM ${registeredAttempts} a WHERE a.task_id = ${taskId}`,
  );
  const guest = await one<{ checks: number; correct: number; started: number }>(
    db,
    sql`SELECT
      (SELECT count(*)::int FROM ${guestAnswers} g WHERE g.task_id = ${taskId}) AS checks,
      (SELECT count(*)::int FROM ${guestAnswers} g WHERE g.task_id = ${taskId} AND (g.props->>'correct')::boolean) AS correct,
      (SELECT count(*)::int FROM analytics_events e WHERE e.type = 'task_started' AND e.task_id = ${taskId}) AS started`,
  );
  const complaints = await rows<Record<string, unknown>>(
    db,
    sql`SELECT c.id, c.reason, c.status, c.comment, c.created_at::text AS "createdAt"
      FROM task_complaints c WHERE c.task_id = ${taskId} ORDER BY c.created_at DESC LIMIT 50`,
  );
  const history = await rows<Record<string, unknown>>(
    db,
    sql`SELECT l.id, l.action, l.result, l.details, l.created_at::text AS "createdAt"
      FROM admin_audit_log l WHERE l.object_type = 'task' AND l.object_id = ${taskId}
      ORDER BY l.created_at DESC LIMIT 50`,
  );
  const variants = await rows<{ title: string; collection: string; position: number }>(
    db,
    sql`SELECT v.title, c.title AS collection, vt.position FROM variant_tasks vt
      JOIN variants v ON v.id = vt.variant_id JOIN collections c ON c.id = v.collection_id
      WHERE vt.task_id = ${taskId} ORDER BY c.title, v.variant_number`,
  );
  return { task, stats: { period: periodStats, allTime }, guest, complaints, history, variants };
}
