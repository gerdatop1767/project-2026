import type { Database } from '@zybrilka/db';
import { activityHeartbeatSchema } from '@zybrilka/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { activityStats, recordActiveSlots } from './service.js';

export interface ActivityRoutesOptions {
  db: Database;
}

/** Active time (docs/ACTIVE_TIME.md) — the signed-in user's own only. */
export const activityRoutes: FastifyPluginAsync<ActivityRoutesOptions> = async (app, { db }) => {
  const userOf = (request: FastifyRequest) => request.sessionUserId ?? null;

  app.post(
    '/activity/heartbeat',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
          keyGenerator: (request: FastifyRequest) => request.sessionUserId ?? request.ip,
        },
      },
    },
    async (request, reply) => {
      const userId = userOf(request);
      if (!userId) return reply.code(401).send({ error: 'unauthorized' });
      const body = activityHeartbeatSchema.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
      return { counted: await recordActiveSlots(db, userId, body.data.slots) };
    },
  );

  app.get('/progress/activity', async (request, reply) => {
    const userId = userOf(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    reply.header('cache-control', 'no-store');
    return activityStats(db, userId);
  });
};
