import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createImportedTestDb } from '@zybrilka/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';

describe('learning session routes (ZUBRILKA LEARNING INTELLIGENCE Phase 9)', () => {
  let testDb: Awaited<ReturnType<typeof createImportedTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let variantId: string;

  beforeAll(async () => {
    testDb = await createImportedTestDb();
    app = buildApp({ version: 'test', db: testDb.db });
    const [variant] = await testDb.db
      .select()
      .from(schema.variants)
      .where(eq(schema.variants.variantNumber, 1));
    variantId = variant!.id;
  });

  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  describe('POST /me/learning/sessions', () => {
    it('requires an x-anon-id header', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('404s when no subject can be resolved (no profile, no explicit subjectId)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions',
        headers: { 'x-anon-id': randomUUID() },
        payload: {},
      });
      expect(res.statusCode).toBe(404);
    });

    it('starts a session with default limit 5', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions',
        headers: { 'x-anon-id': randomUUID() },
        payload: { subjectId: 'math' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('active');
      expect(body.total).toBe(5);
      expect(body.position).toBe(1);
      expect(body.subject).toBe('math');
      expect(body.task.id).toBeTruthy();
      expect('correctAnswer' in body.task).toBe(false);
    });

    it('respects an explicit limit within range', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions',
        headers: { 'x-anon-id': randomUUID() },
        payload: { subjectId: 'math', limit: 3 },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().total).toBe(3);
    });

    it('400s for limit below the minimum', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions',
        headers: { 'x-anon-id': randomUUID() },
        payload: { subjectId: 'math', limit: 0 },
      });
      expect(res.statusCode).toBe(400);
    });

    it('400s for limit above the maximum', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions',
        headers: { 'x-anon-id': randomUUID() },
        payload: { subjectId: 'math', limit: 11 },
      });
      expect(res.statusCode).toBe(400);
    });

    it('404s for an explicit subjectId with no published tasks', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions',
        headers: { 'x-anon-id': randomUUID() },
        payload: { subjectId: '__nonexistent__' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('auto-resolves subject from the onboarded learning profile', async () => {
      const anonId = randomUUID();
      await app.inject({
        method: 'PUT',
        url: '/api/v1/me/learning-profile',
        headers: { 'x-anon-id': anonId },
        payload: {
          subjects: [{ subjectId: 'math', selfReportedScore: 'under_40', targetScore: '90_plus' }],
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions',
        headers: { 'x-anon-id': anonId },
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().subject).toBe('math');
    });
  });

  describe('GET /me/learning/sessions/:sessionId/next', () => {
    it('requires an x-anon-id header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/me/learning/sessions/${randomUUID()}/next`,
      });
      expect(res.statusCode).toBe(400);
    });

    it('400s for a malformed sessionId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/learning/sessions/not-a-uuid/next',
        headers: { 'x-anon-id': randomUUID() },
      });
      expect(res.statusCode).toBe(400);
    });

    it('404s for an unknown sessionId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/me/learning/sessions/${randomUUID()}/next`,
        headers: { 'x-anon-id': randomUUID() },
      });
      expect(res.statusCode).toBe(404);
    });

    it('404s when the session belongs to a different anon user', async () => {
      const owner = randomUUID();
      const attacker = randomUUID();
      const startRes = await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions',
        headers: { 'x-anon-id': owner },
        payload: { subjectId: 'math' },
      });
      const sessionId = startRes.json().sessionId;

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/me/learning/sessions/${sessionId}/next`,
        headers: { 'x-anon-id': attacker },
      });
      expect(res.statusCode).toBe(404);
    });

    it('advances through a full session end-to-end, including real attempts and completion', async () => {
      const anonId = randomUUID();
      const startRes = await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions',
        headers: { 'x-anon-id': anonId },
        payload: { subjectId: 'math', limit: 2 },
      });
      const started = startRes.json();
      expect(started.status).toBe('active');
      expect(started.position).toBe(1);

      // Submit a real answer through the EXISTING attempt endpoint —
      // the session never duplicates this write path.
      await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${started.task.id}/attempt`,
        headers: { 'x-anon-id': anonId },
        payload: { answer: '__wrong__' },
      });

      const secondRes = await app.inject({
        method: 'GET',
        url: `/api/v1/me/learning/sessions/${started.sessionId}/next`,
        headers: { 'x-anon-id': anonId },
      });
      expect(secondRes.statusCode).toBe(200);
      const second = secondRes.json();
      expect(second.status).toBe('active');
      expect(second.position).toBe(2);
      expect(second.task.id).not.toBe(started.task.id);

      const thirdRes = await app.inject({
        method: 'GET',
        url: `/api/v1/me/learning/sessions/${started.sessionId}/next`,
        headers: { 'x-anon-id': anonId },
      });
      expect(thirdRes.statusCode).toBe(200);
      const third = thirdRes.json();
      expect(third.status).toBe('completed');
      expect(third.position).toBe(2);
      expect(third.total).toBe(2);
      expect(third.summary.attempted).toBe(1);
      expect(third.summary.incorrect).toBe(1);
      expect(third.summary.correct).toBe(0);
    });

    it('is deterministic — repeated next calls on an already-completed session return the same summary', async () => {
      const anonId = randomUUID();
      const startRes = await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions',
        headers: { 'x-anon-id': anonId },
        payload: { subjectId: 'math', limit: 1 },
      });
      const started = startRes.json();

      const firstCompleted = await app.inject({
        method: 'GET',
        url: `/api/v1/me/learning/sessions/${started.sessionId}/next`,
        headers: { 'x-anon-id': anonId },
      });
      const secondCompleted = await app.inject({
        method: 'GET',
        url: `/api/v1/me/learning/sessions/${started.sessionId}/next`,
        headers: { 'x-anon-id': anonId },
      });
      expect(firstCompleted.json()).toEqual(secondCompleted.json());
    });

    it('exposes no mutation endpoint for sessions other than start/next (no DELETE/PUT)', async () => {
      const anonId = randomUUID();
      const startRes = await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions',
        headers: { 'x-anon-id': anonId },
        payload: { subjectId: 'math' },
      });
      const sessionId = startRes.json().sessionId;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/me/learning/sessions/${sessionId}`,
        headers: { 'x-anon-id': anonId },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('GET /me/learning/sessions/:sessionId (Phase 10 — refresh recovery)', () => {
    it('requires an x-anon-id header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/me/learning/sessions/${randomUUID()}`,
      });
      expect(res.statusCode).toBe(400);
    });

    it('400s for a malformed sessionId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me/learning/sessions/not-a-uuid',
        headers: { 'x-anon-id': randomUUID() },
      });
      expect(res.statusCode).toBe(400);
    });

    it('404s for an unknown sessionId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/me/learning/sessions/${randomUUID()}`,
        headers: { 'x-anon-id': randomUUID() },
      });
      expect(res.statusCode).toBe(404);
    });

    it('404s when the session belongs to a different anon user', async () => {
      const owner = randomUUID();
      const attacker = randomUUID();
      const startRes = await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions',
        headers: { 'x-anon-id': owner },
        payload: { subjectId: 'math' },
      });
      const sessionId = startRes.json().sessionId;

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/me/learning/sessions/${sessionId}`,
        headers: { 'x-anon-id': attacker },
      });
      expect(res.statusCode).toBe(404);
    });

    it('recovers the current task without advancing the session (refresh-safe)', async () => {
      const anonId = randomUUID();
      const startRes = await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions',
        headers: { 'x-anon-id': anonId },
        payload: { subjectId: 'math', limit: 5 },
      });
      const started = startRes.json();

      const snapshotRes = await app.inject({
        method: 'GET',
        url: `/api/v1/me/learning/sessions/${started.sessionId}`,
        headers: { 'x-anon-id': anonId },
      });
      expect(snapshotRes.statusCode).toBe(200);
      const snapshot = snapshotRes.json();
      expect(snapshot.status).toBe('active');
      expect(snapshot.position).toBe(1);
      expect(snapshot.task.id).toBe(started.task.id);
      // Never re-runs scoring on a plain recovery read.
      expect(snapshot.recommendation).toBeUndefined();

      // A second recovery read must still show the SAME position —
      // this endpoint must never consume a task slot on its own.
      const snapshotAgainRes = await app.inject({
        method: 'GET',
        url: `/api/v1/me/learning/sessions/${started.sessionId}`,
        headers: { 'x-anon-id': anonId },
      });
      expect(snapshotAgainRes.json().position).toBe(1);
    });

    it('returns the real completed summary once the session has finished', async () => {
      const anonId = randomUUID();
      const startRes = await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions',
        headers: { 'x-anon-id': anonId },
        payload: { subjectId: 'math', limit: 1 },
      });
      const started = startRes.json();

      await app.inject({
        method: 'GET',
        url: `/api/v1/me/learning/sessions/${started.sessionId}/next`,
        headers: { 'x-anon-id': anonId },
      });

      const snapshotRes = await app.inject({
        method: 'GET',
        url: `/api/v1/me/learning/sessions/${started.sessionId}`,
        headers: { 'x-anon-id': anonId },
      });
      expect(snapshotRes.statusCode).toBe(200);
      expect(snapshotRes.json().status).toBe('completed');
      expect(snapshotRes.json().summary).toBeDefined();
    });
  });

  describe('POST /me/learning/sessions/variant', () => {
    it('requires an x-anon-id header', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions/variant',
        payload: { variantId },
      });
      expect(res.statusCode).toBe(400);
    });

    it('400s for a malformed variantId', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions/variant',
        headers: { 'x-anon-id': randomUUID() },
        payload: { variantId: 'not-a-uuid' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('404s for an unknown variantId', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions/variant',
        headers: { 'x-anon-id': randomUUID() },
        payload: { variantId: randomUUID() },
      });
      expect(res.statusCode).toBe(404);
    });

    it('starts a real variant session with the variant own task order, never a scored recommendation', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions/variant',
        headers: { 'x-anon-id': randomUUID() },
        payload: { variantId },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('active');
      expect(body.position).toBe(1);
      expect(body.recommendation).toBeUndefined();
      expect(body.variant).toMatchObject({ variantId, variantNumber: 1 });
      expect('correctAnswer' in body.task).toBe(false);
    });

    it('next advances through the real variant order via the same /next endpoint Smart Training uses', async () => {
      const anonId = randomUUID();
      const startRes = await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions/variant',
        headers: { 'x-anon-id': anonId },
        payload: { variantId },
      });
      const started = startRes.json();

      const nextRes = await app.inject({
        method: 'GET',
        url: `/api/v1/me/learning/sessions/${started.sessionId}/next`,
        headers: { 'x-anon-id': anonId },
      });
      expect(nextRes.statusCode).toBe(200);
      const next = nextRes.json();
      expect(next.status).toBe('active');
      expect(next.position).toBe(2);
      expect(next.task.id).not.toBe(started.task.id);
      expect(next.recommendation).toBeUndefined();
      expect(next.variant).toMatchObject({ variantId, variantNumber: 1 });
    });
  });

  describe('POST /me/learning/sessions/:id/open and /finish (variant number panel)', () => {
    async function startAs(anonId: string) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions/variant',
        headers: { 'x-anon-id': anonId },
        payload: { variantId },
      });
      return res.json() as { sessionId: string; task: { id: string } };
    }
    async function plannedTaskIds() {
      const rows = await testDb.db
        .select()
        .from(schema.variantTasks)
        .where(eq(schema.variantTasks.variantId, variantId))
        .orderBy(schema.variantTasks.position);
      return rows.map((r) => r.taskId);
    }

    it('opens any planned task of the own session, with its plan position, no answer shown', async () => {
      const anonId = randomUUID();
      const started = await startAs(anonId);
      const planned = await plannedTaskIds();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/me/learning/sessions/${started.sessionId}/open`,
        headers: { 'x-anon-id': anonId },
        payload: { taskId: planned[4] },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.task.id).toBe(planned[4]);
      expect(body.position).toBe(5);
      expect('correctAnswer' in body.task).toBe(false);
    });

    it('someone else cannot open or finish the session (404, nothing changes)', async () => {
      const owner = randomUUID();
      const started = await startAs(owner);
      const planned = await plannedTaskIds();
      const intruder = randomUUID();
      const open = await app.inject({
        method: 'POST',
        url: `/api/v1/me/learning/sessions/${started.sessionId}/open`,
        headers: { 'x-anon-id': intruder },
        payload: { taskId: planned[2] },
      });
      expect(open.statusCode).toBe(404);
      const finish = await app.inject({
        method: 'POST',
        url: `/api/v1/me/learning/sessions/${started.sessionId}/finish`,
        headers: { 'x-anon-id': intruder },
      });
      expect(finish.statusCode).toBe(404);
      const snapshot = await app.inject({
        method: 'GET',
        url: `/api/v1/me/learning/sessions/${started.sessionId}`,
        headers: { 'x-anon-id': owner },
      });
      expect(snapshot.json()).toMatchObject({ status: 'active', task: { id: started.task.id } });
    });

    it('rejects a malformed task id (400) and a task outside the variant (404)', async () => {
      const anonId = randomUUID();
      const started = await startAs(anonId);
      const bad = await app.inject({
        method: 'POST',
        url: `/api/v1/me/learning/sessions/${started.sessionId}/open`,
        headers: { 'x-anon-id': anonId },
        payload: { taskId: 'nope' },
      });
      expect(bad.statusCode).toBe(400);
      const outside = await app.inject({
        method: 'POST',
        url: `/api/v1/me/learning/sessions/${started.sessionId}/open`,
        headers: { 'x-anon-id': anonId },
        payload: { taskId: randomUUID() },
      });
      expect(outside.statusCode).toBe(404);
    });

    it('finish completes the own variant session and is idempotent', async () => {
      const anonId = randomUUID();
      const started = await startAs(anonId);
      for (let i = 0; i < 2; i++) {
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/me/learning/sessions/${started.sessionId}/finish`,
          headers: { 'x-anon-id': anonId },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ status: 'completed', variant: { variantId } });
      }
    });
  });

  describe('GET /progress/variants', () => {
    it('requires an x-anon-id header', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/progress/variants' });
      expect(res.statusCode).toBe(400);
    });

    it('a brand-new user has no variant history', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/progress/variants',
        headers: { 'x-anon-id': randomUUID() },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toEqual([]);
    });

    it('a Smart Training session never appears in variant history', async () => {
      const anonId = randomUUID();
      await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions',
        headers: { 'x-anon-id': anonId },
        payload: { subjectId: 'math' },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/progress/variants',
        headers: { 'x-anon-id': anonId },
      });
      expect(res.json().items).toEqual([]);
    });

    it('shows a real started variant session, newest first', async () => {
      const anonId = randomUUID();
      const startRes = await app.inject({
        method: 'POST',
        url: '/api/v1/me/learning/sessions/variant',
        headers: { 'x-anon-id': anonId },
        payload: { variantId },
      });
      const started = startRes.json();

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/progress/variants',
        headers: { 'x-anon-id': anonId },
      });
      expect(res.statusCode).toBe(200);
      const items = res.json().items;
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        sessionId: started.sessionId,
        variantId,
        variantNumber: 1,
        status: 'active',
        solvedCount: 0,
      });
      expect(items[0].plannedCount).toBeGreaterThan(0);
    });
  });
});
