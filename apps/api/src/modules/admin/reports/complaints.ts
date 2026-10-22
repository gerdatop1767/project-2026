import { schema } from '@zybrilka/db';
import type { Database } from '@zybrilka/db';
import { eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { one, rows } from './common.js';

export const complaintListQuerySchema = z.object({
  status: z.enum(schema.complaintStatuses).optional(),
  reason: z.enum(schema.complaintReasons).optional(),
  subject: z.string().max(32).optional(),
  taskId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

export const complaintUpdateSchema = z
  .object({
    status: z.enum(schema.complaintStatuses).optional(),
    internalComment: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.internalComment !== undefined, 'nothing_to_update');

function filters(q: z.infer<typeof complaintListQuerySchema>): SQL {
  const where: SQL[] = [sql`true`];
  if (q.status) where.push(sql`c.status = ${q.status}`);
  if (q.reason) where.push(sql`c.reason = ${q.reason}`);
  if (q.subject) where.push(sql`t.subject_id = ${q.subject}`);
  if (q.taskId) where.push(sql`c.task_id = ${q.taskId}`);
  return sql.join(where, sql` AND `);
}

const columns = sql`c.id, c.created_at::text AS "createdAt", c.updated_at::text AS "updatedAt", c.resolved_at::text AS "resolvedAt",
  t.subject_id AS "subjectId", c.task_id AS "taskId", t.task_number AS "taskNumber", t.source_year AS "sourceYear",
  c.reason, c.comment, c.status, c.internal_comment AS "internalComment", c.user_id AS "userId",
  (SELECT count(*)::int FROM task_complaints o WHERE o.task_id = c.task_id AND o.id <> c.id) AS "otherComplaints"`;

export async function complaintsListReport(
  db: Database,
  q: z.infer<typeof complaintListQuerySchema>,
) {
  const where = filters(q);
  const total = await one<{ n: number }>(
    db,
    sql`SELECT count(*)::int AS n FROM task_complaints c JOIN tasks t ON t.id = c.task_id WHERE ${where}`,
  );
  const items = await rows<Record<string, unknown>>(
    db,
    sql`SELECT ${columns} FROM task_complaints c JOIN tasks t ON t.id = c.task_id WHERE ${where}
      ORDER BY (c.status = 'new') DESC, c.created_at DESC, c.id LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
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

export async function complaintCardReport(db: Database, id: string) {
  const [complaint] = await rows<Record<string, unknown>>(
    db,
    sql`SELECT ${columns}, left(t.condition_md, 400) AS "taskPreview", t.status AS "taskStatus"
      FROM task_complaints c JOIN tasks t ON t.id = c.task_id WHERE c.id = ${id}`,
  );
  if (!complaint) return null;
  const others = await rows<Record<string, unknown>>(
    db,
    sql`SELECT c.id, c.reason, c.status, c.comment, c.created_at::text AS "createdAt" FROM task_complaints c
      WHERE c.task_id = ${complaint.taskId as string} AND c.id <> ${id} ORDER BY c.created_at DESC LIMIT 50`,
  );
  const history = await rows<Record<string, unknown>>(
    db,
    sql`SELECT l.id, l.action, l.result, l.details, l.actor_user_id AS "actorUserId", l.created_at::text AS "createdAt"
      FROM admin_audit_log l WHERE l.object_type = 'complaint' AND l.object_id = ${id} ORDER BY l.created_at`,
  );
  return { complaint, others, history };
}

export async function updateComplaint(
  db: Database,
  id: string,
  patch: z.infer<typeof complaintUpdateSchema>,
) {
  const [before] = await db
    .select()
    .from(schema.taskComplaints)
    .where(eq(schema.taskComplaints.id, id));
  if (!before) return null;
  const closing = patch.status === 'fixed' || patch.status === 'rejected';
  const [after] = await db
    .update(schema.taskComplaints)
    .set({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.internalComment !== undefined
        ? { internalComment: patch.internalComment || null }
        : {}),
      ...(patch.status ? { resolvedAt: closing ? new Date() : null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.taskComplaints.id, id))
    .returning();
  return { before, after: after! };
}
