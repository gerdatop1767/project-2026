import type { Database } from '@zybrilka/db';
import { difficultyRatingRequestSchema } from '@zybrilka/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import * as service from './service.js';

const params = z.object({ id: z.uuid() });

/**
 * «Насколько сложным было это задание?» — a student's own rating 1..10 and
 * the community difficulty (docs/learning/API.md). Personal: an account is
 * required (the private scope answers 401 without a session).
 */
export const difficultyRatingRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  app.get('/tasks/:id/difficulty-rating', async (request, reply) => {
    if (!request.userId) return reply.code(400).send({ error: 'missing_anon_id' });
    const p = params.safeParse(request.params);
    if (!p.success) return reply.code(400).send({ error: 'invalid_id' });
    const result = await service.getRating(db, request.userId, p.data.id);
    if (!result) return reply.code(404).send({ error: 'task_not_found' });
    reply.header('cache-control', 'no-store');
    return result;
  });

  app.put('/tasks/:id/difficulty-rating', async (request, reply) => {
    if (!request.userId) return reply.code(400).send({ error: 'missing_anon_id' });
    const p = params.safeParse(request.params);
    if (!p.success) return reply.code(400).send({ error: 'invalid_id' });
    const body = difficultyRatingRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues });
    }
    const outcome = await service.rateTask(db, request.userId, p.data.id, body.data.rating);
    if (!outcome.ok) {
      const code = { task_not_found: 404, not_attempted: 409, too_many_ratings: 429 }[
        outcome.error
      ];
      return reply.code(code).send({ error: outcome.error });
    }
    reply.header('cache-control', 'no-store');
    return outcome.value;
  });
};
