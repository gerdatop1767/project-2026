import type { Database } from '@zybrilka/db';
import {
  MINI_GAMES,
  stressAnswerRequestSchema,
  stressRoundQuerySchema,
  type MiniGamesResponse,
} from '@zybrilka/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { answerStress, stressProgress, stressRound, stressSummary } from './stress.js';

export interface MiniGamesRoutesOptions {
  db: Database;
}

/**
 * Mini-games (docs/MINI_GAMES.md). Playing is open to guests, like task
 * training: a guest's answers are checked but never recorded. Progress
 * and the personal modes («Мои ошибки», «Сложные слова») need an account.
 * Everything acts on the session's own account only.
 */
export const miniGamesRoutes: FastifyPluginAsync<MiniGamesRoutesOptions> = async (app, { db }) => {
  const userOf = (request: FastifyRequest) => request.sessionUserId ?? null;
  const limit = (max: number) => ({
    rateLimit: {
      max,
      timeWindow: '1 minute',
      keyGenerator: (request: FastifyRequest) => request.sessionUserId ?? request.ip,
    },
  });

  app.get('/games', async (request, reply): Promise<MiniGamesResponse> => {
    const userId = userOf(request);
    const stress = userId ? await stressSummary(db, userId) : null;
    reply.header('cache-control', 'no-store');
    return {
      games: MINI_GAMES.map((g) => ({ ...g, progress: g.id === 'stress' ? stress : null })),
    };
  });

  app.get('/games/stress/round', { config: limit(60) }, async (request, reply) => {
    const query = stressRoundQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_query' });
    const userId = userOf(request);
    if (query.data.mode !== 'all' && !userId) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    reply.header('cache-control', 'no-store');
    return stressRound(db, userId, query.data.mode, query.data.size);
  });

  app.post('/games/stress/answer', { config: limit(120) }, async (request, reply) => {
    const body = stressAnswerRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const result = await answerStress(db, userOf(request), body.data);
    if (!result) return reply.code(404).send({ error: 'word_not_found' });
    return result;
  });

  app.get('/games/stress/progress', async (request, reply) => {
    const userId = userOf(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    reply.header('cache-control', 'no-store');
    return stressProgress(db, userId);
  });
};
