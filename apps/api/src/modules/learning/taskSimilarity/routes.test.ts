import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createImportedTestDb } from '@zybrilka/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';

describe('GET /tasks/:taskId/similar (ZUBRILKA LEARNING INTELLIGENCE Phase 6)', () => {
  let testDb: Awaited<ReturnType<typeof createImportedTestDb>>;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    testDb = await createImportedTestDb();
    app = buildApp({ version: 'test', db: testDb.db });
  });

  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  async function anyRealTask() {
    const [task] = await testDb.db.select().from(schema.tasks).limit(1);
    return task!;
  }

  it('404s for a task id that does not exist', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/tasks/${randomUUID()}/similar` });
    expect(res.statusCode).toBe(404);
  });

  it('`exclude` leaves out the tasks the client is already showing; a bad list is a 400', async () => {
    const task = await anyRealTask();
    const all = (
      await app.inject({ method: 'GET', url: `/api/v1/tasks/${task.id}/similar?limit=20` })
    ).json().items as { taskId: string }[];
    if (all.length > 0) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/tasks/${task.id}/similar?limit=20&exclude=${all[0]!.taskId}`,
      });
      expect(res.statusCode).toBe(200);
      const ids = (res.json().items as { taskId: string }[]).map((i) => i.taskId);
      expect(ids).not.toContain(all[0]!.taskId);
      expect(res.headers['cache-control']).toContain('no-store');
    }
    const bad = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${task.id}/similar?exclude=not-a-uuid`,
    });
    expect(bad.statusCode).toBe(400);
  });

  it('400s for a malformed id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/tasks/not-a-uuid/similar' });
    expect(res.statusCode).toBe(400);
  });

  it('returns an items array for a real task, same for every requester (no user scoping)', async () => {
    const task = await anyRealTask();
    const resAsUserA = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${task.id}/similar`,
      headers: { 'x-anon-id': randomUUID() },
    });
    const resNoAnon = await app.inject({ method: 'GET', url: `/api/v1/tasks/${task.id}/similar` });

    expect(resAsUserA.statusCode).toBe(200);
    expect(resAsUserA.json()).toEqual(resNoAnon.json());
    expect(Array.isArray(resAsUserA.json().items)).toBe(true);
  });

  it('never includes the task itself in its own similar list', async () => {
    const task = await anyRealTask();
    const res = await app.inject({ method: 'GET', url: `/api/v1/tasks/${task.id}/similar` });
    const items = res.json().items as Array<{ taskId: string }>;
    expect(items.some((item) => item.taskId === task.id)).toBe(false);
  });

  it('respects the limit query param', async () => {
    const task = await anyRealTask();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${task.id}/similar?limit=2`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.length).toBeLessThanOrEqual(2);
  });

  it('400s for an out-of-range limit', async () => {
    const task = await anyRealTask();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${task.id}/similar?limit=0`,
    });
    expect(res.statusCode).toBe(400);
  });

  it('every returned score is within 0..100', async () => {
    const [task] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.taskNumber, 13));
    const res = await app.inject({ method: 'GET', url: `/api/v1/tasks/${task!.id}/similar` });
    const items = res.json().items as Array<{ score: number }>;
    for (const item of items) {
      expect(item.score).toBeGreaterThanOrEqual(0);
      expect(item.score).toBeLessThanOrEqual(100);
    }
  });

  it('exposes no mutation endpoint for similarity (GET only)', async () => {
    const task = await anyRealTask();
    const postRes = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/similar`,
      payload: {},
    });
    expect(postRes.statusCode).toBe(404);
  });
});
