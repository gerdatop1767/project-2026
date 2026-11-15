import type { Database } from '@zybrilka/db';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getTaskById } from '../../tasks/repo.js';
import { getSimilarTasks } from './service.js';

export interface TaskSimilarityRoutesOptions {
  db: Database;
}

const taskIdParamsSchema = z.object({ taskId: z.uuid() });
const similarQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).optional().default(5),
  /** Comma-separated task ids the client is showing — never offered again. */
  exclude: z
    .string()
    .max(40 * 37)
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : []))
    .pipe(z.array(z.uuid()).max(40)),
});

/**
 * Open to guests (content similarity). With a session the order also uses
 * the student's own answers (solved last, wrong subtypes first, nothing just
 * answered) — read only from the session's user, never from the request.
 */
export const taskSimilarityRoutes: FastifyPluginAsync<TaskSimilarityRoutesOptions> = async (
  app,
  { db },
) => {
  app.get('/tasks/:taskId/similar', async (request, reply) => {
    const params = taskIdParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });

    const query = similarQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'invalid_query', issues: query.error.issues });
    }

    const task = await getTaskById(db, params.data.taskId);
    if (!task) return reply.code(404).send({ error: 'task_not_found' });

    const items = await getSimilarTasks(db, params.data.taskId, query.data.limit, {
      userId: request.userId ?? null,
      exclude: query.data.exclude,
    });
    void reply.header('cache-control', 'private, no-store');
    return { items };
  });
};
