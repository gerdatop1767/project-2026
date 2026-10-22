import { schema } from '@zybrilka/db';
import type { Database } from '@zybrilka/db';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { readVisitorId, recordEvent, safely } from '../analytics/recorder.js';

export interface ComplaintsRoutesOptions {
  db: Database;
}

const paramsSchema = z.object({ id: z.uuid() });
export const complaintBodySchema = z.object({
  reason: z.enum(schema.complaintReasons),
  comment: z.string().trim().max(1000).optional(),
});

/**
 * «Пожаловаться на задание». Needs a session (registered behind the
 * private scope's `requireSession`) — a complaint is tied to an account,
 * which is what keeps it from being an anonymous spam channel — and is
 * rate limited per account. The same open complaint (same task, same
 * reason, still new/in progress) is not stored twice.
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
      const body = complaintBodySchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_body' });

      const [task] = await db
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(eq(schema.tasks.id, params.data.id))
        .limit(1);
      if (!task) return reply.code(404).send({ error: 'task_not_found' });

      const [open] = await db
        .select({ id: schema.taskComplaints.id })
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
      if (open) return reply.code(200).send({ id: open.id, status: 'already_reported' });

      const comment = body.data.comment ? body.data.comment : null;
      const [created] = await db
        .insert(schema.taskComplaints)
        .values({ taskId: task.id, userId, reason: body.data.reason, comment })
        .returning({ id: schema.taskComplaints.id });
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
      return reply.code(201).send({ id: created!.id, status: 'created' });
    },
  );
};
