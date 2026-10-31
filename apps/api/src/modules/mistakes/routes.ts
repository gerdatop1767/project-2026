import type { Database } from '@zybrilka/db';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import * as repo from './repo.js';
import * as service from './service.js';

const idParams = z.object({ id: z.uuid() });

export interface MistakesRoutesOptions {
  db: Database;
}

export const mistakesRoutes: FastifyPluginAsync<MistakesRoutesOptions> = async (app, { db }) => {
  app.get('/mistakes', async (request, reply) => {
    if (!request.userId) {
      return reply.code(400).send({ error: 'missing_anon_id' });
    }
    const items = await service.listMistakes(db, request.userId);
    return { items };
  });

  // «Убрать из ошибок» and its undo. Only ever the caller's own mistake
  // (unknown or someone else's id → 404); the task itself and the
  // attempt history are never touched.
  app.post('/mistakes/:id/dismiss', async (request, reply) => {
    if (!request.userId) return reply.code(400).send({ error: 'missing_anon_id' });
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });
    const row = await repo.dismissMistake(db, request.userId, params.data.id);
    if (!row) return reply.code(404).send({ error: 'mistake_not_found' });
    return { id: row.id, status: row.status };
  });

  app.post('/mistakes/:id/restore', async (request, reply) => {
    if (!request.userId) return reply.code(400).send({ error: 'missing_anon_id' });
    const params = idParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });
    const row = await repo.restoreMistake(db, request.userId, params.data.id);
    if (!row) return reply.code(404).send({ error: 'mistake_not_found' });
    return { id: row.id, status: row.status };
  });
};
