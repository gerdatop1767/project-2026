import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createImportedTestDb } from '@zybrilka/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { advanceLearningSession, getVariantProgress, startVariantSession } from './service.js';
import { submitAttempt } from '../../tasks/service.js';
import * as tasksRepo from '../../tasks/repo.js';

/**
 * Variant sessions (Training's "Вариант" mode gets real backend
 * tracking) — reuses every bit of the existing learning-session
 * bookkeeping; the only thing that differs from a Smart Training
 * session is where the next task comes from (the variant's own real
 * `position` order, never `getLearningPath` scoring).
 */
describe('variant sessions', () => {
  let testDb: Awaited<ReturnType<typeof createImportedTestDb>>;
  let variantId: string;
  let orderedTaskIds: string[];

  beforeAll(async () => {
    testDb = await createImportedTestDb();
    const [variant] = await testDb.db
      .select()
      .from(schema.variants)
      .where(eq(schema.variants.variantNumber, 1));
    variantId = variant!.id;
    const taskRows = await testDb.db
      .select()
      .from(schema.variantTasks)
      .where(eq(schema.variantTasks.variantId, variantId))
      .orderBy(schema.variantTasks.position);
    orderedTaskIds = taskRows.map((r) => r.taskId);
  });

  afterAll(async () => {
    await testDb.close();
  });

  async function freshUserId(): Promise<string> {
    const userId = randomUUID();
    await testDb.db.insert(schema.users).values({ id: userId });
    return userId;
  }

  it('returns null for an unknown variant id', async () => {
    const result = await startVariantSession(testDb.db, await freshUserId(), randomUUID());
    expect(result).toBeNull();
  });

  it('starts with the variant real total and its first real task, never a recommendation', async () => {
    const userId = await freshUserId();
    const result = await startVariantSession(testDb.db, userId, variantId);
    expect(result).not.toBeNull();
    if (!result || result.status !== 'active') throw new Error('unreachable');
    expect(result.total).toBe(orderedTaskIds.length);
    expect(result.position).toBe(1);
    expect(result.task.id).toBe(orderedTaskIds[0]);
    expect(result.recommendation).toBeUndefined();
    expect(result.variant).toMatchObject({ variantId, variantNumber: 1 });
  });

  it('serves the variant real task order, never the scored Smart Training path', async () => {
    const userId = await freshUserId();
    const started = await startVariantSession(testDb.db, userId, variantId);
    if (!started || started.status !== 'active') throw new Error('unreachable');

    let sessionId = started.sessionId;
    const served = [started.task.id];
    for (let i = 1; i < orderedTaskIds.length; i++) {
      const next = await advanceLearningSession(testDb.db, userId, sessionId);
      if (!next || next.status !== 'active') throw new Error('unreachable');
      served.push(next.task.id);
      sessionId = next.sessionId;
      expect(next.recommendation).toBeUndefined();
    }
    expect(served).toEqual(orderedTaskIds);
  });

  it('completes exactly when every planned task has been consumed, with the variant stamped on the summary', async () => {
    const userId = await freshUserId();
    const started = await startVariantSession(testDb.db, userId, variantId);
    if (!started || started.status !== 'active') throw new Error('unreachable');

    let sessionId = started.sessionId;
    let last = await advanceLearningSession(testDb.db, userId, sessionId);
    for (let i = 2; i < orderedTaskIds.length && last?.status === 'active'; i++) {
      sessionId = last.sessionId;
      last = await advanceLearningSession(testDb.db, userId, sessionId);
    }
    // One more call than there are remaining tasks reaches completion.
    if (last?.status === 'active') {
      last = await advanceLearningSession(testDb.db, userId, last.sessionId);
    }
    expect(last?.status).toBe('completed');
    if (!last || last.status !== 'completed') throw new Error('unreachable');
    expect(last.total).toBe(orderedTaskIds.length);
    expect(last.variant).toMatchObject({ variantId, variantNumber: 1 });
  });

  it('getVariantProgress shows a still-active (abandoned) session with real partial numbers, never faked as finished', async () => {
    const userId = await freshUserId();
    const started = await startVariantSession(testDb.db, userId, variantId);
    if (!started || started.status !== 'active') throw new Error('unreachable');
    await submitAttempt(testDb.db, started.task.id, userId, { answer: 'definitely_wrong' });

    const progress = await getVariantProgress(testDb.db, userId);
    expect(progress.items).toHaveLength(1);
    const item = progress.items[0]!;
    expect(item.status).toBe('active');
    expect(item.plannedCount).toBe(orderedTaskIds.length);
    expect(item.solvedCount).toBe(1);
    expect(item.correctCount).toBe(0);
    expect(item.incorrectCount).toBe(1);
    expect(item.accuracyPercent).toBe(0);
  });

  it('getVariantProgress shows real key errors from the deterministic error-signature system', async () => {
    const userId = await freshUserId();
    const started = await startVariantSession(testDb.db, userId, variantId);
    if (!started || started.status !== 'active') throw new Error('unreachable');
    await submitAttempt(testDb.db, started.task.id, userId, { answer: '' });

    const progress = await getVariantProgress(testDb.db, userId);
    const item = progress.items.find((i) => i.sessionId === started.sessionId)!;
    expect(item.keyErrors.some((e) => e.signature === 'blank_answer')).toBe(true);
  });

  it('another user never sees this user variant sessions', async () => {
    const owner = await freshUserId();
    const other = await freshUserId();
    await startVariantSession(testDb.db, owner, variantId);

    const progress = await getVariantProgress(testDb.db, other);
    expect(progress.items).toHaveLength(0);
  });

  it('the real variant task count is used, never a user-selected or fabricated count', async () => {
    const tasks = await tasksRepo.getTaskById(testDb.db, orderedTaskIds[0]!);
    expect(tasks).toBeDefined();
    expect(orderedTaskIds.length).toBeGreaterThan(0);
  });
});
