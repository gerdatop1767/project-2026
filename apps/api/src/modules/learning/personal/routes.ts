import type { Database } from '@zybrilka/db';
import { isExamSkillSlug, notificationPreferencesSchema } from '@zybrilka/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import * as plans from './plans.js';
import * as prefs from './preferences.js';
import * as service from './service.js';

const subjectEnum = z.enum(['math', 'russian']);
const skillParams = z.object({
  skillKey: z.string().max(80).refine(isExamSkillSlug, 'unknown_skill'),
});
const planParams = z.object({ planId: z.uuid() });
const dayParams = planParams.extend({ dayIndex: z.coerce.number().int().min(0).max(40) });
const createBody = z.object({
  subjectId: subjectEnum,
  kind: z.enum(['week', 'month']),
  replace: z.boolean().optional(),
  timezone: z.string().max(64).optional(),
});

/**
 * Personal learning (docs/learning/PERSONAL-PLANS.md § API). Private scope:
 * without a session the routes answer 401 in production; the student comes
 * only from the session, and a plan id of another student reads as 404.
 */
export const personalLearningRoutes: FastifyPluginAsync<{ db: Database }> = async (app, { db }) => {
  app.addHook('onSend', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
  });

  app.get('/me/learning/personal', async (request, reply) => {
    if (!request.userId) return reply.code(400).send({ error: 'missing_anon_id' });
    const q = z
      .object({
        subject: subjectEnum.optional(),
        limit: z.coerce.number().int().min(1).max(12).optional(),
      })
      .safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });
    return service.getPersonalRecommendations(db, request.userId, {
      subjectId: q.data.subject,
      limit: q.data.limit,
    });
  });

  app.get('/me/learning/skills/:skillKey/advice', async (request, reply) => {
    if (!request.userId) return reply.code(400).send({ error: 'missing_anon_id' });
    const p = skillParams.safeParse(request.params);
    if (!p.success) return reply.code(400).send({ error: 'invalid_skill' });
    const r = await service.getAdvice(db, request.userId, p.data.skillKey);
    return r ?? reply.code(404).send({ error: 'skill_not_found' });
  });

  app.get('/me/learning/skills/:skillKey/progress', async (request, reply) => {
    if (!request.userId) return reply.code(400).send({ error: 'missing_anon_id' });
    const p = skillParams.safeParse(request.params);
    if (!p.success) return reply.code(400).send({ error: 'invalid_skill' });
    const r = await service.getSkillProgress(db, request.userId, p.data.skillKey);
    return r ?? reply.code(404).send({ error: 'skill_not_found' });
  });

  app.get('/me/learning/plans/current', async (request, reply) => {
    if (!request.userId) return reply.code(400).send({ error: 'missing_anon_id' });
    const q = z.object({ subject: subjectEnum }).safeParse(request.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query' });
    return { plan: await plans.getCurrentPlan(db, request.userId, q.data.subject) };
  });

  app.post('/me/learning/plans', async (request, reply) => {
    if (!request.userId) return reply.code(400).send({ error: 'missing_anon_id' });
    const b = createBody.safeParse(request.body ?? {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_body' });
    const r = await plans.createPlan(db, request.userId, b.data);
    if (!r.ok) {
      return reply.code(r.error === 'plan_exists' ? 409 : 422).send({ error: r.error });
    }
    return reply.code(201).send({ plan: r.plan });
  });

  app.get('/me/learning/plans/:planId', async (request, reply) => {
    if (!request.userId) return reply.code(400).send({ error: 'missing_anon_id' });
    const p = planParams.safeParse(request.params);
    if (!p.success) return reply.code(400).send({ error: 'invalid_id' });
    const plan = await plans.getPlan(db, request.userId, p.data.planId);
    return plan ? { plan } : reply.code(404).send({ error: 'plan_not_found' });
  });

  for (const action of ['skip', 'move'] as const) {
    app.post(`/me/learning/plans/:planId/days/:dayIndex/${action}`, async (request, reply) => {
      if (!request.userId) return reply.code(400).send({ error: 'missing_anon_id' });
      const p = dayParams.safeParse(request.params);
      if (!p.success) return reply.code(400).send({ error: 'invalid_id' });
      const r = await (action === 'skip' ? plans.skipPlanDay : plans.movePlanDay)(
        db,
        request.userId,
        p.data.planId,
        p.data.dayIndex,
      );
      if (!r.ok) {
        return reply
          .code(r.error === 'not_found' ? 404 : 409)
          .send({ error: r.error === 'not_found' ? 'plan_not_found' : 'day_not_changeable' });
      }
      return { plan: r.plan };
    });
  }

  app.post('/me/learning/plans/:planId/cancel', async (request, reply) => {
    if (!request.userId) return reply.code(400).send({ error: 'missing_anon_id' });
    const p = planParams.safeParse(request.params);
    if (!p.success) return reply.code(400).send({ error: 'invalid_id' });
    const ok = await plans.cancelPlan(db, request.userId, p.data.planId);
    return ok ? { ok: true } : reply.code(404).send({ error: 'plan_not_found' });
  });

  app.get('/me/notifications/progress', async (request, reply) => {
    if (!request.userId) return reply.code(400).send({ error: 'missing_anon_id' });
    return prefs.getPreferences(db, request.userId);
  });

  app.put('/me/notifications/progress', async (request, reply) => {
    if (!request.userId) return reply.code(400).send({ error: 'missing_anon_id' });
    const b = notificationPreferencesSchema.safeParse(request.body ?? {});
    if (!b.success) return reply.code(400).send({ error: 'invalid_body' });
    return prefs.savePreferences(db, request.userId, b.data);
  });
};
