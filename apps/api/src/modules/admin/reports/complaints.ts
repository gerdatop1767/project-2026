import { schema } from '@zybrilka/db';
import type { Database } from '@zybrilka/db';
import { parseReportId, type ComplaintReportData } from '@zybrilka/shared';
import { eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { one, rows } from './common.js';

export const complaintListQuerySchema = z.object({
  status: z.enum(schema.complaintStatuses).optional(),
  reason: z.enum(schema.complaintReasons).optional(),
  subject: z.string().max(32).optional(),
  taskId: z.uuid().optional(),
  /** Free search: a complaint (`RPT-12`, `12` or its UUID) or a task UUID. */
  q: z.string().trim().max(64).optional(),
  /** `new` keeps the old "open first, newest first" order. */
  sort: z.enum(['new', 'newest', 'oldest']).default('new'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

export const complaintUpdateSchema = z
  .object({
    status: z.enum(schema.complaintStatuses).optional(),
    internalComment: z.string().trim().max(2000).nullable().optional(),
    /** `RPT-12` / `12` / a complaint UUID; null clears the mark. */
    duplicateOf: z.string().trim().max(64).nullable().optional(),
  })
  .refine(
    (v) => v.status !== undefined || v.internalComment !== undefined || v.duplicateOf !== undefined,
    'nothing_to_update',
  );

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The list's WHERE clause — shared with the CSV export so both always
 * select the same complaints (status, category, subject, task, search). */
export function complaintFilters(q: z.infer<typeof complaintListQuerySchema>): SQL {
  const where: SQL[] = [sql`true`];
  if (q.status) where.push(sql`c.status = ${q.status}`);
  if (q.reason) where.push(sql`c.reason = ${q.reason}`);
  if (q.subject) where.push(sql`t.subject_id = ${q.subject}`);
  if (q.taskId) where.push(sql`c.task_id = ${q.taskId}`);
  if (q.q) {
    const number = parseReportId(q.q);
    if (UUID.test(q.q)) {
      where.push(sql`(c.id = ${q.q.toLowerCase()} OR c.task_id = ${q.q.toLowerCase()})`);
    } else if (number !== null) {
      where.push(sql`c.report_number = ${number}`);
    } else {
      // Not an id of any kind: matches nothing rather than everything.
      where.push(sql`false`);
    }
  }
  return sql.join(where, sql` AND `);
}

const orderBy = {
  new: sql`(c.status = 'new') DESC, c.created_at DESC, c.id`,
  newest: sql`c.created_at DESC, c.id`,
  oldest: sql`c.created_at ASC, c.id`,
} as const;

const columns = sql`c.id, c.report_number AS "reportNumber", c.created_at::text AS "createdAt", c.updated_at::text AS "updatedAt", c.resolved_at::text AS "resolvedAt",
  t.subject_id AS "subjectId", c.task_id AS "taskId", t.task_number AS "taskNumber", t.source_year AS "sourceYear",
  c.reason, c.comment, c.status, c.internal_comment AS "internalComment", c.user_id AS "userId",
  c.context, c.handled_by_user_id AS "handledByUserId",
  (SELECT d.report_number FROM task_complaints d WHERE d.id = c.duplicate_of_id) AS "duplicateOf",
  (SELECT count(*)::int FROM task_complaints o WHERE o.task_id = c.task_id AND o.id <> c.id) AS "otherComplaints"`;

export async function complaintsListReport(
  db: Database,
  q: z.infer<typeof complaintListQuerySchema>,
) {
  const where = complaintFilters(q);
  const total = await one<{ n: number }>(
    db,
    sql`SELECT count(*)::int AS n FROM task_complaints c JOIN tasks t ON t.id = c.task_id WHERE ${where}`,
  );
  const items = await rows<Record<string, unknown>>(
    db,
    sql`SELECT ${columns} FROM task_complaints c JOIN tasks t ON t.id = c.task_id WHERE ${where}
      ORDER BY ${orderBy[q.sort]} LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
  );
  const counts = await rows<{ status: string; n: number }>(
    db,
    sql`SELECT status, count(*)::int AS n FROM task_complaints GROUP BY status`,
  );
  return {
    total: total.n,
    page: q.page,
    pageSize: q.pageSize,
    items,
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Record<string, number>,
  };
}

type CardRow = Record<string, unknown> & {
  id: string;
  reportNumber: number;
  status: string;
  createdAt: string;
  taskId: string;
  taskNumber: number | null;
  sourceYear: number | null;
  reason: string;
  comment: string | null;
  context: { screen: string; path?: string; variantId?: string } | null;
  duplicateOf: number | null;
  subjectName: string | null;
  source: string | null;
  sourceDocument: string | null;
  sourceVariant: number | null;
  conditionMd: string;
  correctAnswer: string;
  correctAnswerDisplay: string | null;
  explanationMd: string;
  taskUpdatedAt: string;
  snapshot: {
    conditionMd: string;
    correctAnswer: string;
    correctAnswerDisplay: string | null;
    explanationMd: string;
  } | null;
  snapshotTaskUpdatedAt: string | null;
};

/** The variant to name in the report: the one the user was solving, else
 * the import's variant number, else the published variants holding the task. */
async function variantText(db: Database, c: CardRow): Promise<string | null> {
  if (c.context?.variantId) {
    const [v] = await rows<{ title: string; variantNumber: number; collection: string }>(
      db,
      sql`SELECT v.title, v.variant_number AS "variantNumber", col.title AS collection
        FROM variants v JOIN collections col ON col.id = v.collection_id WHERE v.id = ${c.context.variantId}`,
    );
    if (v) return `${v.collection} — вариант ${v.variantNumber} (${v.title})`;
  }
  if (c.sourceVariant !== null) return String(c.sourceVariant);
  const memberships = await rows<{ label: string }>(
    db,
    sql`SELECT col.title || ' — вариант ' || v.variant_number || ' (позиция ' || vt.position || ')' AS label
      FROM variant_tasks vt JOIN variants v ON v.id = vt.variant_id JOIN collections col ON col.id = v.collection_id
      WHERE vt.task_id = ${c.taskId} ORDER BY col.title, v.variant_number LIMIT 3`,
  );
  return memberships.length ? memberships.map((m) => m.label).join('; ') : null;
}

export async function complaintCardReport(db: Database, id: string, webBaseUrl: string) {
  const [complaint] = await rows<CardRow>(
    db,
    sql`SELECT ${columns}, t.status AS "taskStatus", s.name AS "subjectName",
        t.source, t.source_document AS "sourceDocument", t.source_variant AS "sourceVariant",
        t.condition_md AS "conditionMd", t.correct_answer AS "correctAnswer",
        t.correct_answer_display AS "correctAnswerDisplay", t.explanation_md AS "explanationMd",
        t.updated_at::text AS "taskUpdatedAt",
        sn.content AS snapshot, sn.task_updated_at::text AS "snapshotTaskUpdatedAt"
      FROM task_complaints c JOIN tasks t ON t.id = c.task_id
      LEFT JOIN subjects s ON s.id = t.subject_id
      LEFT JOIN task_snapshots sn ON sn.id = c.snapshot_id
      WHERE c.id = ${id}`,
  );
  if (!complaint) return null;
  const others = await rows<Record<string, unknown>>(
    db,
    sql`SELECT c.id, c.report_number AS "reportNumber", c.reason, c.status, c.comment, c.created_at::text AS "createdAt" FROM task_complaints c
      WHERE c.task_id = ${complaint.taskId} AND c.id <> ${id} ORDER BY c.created_at DESC LIMIT 50`,
  );
  const history = await rows<Record<string, unknown>>(
    db,
    sql`SELECT l.id, l.action, l.result, l.details, l.actor_user_id AS "actorUserId", l.created_at::text AS "createdAt"
      FROM admin_audit_log l WHERE l.object_type = 'complaint' AND l.object_id = ${id} ORDER BY l.created_at`,
  );

  const shown = complaint.snapshot ?? complaint;
  const report: ComplaintReportData = {
    reportNumber: complaint.reportNumber,
    id: complaint.id,
    status: complaint.status,
    createdAt: complaint.createdAt,
    subjectName: complaint.subjectName,
    taskId: complaint.taskId,
    taskNumber: complaint.taskNumber,
    source: complaint.source,
    sourceYear: complaint.sourceYear,
    sourceDocument: complaint.sourceDocument,
    variant: await variantText(db, complaint),
    reason: complaint.reason,
    comment: complaint.comment,
    statement: shown.conditionMd,
    statementFromSnapshot: complaint.snapshot !== null,
    taskChangedSinceReport:
      complaint.snapshotTaskUpdatedAt === null
        ? null
        : complaint.snapshotTaskUpdatedAt !== complaint.taskUpdatedAt,
    expectedAnswer: shown.correctAnswerDisplay ?? shown.correctAnswer,
    explanation: shown.explanationMd,
    context: complaint.context
      ? { screen: complaint.context.screen, path: complaint.context.path }
      : null,
    duplicateOf: complaint.duplicateOf,
    adminUrl: new URL(`/admin/complaints/${complaint.id}`, webBaseUrl).toString(),
  };

  const {
    conditionMd,
    correctAnswer,
    correctAnswerDisplay,
    explanationMd,
    snapshot,
    snapshotTaskUpdatedAt,
    ...rest
  } = complaint;
  return {
    complaint: {
      ...rest,
      // Full statement for the card (the list never carries it).
      taskStatement: conditionMd,
      taskAnswer: correctAnswerDisplay ?? correctAnswer,
      taskExplanation: explanationMd,
      snapshot: snapshot
        ? {
            statement: snapshot.conditionMd,
            answer: snapshot.correctAnswerDisplay ?? snapshot.correctAnswer,
            explanation: snapshot.explanationMd,
            taskUpdatedAt: snapshotTaskUpdatedAt,
          }
        : null,
    },
    report,
    others,
    history,
  };
}

export class DuplicateTargetError extends Error {
  constructor(public code: 'duplicate_not_found' | 'duplicate_self') {
    super(code);
  }
}

async function resolveDuplicateTarget(db: Database, self: string, value: string): Promise<string> {
  const number = UUID.test(value) ? null : parseReportId(value);
  if (!UUID.test(value) && number === null) throw new DuplicateTargetError('duplicate_not_found');
  const [target] = await db
    .select({ id: schema.taskComplaints.id })
    .from(schema.taskComplaints)
    .where(
      number !== null
        ? eq(schema.taskComplaints.reportNumber, number)
        : eq(schema.taskComplaints.id, value.toLowerCase()),
    )
    .limit(1);
  if (!target) throw new DuplicateTargetError('duplicate_not_found');
  if (target.id === self) throw new DuplicateTargetError('duplicate_self');
  return target.id;
}

/**
 * Status / internal comment / duplicate mark. Marking a duplicate closes
 * the complaint as «Отклонена» (the original one carries the work) unless
 * a status is given in the same request. `handledBy` records the admin.
 */
export async function updateComplaint(
  db: Database,
  id: string,
  patch: z.infer<typeof complaintUpdateSchema>,
  handledBy: string,
) {
  const [before] = await db
    .select()
    .from(schema.taskComplaints)
    .where(eq(schema.taskComplaints.id, id));
  if (!before) return null;
  const duplicateOfId =
    patch.duplicateOf === undefined
      ? undefined
      : patch.duplicateOf === null || patch.duplicateOf === ''
        ? null
        : await resolveDuplicateTarget(db, id, patch.duplicateOf);
  const status =
    patch.status ?? (duplicateOfId && before.status !== 'rejected' ? 'rejected' : undefined);
  const closing = status === 'fixed' || status === 'rejected';
  const [after] = await db
    .update(schema.taskComplaints)
    .set({
      ...(status ? { status, resolvedAt: closing ? new Date() : null } : {}),
      ...(patch.internalComment !== undefined
        ? { internalComment: patch.internalComment || null }
        : {}),
      ...(duplicateOfId !== undefined ? { duplicateOfId } : {}),
      ...(status || duplicateOfId !== undefined ? { handledByUserId: handledBy } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.taskComplaints.id, id))
    .returning();
  return { before, after: after!, status };
}
