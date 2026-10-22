import type { Database } from '@zybrilka/db';
import {
  progressByTaskNumberQuerySchema,
  progressByTopicQuerySchema,
  progressDailyQuerySchema,
  taskNumberStatisticsDetailQuerySchema,
} from '@zybrilka/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import * as service from './service.js';

const taskNumberParamsSchema = z.object({ taskNumber: z.coerce.number().int().positive() });

const DEFAULT_DAILY_DAYS = 30;

export interface ProgressRoutesOptions {
  db: Database;
}

export const progressRoutes: FastifyPluginAsync<ProgressRoutesOptions> = async (app, { db }) => {
  app.get('/progress/summary', async (request, reply) => {
    if (!request.userId) {
      return reply.code(400).send({ error: 'missing_anon_id' });
    }
    return service.getSummary(db, request.userId);
  });

  // Real per-task-number coverage (X/Y on the "По номерам" screen) —
  // see apps/api/src/modules/progress/repo.ts for how total/completed
  // are computed. Registered before any parameterized route would be
  // needed here; there isn't one on this plugin, but kept consistent
  // with the tasksRoutes ordering convention regardless.
  app.get('/progress/by-task-number', async (request, reply) => {
    if (!request.userId) {
      return reply.code(400).send({ error: 'missing_anon_id' });
    }
    const query = progressByTaskNumberQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'invalid_query', issues: query.error.issues });
    }
    return service.getByTaskNumberWithTotals(db, request.userId, query.data);
  });

  // Real per-topic coverage (X/Y on "Темы") — same total/completed
  // contract and source-isolation rules as /progress/by-task-number,
  // grouped by the real `topics` table instead of task number.
  app.get('/progress/by-topic', async (request, reply) => {
    if (!request.userId) {
      return reply.code(400).send({ error: 'missing_anon_id' });
    }
    const query = progressByTopicQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'invalid_query', issues: query.error.issues });
    }
    return service.getByTopicWithTotals(db, request.userId, query.data);
  });

  // Real per-day activity for the "Активность по дням" chart — see
  // apps/api/src/modules/progress/repo.ts's getDaily for the UTC-day
  // bucketing and distinct-task dedup rules.
  app.get('/progress/daily', async (request, reply) => {
    if (!request.userId) {
      return reply.code(400).send({ error: 'missing_anon_id' });
    }
    const query = progressDailyQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'invalid_query', issues: query.error.issues });
    }
    return service.getDaily(
      db,
      request.userId,
      query.data.days ?? DEFAULT_DAILY_DAYS,
      query.data.subject,
    );
  });

  // Streak system — real server-computed state, see
  // packages/shared/src/learning/streak.ts. Frontend (mobile + desktop
  // header chips) only ever reads this; it never computes its own.
  app.get('/progress/streak', async (request, reply) => {
    if (!request.userId) {
      return reply.code(400).send({ error: 'missing_anon_id' });
    }
    return service.getStreak(db, request.userId);
  });

  // Statistics 2.0 — the "По номерам → №N" detail (Step 15). `subject`
  // is required (unlike the coverage endpoints above) since a detail
  // view only ever makes sense for one chosen subject.
  app.get('/progress/by-task-number/:taskNumber/detail', async (request, reply) => {
    if (!request.userId) {
      return reply.code(400).send({ error: 'missing_anon_id' });
    }
    const params = taskNumberParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'invalid_params', issues: params.error.issues });
    }
    const query = taskNumberStatisticsDetailQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'invalid_query', issues: query.error.issues });
    }
    return service.getTaskNumberStatisticsDetail(
      db,
      request.userId,
      query.data.subject,
      params.data.taskNumber,
    );
  });
};

/**
 * The public topic list (names + how many published tasks each has) for
 * Тренировка → «По теме» and a subject's «Темы» — open to guests. Same
 * shape as /progress/by-topic, but `completed` is always 0 here: nothing
 * personal is read, whoever asks. Signed-in screens keep using
 * /progress/by-topic for their real progress.
 */
export const publicTopicsRoutes: FastifyPluginAsync<ProgressRoutesOptions> = async (
  app,
  { db },
) => {
  app.get('/topics', async (request, reply) => {
    const query = progressByTopicQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: 'invalid_query', issues: query.error.issues });
    }
    return service.getByTopicWithTotals(db, null, query.data);
  });
};
