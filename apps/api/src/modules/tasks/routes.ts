import type { Database } from '@zybrilka/db';
import { attemptRequestSchema, randomTaskQuerySchema, taskListQuerySchema } from '@zybrilka/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import * as service from './service.js';

export interface TasksRoutesOptions {
  db: Database;
}

const taskIdParamsSchema = z.object({ id: z.uuid() });

export const tasksRoutes: FastifyPluginAsync<TasksRoutesOptions> = async (app, { db }) => {
  // Registered before the parameterized routes below so "/tasks/random"
  // is never swallowed by "/tasks/:id".
  app.get('/tasks/random', async (request, reply) => {
    const query = randomTaskQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'invalid_query', issues: query.error.issues });
    }
    if (query.data.unseen && !request.userId) {
      return reply.code(400).send({ error: 'missing_anon_id' });
    }
    const task = await service.getRandomTask(db, query.data, request.userId);
    if (!task) {
      // A distinct code when "unseen" was requested — the pool existing
      // but being fully seen is a different, controlled state from no
      // tasks matching at all (see Training's "Не встречавшиеся" toggle),
      // never silently falling back to an already-seen task.
      return reply
        .code(404)
        .send({ error: query.data.unseen ? 'no_unseen_tasks' : 'no_tasks_available' });
    }
    return task;
  });

  app.get('/tasks', async (request, reply) => {
    const query = taskListQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'invalid_query', issues: query.error.issues });
    }
    if (query.data.unsolved && !request.userId) {
      return reply.code(400).send({ error: 'missing_anon_id' });
    }
    return service.listTasks(db, query.data, request.userId);
  });

  // Registered before "/tasks/:id" so "counts" is never parsed as a
  // task id — real published-task counts for every subject in one
  // request (Home's subject cards), see service.getCountsBySubject.
  app.get('/tasks/counts', async (_request, _reply) => {
    return service.getCountsBySubject(db);
  });

  app.get('/tasks/:id', async (request, reply) => {
    const params = taskIdParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });

    const task = await service.getTask(db, params.data.id, request.userId);
    if (!task) return reply.code(404).send({ error: 'task_not_found' });
    return task;
  });

  app.post('/tasks/:id/attempt', async (request, reply) => {
    const params = taskIdParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });
    if (!request.userId) {
      return reply.code(400).send({ error: 'missing_anon_id' });
    }

    const body = attemptRequestSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: body.error.issues });
    }

    let result;
    try {
      result = await service.submitAttempt(db, params.data.id, request.userId, body.data);
    } catch (error) {
      if (error instanceof service.InvalidAnswerShapeError) {
        return reply.code(400).send({ error: 'invalid_answer_shape' });
      }
      if (error instanceof service.EssayNotGradableError) {
        return reply.code(400).send({ error: 'essay_not_gradable' });
      }
      throw error;
    }
    if (!result) return reply.code(404).send({ error: 'task_not_found' });
    return result;
  });

  // "Я решил" for an essay task — deliberately not an attempt (essay
  // tasks are never auto-graded, see EssayNotGradableError above).
  // Idempotent: a repeat click just no-ops.
  app.post('/tasks/:id/essay-ack', async (request, reply) => {
    const params = taskIdParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'invalid_id' });
    if (!request.userId) {
      return reply.code(400).send({ error: 'missing_anon_id' });
    }

    let outcome;
    try {
      outcome = await service.acknowledgeEssay(db, params.data.id, request.userId);
    } catch (error) {
      if (error instanceof service.NotAnEssayTaskError) {
        return reply.code(400).send({ error: 'not_an_essay_task' });
      }
      throw error;
    }
    if (outcome === 'not_found') return reply.code(404).send({ error: 'task_not_found' });
    return { acknowledged: true };
  });
};
