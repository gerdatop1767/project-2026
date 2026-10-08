import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createSeededTestDb } from '@zybrilka/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';

describe('tasks routes', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    testDb = await createSeededTestDb();
    app = buildApp({ version: 'test', db: testDb.db });
  });

  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  it('GET /api/v1/tasks lists published tasks without the answer or explanation', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks?subject=math' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(item).not.toHaveProperty('correctAnswer');
      expect(item).not.toHaveProperty('explanationMd');
    }
  });

  it('filters by taskNumber', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks?subject=math&taskNumber=3' });
    const body = res.json();
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) {
      expect(item.taskNumber).toBe(3);
    }
  });

  it('GET /api/v1/tasks/counts returns real published-task counts per subject, "counts" not swallowed by /tasks/:id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks/counts' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    const math = body.items.find((item: { subjectId: string }) => item.subjectId === 'math');
    expect(math).toBeDefined();
    expect(math.count).toBeGreaterThan(0);
    const mathTasks = await testDb.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.subjectId, 'math'));
    const publishedMathCount = mathTasks.filter((t) => t.status === 'published').length;
    expect(math.count).toBe(publishedMathCount);
  });

  it('GET /api/v1/tasks/:id returns 404 for an unknown id', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/tasks/${randomUUID()}` });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/v1/tasks/:id never includes the answer before an attempt exists', async () => {
    const [task] = await testDb.db.select().from(schema.tasks).limit(1);
    const res = await app.inject({ method: 'GET', url: `/api/v1/tasks/${task!.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('correctAnswer');
  });

  it('GET /api/v1/tasks/random respects filters and returns a task without the answer', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks/random?subject=math&taskNumber=1',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.taskNumber).toBe(1);
    expect(body).not.toHaveProperty('correctAnswer');
  });

  it('GET /api/v1/tasks/random 404s when nothing matches', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks/random?subject=does-not-exist',
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/v1/tasks/random respects a topic filter', async () => {
    const [task] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.status, 'published'))
      .limit(1);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/random?topic=${task!.topicId}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().topicId).toBe(task!.topicId);
  });

  it('GET /api/v1/tasks/random 404s for a topic with no published tasks', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/random?topic=${randomUUID()}`,
    });
    expect(res.statusCode).toBe(404);
  });

  describe('GET /api/v1/tasks/random?unseen=true (Training "Не встречавшиеся")', () => {
    it('requires x-anon-id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/tasks/random?subject=math&taskNumber=1&unseen=true',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'missing_anon_id' });
    });

    it('never returns a task the user already has an attempt on, across repeated calls', async () => {
      const anonId = randomUUID();
      const seen = new Set<string>();
      // The seed has exactly 2 published tasks under subject=math,
      // taskNumber=1 — draining the unseen pool one real attempt at a
      // time proves this is a real server-side filter, not luck.
      for (let i = 0; i < 2; i += 1) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/tasks/random?subject=math&taskNumber=1&unseen=true',
          headers: { 'x-anon-id': anonId },
        });
        expect(res.statusCode).toBe(200);
        const task = res.json();
        expect(seen.has(task.id)).toBe(false); // no duplicates
        seen.add(task.id);
        await app.inject({
          method: 'POST',
          url: `/api/v1/tasks/${task.id}/attempt`,
          headers: { 'x-anon-id': anonId },
          payload: { answer: 'definitely wrong' },
        });
      }
      expect(seen.size).toBe(2);
    });

    it('returns a controlled 404 "no_unseen_tasks" once every task of that number is attempted — never a fallback to a seen one', async () => {
      const anonId = randomUUID();
      for (let i = 0; i < 2; i += 1) {
        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/tasks/random?subject=math&taskNumber=1&unseen=true',
          headers: { 'x-anon-id': anonId },
        });
        const task = res.json();
        await app.inject({
          method: 'POST',
          url: `/api/v1/tasks/${task.id}/attempt`,
          headers: { 'x-anon-id': anonId },
          payload: { answer: 'definitely wrong' },
        });
      }
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/tasks/random?subject=math&taskNumber=1&unseen=true',
        headers: { 'x-anon-id': anonId },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'no_unseen_tasks' });
    });

    it('works generically for an arbitrary taskNumber, never hardcoded to one number', async () => {
      const anonId = randomUUID();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/tasks/random?subject=math&taskNumber=4&unseen=true',
        headers: { 'x-anon-id': anonId },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().taskNumber).toBe(4);
    });

    it('without unseen, an already-attempted task can still be returned (default/"Обычные" behavior unchanged)', async () => {
      const anonId = randomUUID();
      const [task] = await testDb.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.taskNumber, 3));
      await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${task!.id}/attempt`,
        headers: { 'x-anon-id': anonId },
        payload: { answer: 'definitely wrong' },
      });
      // No `unseen` param — repeated random picks may legitimately
      // include the already-attempted task, so this only asserts the
      // request itself isn't rejected/filtered.
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/tasks/random?subject=math&taskNumber=3',
        headers: { 'x-anon-id': anonId },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('GET /api/v1/tasks?unsolved=true ("По номерам" — «Только нерешённые»)', () => {
    // Deliberately a DIFFERENT filter from `/tasks/random`'s `unseen`
    // (excludes on ANY attempt, correct or not). `unsolved` excludes
    // only on a CORRECT attempt — a task answered wrong 10 times with
    // zero correct attempts must still come back.
    it('requires x-anon-id, same as unseen elsewhere — never silently skips the filter', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/tasks?subject=math&taskNumber=1&unsolved=true',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'missing_anon_id' });
    });

    it('excludes a task with a CORRECT attempt on record', async () => {
      const anonId = randomUUID();
      const tasks = await testDb.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.taskNumber, 1));
      expect(tasks.length).toBe(2);
      const [solved, unsolved] = tasks;
      await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${solved!.id}/attempt`,
        headers: { 'x-anon-id': anonId },
        payload: { answer: solved!.correctAnswer },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/tasks?subject=math&taskNumber=1&unsolved=true',
        headers: { 'x-anon-id': anonId },
      });
      const ids = res.json().items.map((t: { id: string }) => t.id);
      expect(ids).not.toContain(solved!.id);
      expect(ids).toContain(unsolved!.id);
    });

    it('keeps a task that was only answered WRONG — 10 incorrect attempts, zero correct, still counts as unsolved', async () => {
      const anonId = randomUUID();
      const [task] = await testDb.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.taskNumber, 3));
      for (let i = 0; i < 10; i += 1) {
        await app.inject({
          method: 'POST',
          url: `/api/v1/tasks/${task!.id}/attempt`,
          headers: { 'x-anon-id': anonId },
          payload: { answer: 'definitely wrong' },
        });
      }
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/tasks?subject=math&taskNumber=3&unsolved=true',
        headers: { 'x-anon-id': anonId },
      });
      const ids = res.json().items.map((t: { id: string }) => t.id);
      expect(ids).toContain(task!.id);
    });

    it('identifies by taskId, not taskNumber — a different task sharing the same number is unaffected by a sibling being solved', async () => {
      const anonId = randomUUID();
      const tasks = await testDb.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.taskNumber, 1));
      const [first, second] = tasks;
      await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${first!.id}/attempt`,
        headers: { 'x-anon-id': anonId },
        payload: { answer: first!.correctAnswer },
      });
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/tasks?subject=math&taskNumber=1&unsolved=true',
        headers: { 'x-anon-id': anonId },
      });
      const ids = res.json().items.map((t: { id: string }) => t.id);
      expect(ids).toContain(second!.id);
      expect(ids).not.toContain(first!.id);
    });

    it('returns an empty list (never a fallback) once every task of that number is solved correctly', async () => {
      const anonId = randomUUID();
      const tasks = await testDb.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.taskNumber, 1));
      for (const task of tasks) {
        await app.inject({
          method: 'POST',
          url: `/api/v1/tasks/${task.id}/attempt`,
          headers: { 'x-anon-id': anonId },
          payload: { answer: task.correctAnswer },
        });
      }
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/tasks?subject=math&taskNumber=1&unsolved=true',
        headers: { 'x-anon-id': anonId },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().items).toEqual([]);
    });

    it('without unsolved, an already-correctly-solved task is still listed (default behavior unchanged)', async () => {
      const anonId = randomUUID();
      const [task] = await testDb.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.taskNumber, 5));
      await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${task!.id}/attempt`,
        headers: { 'x-anon-id': anonId },
        payload: { answer: task!.correctAnswer },
      });
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/tasks?subject=math&taskNumber=5',
        headers: { 'x-anon-id': anonId },
      });
      const ids = res.json().items.map((t: { id: string }) => t.id);
      expect(ids).toContain(task!.id);
    });
  });

  describe('POST /api/v1/tasks/:id/attempt', () => {
    it('requires an x-anon-id header', async () => {
      const [task] = await testDb.db.select().from(schema.tasks).limit(1);
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${task!.id}/attempt`,
        payload: { answer: '4' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('grades server-side and ignores a client-supplied "correct" flag', async () => {
      const [task] = await testDb.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.taskNumber, 1));
      const anonId = randomUUID();

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${task!.id}/attempt`,
        headers: { 'x-anon-id': anonId },
        // A malicious client claiming correct:true for a wrong answer.
        payload: { answer: 'definitely wrong', correct: true },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.correct).toBe(false);
      expect(body.correctAnswer).toBe(task!.correctAnswer);
      expect(body.mistakeId).not.toBeNull();
    });

    it('records a correct attempt with no mistake', async () => {
      const [task] = await testDb.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.taskNumber, 5));
      const anonId = randomUUID();

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${task!.id}/attempt`,
        headers: { 'x-anon-id': anonId },
        payload: { answer: task!.correctAnswer },
      });

      const body = res.json();
      expect(body.correct).toBe(true);
      expect(body.mistakeId).toBeNull();
    });

    it('a repeated wrong answer increments the mistake, and history is never deleted', async () => {
      const [task] = await testDb.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.taskNumber, 2));
      const anonId = randomUUID();

      await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${task!.id}/attempt`,
        headers: { 'x-anon-id': anonId },
        payload: { answer: 'wrong once' },
      });
      const second = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${task!.id}/attempt`,
        headers: { 'x-anon-id': anonId },
        payload: { answer: 'wrong twice' },
      });
      expect(second.json().correct).toBe(false);

      const [mistake] = await testDb.db
        .select()
        .from(schema.mistakes)
        .where(eq(schema.mistakes.taskId, task!.id));
      expect(mistake?.timesWrong).toBe(2);
      expect(mistake?.status).toBe('open');

      const allAttempts = await testDb.db
        .select()
        .from(schema.attempts)
        .where(eq(schema.attempts.taskId, task!.id));
      expect(allAttempts.length).toBe(2);
    });

    it('resolves a mistake on a later correct attempt without deleting attempt history', async () => {
      const [task] = await testDb.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.taskNumber, 4));
      const anonId = randomUUID();

      await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${task!.id}/attempt`,
        headers: { 'x-anon-id': anonId },
        payload: { answer: 'nope' },
      });
      await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${task!.id}/attempt`,
        headers: { 'x-anon-id': anonId },
        payload: { answer: task!.correctAnswer },
      });

      const [mistake] = await testDb.db
        .select()
        .from(schema.mistakes)
        .where(eq(schema.mistakes.taskId, task!.id));
      expect(mistake?.status).toBe('resolved');
      expect(mistake?.timesWrong).toBe(1);

      const allAttempts = await testDb.db
        .select()
        .from(schema.attempts)
        .where(eq(schema.attempts.taskId, task!.id));
      expect(allAttempts.length).toBe(2);
    });

    it('includes the answer and explanation once an attempt has been made', async () => {
      const [task] = await testDb.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.taskNumber, 1))
        .limit(1);
      const anonId = randomUUID();

      await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${task!.id}/attempt`,
        headers: { 'x-anon-id': anonId },
        payload: { answer: task!.correctAnswer },
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/tasks/${task!.id}`,
        headers: { 'x-anon-id': anonId },
      });
      const body = res.json();
      expect(body.correctAnswer).toBe(task!.correctAnswer);
      expect(body.explanationMd).toBe(task!.explanationMd);
    });

    it('returns 404 attempting a task that does not exist', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${randomUUID()}/attempt`,
        headers: { 'x-anon-id': randomUUID() },
        payload: { answer: '1' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('rejects an invalid x-anon-id header the same as a missing one', async () => {
      const [task] = await testDb.db.select().from(schema.tasks).limit(1);
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${task!.id}/attempt`,
        headers: { 'x-anon-id': 'not-a-uuid' },
        payload: { answer: '1' },
      });
      expect(res.statusCode).toBe(400);
    });

    // Streak system (CLAUDE.md): a submitted attempt is real daily
    // activity regardless of correctness — these prove the service's
    // same-transaction `recordDailyActivity` call actually runs, not
    // just that it typechecks.
    describe('streak — daily activity recording', () => {
      it('a submitted attempt (correct or not) records one activity row for today', async () => {
        const [task] = await testDb.db.select().from(schema.tasks).limit(1);
        const anonId = randomUUID();

        await app.inject({
          method: 'POST',
          url: `/api/v1/tasks/${task!.id}/attempt`,
          headers: { 'x-anon-id': anonId },
          // Deliberately wrong — activity must be recorded either way.
          payload: { answer: 'definitely wrong' },
        });

        const rows = await testDb.db
          .select()
          .from(schema.userDailyActivity)
          .where(eq(schema.userDailyActivity.userId, anonId));
        expect(rows).toHaveLength(1);
      });

      it('two attempts the same day never create two activity rows (idempotent upsert)', async () => {
        const [taskA, taskB] = await testDb.db.select().from(schema.tasks).limit(2);
        const anonId = randomUUID();

        await app.inject({
          method: 'POST',
          url: `/api/v1/tasks/${taskA!.id}/attempt`,
          headers: { 'x-anon-id': anonId },
          payload: { answer: 'wrong-1' },
        });
        await app.inject({
          method: 'POST',
          url: `/api/v1/tasks/${taskB!.id}/attempt`,
          headers: { 'x-anon-id': anonId },
          payload: { answer: 'wrong-2' },
        });

        const rows = await testDb.db
          .select()
          .from(schema.userDailyActivity)
          .where(eq(schema.userDailyActivity.userId, anonId));
        expect(rows).toHaveLength(1);
      });

      it('GET /progress/streak reflects a streak of 1 right after the first-ever attempt', async () => {
        const [task] = await testDb.db.select().from(schema.tasks).limit(1);
        const anonId = randomUUID();

        await app.inject({
          method: 'POST',
          url: `/api/v1/tasks/${task!.id}/attempt`,
          headers: { 'x-anon-id': anonId },
          payload: { answer: 'wrong' },
        });

        const res = await app.inject({
          method: 'GET',
          url: '/api/v1/progress/streak',
          headers: { 'x-anon-id': anonId },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ currentStreak: 1, isActiveToday: true });
      });
    });
  });
});
