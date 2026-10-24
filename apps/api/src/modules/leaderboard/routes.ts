import type { Database } from '@zybrilka/db';
import { leaderboardQuerySchema } from '@zybrilka/shared';
import type { FastifyPluginAsync } from 'fastify';
import { getLeaderboard } from './service.js';

export interface LeaderboardRoutesOptions {
  db: Database;
}

/**
 * The rating (docs/LEADERBOARD.md). Registered with the private routes:
 * only signed-in users see it, and it shows public names only.
 */
export const leaderboardRoutes: FastifyPluginAsync<LeaderboardRoutesOptions> = async (
  app,
  { db },
) => {
  app.get('/leaderboard', async (request, reply) => {
    if (!request.userId) {
      return reply.code(400).send({ error: 'missing_anon_id' });
    }
    const query = leaderboardQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_query' });
    return getLeaderboard(db, request.userId, query.data);
  });
};
