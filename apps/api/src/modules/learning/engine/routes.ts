import type { Database } from '@zybrilka/db';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import * as service from './service.js';
import { getSmartSetup } from './smart.js';

const subjectQuery = z.object({ subject: z.enum(['math', 'russian']).optional() });
const recommendationsQuery = subjectQuery.extend({
  limit: z.coerce.number().int().min(1).max(12).optional(),
});
const analyticsQuery = z.object({ subject: z.enum(['math', 'russian']) });

/**
 * Learning Engine (docs/learning/API.md). Personal: registered in the
 * private scope, so a request without a session is 401 in production. Every
 * number is computed on the server from the student's own attempts.
 */
export const learningEngineRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  app.get('/me/learning/overview', async (request, reply) => {
    if (!request.userId) return reply.code(400).send({ error: 'missing_anon_id' });
    const q = subjectQuery.safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });
    reply.header('cache-control', 'no-store');
    return service.getOverview(db, request.userId, q.data.subject);
  });

  app.get('/me/learning/recommendations', async (request, reply) => {
    if (!request.userId) return reply.code(400).send({ error: 'missing_anon_id' });
    const q = recommendationsQuery.safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });
    reply.header('cache-control', 'no-store');
    return service.getRecommendations(db, request.userId, {
      subjectId: q.data.subject,
      limit: q.data.limit,
    });
  });

  app.get('/me/learning/analytics', async (request, reply) => {
    if (!request.userId) return reply.code(400).send({ error: 'missing_anon_id' });
    const q = analyticsQuery.safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });
    const result = await service.getAnalytics(db, request.userId, q.data.subject);
    if (!result) return reply.code(404).send({ error: 'subject_not_found' });
    reply.header('cache-control', 'no-store');
    return result;
  });

  // «Умная тренировка» с настройкой: the subject's topics with the student's
  // mastery, available tasks and problem flags (docs/learning/SMART-TRAINING.md).
  app.get('/me/learning/smart-setup', async (request, reply) => {
    if (!request.userId) return reply.code(400).send({ error: 'missing_anon_id' });
    const q = analyticsQuery.safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });
    const result = await getSmartSetup(db, request.userId, q.data.subject);
    if (!result) return reply.code(404).send({ error: 'subject_not_found' });
    reply.header('cache-control', 'no-store');
    return result;
  });
};
