import { schema } from '@zybrilka/db';
import type { Database } from '@zybrilka/db';
import { complaintRequestSchema, formatReportId } from '@zybrilka/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { readVisitorId, recordEvent, safely } from '../analytics/recorder.js';
import { enqueueNotification } from '../notifications/outbox.js';

export interface ComplaintsRoutesOptions {
  db: Database;
}

const paramsSchema = z.object({ id: z.uuid() });

/**
 * The task as the user saw it, stored once per task version
 * (`tasks.updated_at`) and shared by every complaint about that version.
 */
async function snapshotTask(db: Database, taskId: string): Promise<string | null> {
  const [task] = await db
    .select({
      updatedAt: schema.tasks.updatedAt,
      conditionMd: schema.tasks.conditionMd,
      imageUrl: schema.tasks.imageUrl,
      answerOptions: schema.tasks.answerOptions,
      correctAnswer: schema.tasks.correctAnswer,
      correctAnswerDisplay: schema.tasks.correctAnswerDisplay,
      explanationMd: schema.tasks.explanationMd,
      topicId: schema.tasks.topicId,
      contentHash: schema.tasks.contentHash,
    })
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
    .limit(1);
  if (!task) return null;
  const { updatedAt, ...content } = task;
  await db
    .insert(schema.taskSnapshots)
    .values({ taskId, taskUpdatedAt: updatedAt, content })
    .onConflictDoNothing();
  const [row] = await db
    .select({ id: schema.taskSnapshots.id })
    .from(schema.taskSnapshots)
    .where(
      and(
        eq(schema.taskSnapshots.taskId, taskId),
        eq(schema.taskSnapshots.taskUpdatedAt, updatedAt),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/**
 * «Пожаловаться на задание». Needs a session (registered behind the
 * private scope's `requireSession`) — a complaint is tied to an account,
 * which is what keeps it from being an anonymous spam channel — and is
 * rate limited per account. The same open complaint (same task, same
 * reason, still new/in progress) is not stored twice. Each complaint keeps
 * where it was sent from and a snapshot of the task as it was (shared per
 * task version), so it stays understandable after the task is edited.
 */
export const complaintsRoutes: FastifyPluginAsync<ComplaintsRoutesOptions> = async (
  app,
  { db },
) => {
  app.post(
    '/tasks/:id/complaints',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '10 minutes',
          keyGenerator: (request) => request.sessionUserId ?? request.ip,
        },
      },
    },
    async (request, reply) => {
      const userId = request.sessionUserId;
      if (!userId) return reply.code(401).send({ error: 'unauthorized' });
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'invalid_id' });
      const body = complaintRequestSchema.safeParse(request.body);
      if (!body.success) {
        const commentMissing = body.error.issues.some((i) => i.message === 'comment_required');
        return reply
          .code(400)
          .send({ error: commentMissing ? 'comment_required' : 'invalid_body' });
      }

      const [task] = await db
        .select({
          id: schema.tasks.id,
          taskNumber: schema.tasks.taskNumber,
          subjectName: schema.subjects.name,
        })
        .from(schema.tasks)
        .leftJoin(schema.subjects, eq(schema.subjects.id, schema.tasks.subjectId))
        .where(eq(schema.tasks.id, params.data.id))
        .limit(1);
      if (!task) return reply.code(404).send({ error: 'task_not_found' });

      const [open] = await db
        .select({ id: schema.taskComplaints.id, reportNumber: schema.taskComplaints.reportNumber })
        .from(schema.taskComplaints)
        .where(
          and(
            eq(schema.taskComplaints.taskId, task.id),
            eq(schema.taskComplaints.userId, userId),
            eq(schema.taskComplaints.reason, body.data.reason),
            inArray(schema.taskComplaints.status, ['new', 'in_progress']),
          ),
        )
        .limit(1);
      if (open) {
        return reply.code(200).send({
          id: open.id,
          reportId: formatReportId(open.reportNumber),
          status: 'already_reported',
        });
      }

      const comment = body.data.comment ? body.data.comment : null;
      const snapshotId = await snapshotTask(db, task.id);
      const [created] = await db
        .insert(schema.taskComplaints)
        .values({
          taskId: task.id,
          userId,
          reason: body.data.reason,
          comment,
          context: body.data.context ?? null,
          snapshotId,
        })
        .returning({
          id: schema.taskComplaints.id,
          reportNumber: schema.taskComplaints.reportNumber,
        });
      await safely(request, () =>
        recordEvent(db, {
          type: 'complaint_submitted',
          userId,
          visitorId: readVisitorId(request),
          taskId: task.id,
          props: { reason: body.data.reason },
          dedupKey: `complaint:${created!.id}`,
        }),
      );
      // Owner notification, queued for the worker (never blocks the reply).
      await enqueueNotification(
        db,
        request.log,
        {
          kind: 'complaint',
          data: {
            complaintId: created!.id,
            reportNumber: created!.reportNumber,
            subjectName: task.subjectName,
            taskId: task.id,
            taskNumber: task.taskNumber,
            reason: body.data.reason,
            comment: comment && comment.length > 300 ? `${comment.slice(0, 299)}…` : comment,
            at: new Date().toISOString(),
          },
        },
        `complaint:${created!.id}`,
      );
      return reply.code(201).send({
        id: created!.id,
        reportId: formatReportId(created!.reportNumber),
        status: 'created',
      });
    },
  );
};
