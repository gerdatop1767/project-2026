import type { Database } from '@zybrilka/db';
import { activityHeartbeatSchema } from '@zybrilka/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { recordActiveSlots } from './service.js';

export interface ActivityRoutesOptions {
  db: Database;
}

/**
 * Active time (docs/ACTIVE_TIME.md): the client only reports its active
 * slots. The totals are shown in the admin panel only (/admin/activity,
 * /admin/users/:id) — never to the users themselves.
 */
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
};
