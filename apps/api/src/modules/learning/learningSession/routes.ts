import type { Database } from '@zybrilka/db';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  advanceLearningSession,
  finishVariantSession,
  getLearningSessionSnapshot,
  getVariantAttemptDetail,
  getVariantProgress,
  openVariantTask,
  startLearningSession,
  startVariantSession,
} from './service.js';

export interface LearningSessionRoutesOptions {
  db: Database;
}

const DEFAULT_TOTAL = 5;
const MIN_TOTAL = 1;
const MAX_TOTAL = 10;

const startSessionBodySchema = z.object({
  subjectId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(MIN_TOTAL).max(MAX_TOTAL).optional().default(DEFAULT_TOTAL),
  /** Smart Training's 🔄 "Только нерешённые" / 🎲 "Случайное" —
   * see learningPath/service.ts's GetLearningPathContext for what
   * each one changes. */
  unseenOnly: z.boolean().optional(),
  randomizeTopTier: z.boolean().optional(),
});

const sessionParamsSchema = z.object({ sessionId: z.uuid() });

const startVariantSessionBodySchema = z.object({ variantId: z.uuid() });

const openTaskBodySchema = z.object({ taskId: z.uuid() });

/**
 * ZUBRILKA LEARNING INTELLIGENCE, Phase 9/10. Three endpoints: start,
 * advance ("next"), and — added in Phase 10 for frontend refresh-safety
 * — a read-only snapshot. The snapshot was deliberately left out of
 * Phase 9 (nothing in the backend-only lifecycle needed it), but the
 * frontend integration genuinely requires a way to recover "which task
 * was I on" after a page reload WITHOUT calling `/next` (which would
 * wrongly consume another task slot just because the page reloaded).
 */
export const learningSessionRoutes: FastifyPluginAsync<LearningSessionRoutesOptions> = async (
  app,
  { db },
) => {
  app.post('/me/learning/sessions', async (request, reply) => {
    if (!request.userId) return reply.code(400).send({ error: 'missing_anon_id' });

    const body = startSessionBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues });
    }

    const session = await startLearningSession(db, request.userId, {
      subjectId: body.data.subjectId,
      total: body.data.limit,
      unseenOnly: body.data.unseenOnly,
      randomizeTopTier: body.data.randomizeTopTier,
    });
    if (!session) return reply.code(404).send({ error: 'no_candidate_subject' });
    return session;
  });

  // Training's "Вариант" mode — starts a VARIANT session over one real
  // published exam variant's own task order (never scored). Registered
  // as its own path (not nested under :sessionId) so it's never
  // ambiguous with the GET-by-id routes below.
  app.post('/me/learning/sessions/variant', async (request, reply) => {
    if (!request.userId) return reply.code(400).send({ error: 'missing_anon_id' });

    const body = startVariantSessionBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues });
    }

    const session = await startVariantSession(db, request.userId, body.data.variantId);
    if (!session) return reply.code(404).send({ error: 'variant_not_found' });
    return session;
  });

  // Statistics' "Статистика вариантов" — every real variant session
  // this user has ever started, any status (see getVariantProgress's
  // doc comment for why abandoned ones are included, not hidden).
  app.get('/progress/variants', async (request, reply) => {
    if (!request.userId) return reply.code(400).send({ error: 'missing_anon_id' });
    return getVariantProgress(db, request.userId);
  });

  // One attempt's full result (Statistics → a variant in the history,
  // and the variant results screen). Owner only: another user's attempt
  // answers exactly like a missing one (404).
  app.get('/progress/variants/:sessionId', async (request, reply) => {
    if (!request.userId) return reply.code(400).send({ error: 'missing_anon_id' });
    const params = sessionParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'not_found' });
    const detail = await getVariantAttemptDetail(db, request.userId, params.data.sessionId);
    if (!detail) return reply.code(404).send({ error: 'not_found' });
    reply.header('cache-control', 'no-store');
    return detail;
  });

  app.get('/me/learning/sessions/:sessionId/next', async (request, reply) => {
    if (!request.userId) return reply.code(400).send({ error: 'missing_anon_id' });

    const params = sessionParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });

    const result = await advanceLearningSession(db, request.userId, params.data.sessionId);
    if (!result) return reply.code(404).send({ error: 'session_not_found' });
    return result;
  });

  // A variant's number panel: open any of its tasks, in any order. Only
  // serves it — answers still go through POST /tasks/:id/attempts.
  app.post('/me/learning/sessions/:sessionId/open', async (request, reply) => {
    if (!request.userId) return reply.code(400).send({ error: 'missing_anon_id' });
    const params = sessionParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });
    const body = openTaskBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const result = await openVariantTask(
      db,
      request.userId,
      params.data.sessionId,
      body.data.taskId,
    );
    if (!result) return reply.code(404).send({ error: 'session_not_found' });
    return result;
  });

  // «Завершить вариант» — at any point, in any order of solving.
  app.post('/me/learning/sessions/:sessionId/finish', async (request, reply) => {
    if (!request.userId) return reply.code(400).send({ error: 'missing_anon_id' });
    const params = sessionParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });
    const result = await finishVariantSession(db, request.userId, params.data.sessionId);
    if (!result) return reply.code(404).send({ error: 'session_not_found' });
    return result;
  });

  app.get('/me/learning/sessions/:sessionId', async (request, reply) => {
    if (!request.userId) return reply.code(400).send({ error: 'missing_anon_id' });

    const params = sessionParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });

    const result = await getLearningSessionSnapshot(db, request.userId, params.data.sessionId);
    if (!result) return reply.code(404).send({ error: 'session_not_found' });
    return result;
  });
};
