import type { Database } from '@zybrilka/db';
import { leaderboardQuerySchema } from '@zybrilka/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getLeaderboard, readPublicAvatar } from './service.js';

const avatarParams = z.object({ id: z.uuid() });
const avatarQuery = z.object({ v: z.string().regex(/^[0-9a-f]{12}$/) });

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

  // A rating row's picture: the image id is random (never the user id),
  // and only signed-in users see the rating. The `v` hash versions it, so
  // it is cached for good; the headers keep a stored file inert.
  app.get('/leaderboard/avatars/:id', async (request, reply) => {
    const params = avatarParams.safeParse(request.params);
    const query = avatarQuery.safeParse(request.query);
    if (!params.success || !query.success) return reply.code(404).send({ error: 'not_found' });
    const avatar = await readPublicAvatar(db, params.data.id, query.data.v);
    if (!avatar) return reply.code(404).send({ error: 'not_found' });
    return reply
      .header('content-type', avatar.contentType)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(avatar.data);
  });
};
