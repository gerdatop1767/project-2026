import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createSeededTestDb } from '@zybrilka/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';

/** «Убрать из ошибок» (production auth setup): hides the user's own mistake,
 * keeps its history and the task, can be undone, reopens on a new error. */
describe('dismissing a mistake', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let task: { id: string; correctAnswer: string };

  async function signedIn() {
    const [user] = await testDb.db.insert(schema.users).values({}).returning();
    const sessionId = randomUUID();
    await testDb.db
      .insert(schema.authSessions)
      .values({ id: sessionId, userId: user!.id, expiresAt: new Date(Date.now() + 3_600_000) });
    return { userId: user!.id, cookie: `session_id=${sessionId}` };
  }
  const call = (method: 'GET' | 'POST', url: string, cookie?: string, payload?: object) =>
    app.inject({ method, url, headers: cookie ? { cookie } : {}, ...(payload ? { payload } : {}) });

  beforeAll(async () => {
    testDb = await createSeededTestDb();
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test' }),
    });
    const [row] = await testDb.db
      .select({ id: schema.tasks.id, correctAnswer: schema.tasks.correctAnswer })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.answerType, 'short_answer'), eq(schema.tasks.status, 'published')))
      .limit(1);
    task = row!;
  });
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  it('hides it from the list, keeps the row and the task, and can be undone', async () => {
    const me = await signedIn();
    await call('POST', `/api/v1/tasks/${task.id}/attempt`, me.cookie, { answer: 'wrong-1' });
    const list = (await call('GET', '/api/v1/mistakes', me.cookie)).json().items;
    expect(list).toHaveLength(1);
    const id = list[0].id as string;

    const dismissed = await call('POST', `/api/v1/mistakes/${id}/dismiss`, me.cookie);
    expect(dismissed.statusCode).toBe(200);
    expect(dismissed.json()).toEqual({ id, status: 'dismissed' });
    expect((await call('GET', '/api/v1/mistakes', me.cookie)).json().items).toHaveLength(0);
    // Idempotent.
    expect((await call('POST', `/api/v1/mistakes/${id}/dismiss`, me.cookie)).statusCode).toBe(200);

    const [row] = await testDb.db.select().from(schema.mistakes).where(eq(schema.mistakes.id, id));
    expect(row).toMatchObject({ status: 'dismissed', timesWrong: 1 });
    const [stillThere] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, task.id));
    expect(stillThere).toBeDefined();

    const restored = await call('POST', `/api/v1/mistakes/${id}/restore`, me.cookie);
    expect(restored.json()).toEqual({ id, status: 'open' });
    expect((await call('GET', '/api/v1/mistakes', me.cookie)).json().items).toHaveLength(1);
  });

  it('restores a mistake that was already solved as resolved', async () => {
    const me = await signedIn();
    await call('POST', `/api/v1/tasks/${task.id}/attempt`, me.cookie, { answer: 'wrong-1' });
    await call('POST', `/api/v1/tasks/${task.id}/attempt`, me.cookie, {
      answer: task.correctAnswer,
    });
    const id = (await call('GET', '/api/v1/mistakes', me.cookie)).json().items[0].id as string;
    await call('POST', `/api/v1/mistakes/${id}/dismiss`, me.cookie);
    expect((await call('POST', `/api/v1/mistakes/${id}/restore`, me.cookie)).json().status).toBe(
      'resolved',
    );
  });

  it('a new wrong answer brings a dismissed mistake back', async () => {
    const me = await signedIn();
    await call('POST', `/api/v1/tasks/${task.id}/attempt`, me.cookie, { answer: 'wrong-1' });
    const id = (await call('GET', '/api/v1/mistakes', me.cookie)).json().items[0].id as string;
    await call('POST', `/api/v1/mistakes/${id}/dismiss`, me.cookie);
    await call('POST', `/api/v1/tasks/${task.id}/attempt`, me.cookie, { answer: 'wrong-2' });
    const items = (await call('GET', '/api/v1/mistakes', me.cookie)).json().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id, status: 'open', timesWrong: 2 });
  });

  it("someone else's mistake, an unknown id, a guest: never", async () => {
    const owner = await signedIn();
    const other = await signedIn();
    await call('POST', `/api/v1/tasks/${task.id}/attempt`, owner.cookie, { answer: 'wrong-1' });
    const id = (await call('GET', '/api/v1/mistakes', owner.cookie)).json().items[0].id as string;
    expect((await call('POST', `/api/v1/mistakes/${id}/dismiss`, other.cookie)).statusCode).toBe(
      404,
    );
    expect((await call('POST', `/api/v1/mistakes/${id}/restore`, other.cookie)).statusCode).toBe(
      404,
    );
    expect(
      (await call('POST', `/api/v1/mistakes/${randomUUID()}/dismiss`, owner.cookie)).statusCode,
    ).toBe(404);
    expect(
      (await call('POST', `/api/v1/mistakes/not-a-uuid/dismiss`, owner.cookie)).statusCode,
    ).toBe(400);
    expect((await call('POST', `/api/v1/mistakes/${id}/dismiss`)).statusCode).toBe(401);
    expect((await call('GET', '/api/v1/mistakes', owner.cookie)).json().items).toHaveLength(1);
  });
});
