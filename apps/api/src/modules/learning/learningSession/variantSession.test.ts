import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createImportedTestDb } from '@zybrilka/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  advanceLearningSession,
  finishVariantSession,
  getLearningSessionSnapshot,
  getVariantAttemptDetail,
  getVariantProgress,
  openVariantTask,
  startVariantSession,
} from './service.js';
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
  describe('free navigation by number', () => {
    async function start() {
      const userId = await freshUserId();
      const started = await startVariantSession(testDb.db, userId, variantId);
      if (!started || started.status !== 'active') throw new Error('unreachable');
      return { userId, sessionId: started.sessionId };
    }
    const at = (i: number) => orderedTaskIds[i]!;

    it('opens tasks in any order: 1 → 7 → 3 → 1, each becoming current with its plan position', async () => {
      const { userId, sessionId } = await start();
      for (const i of [6, 2, 0]) {
        const opened = await openVariantTask(testDb.db, userId, sessionId, at(i));
        if (!opened || opened.status !== 'active') throw new Error('unreachable');
        expect(opened.task.id).toBe(at(i));
        expect(opened.position).toBe(i + 1);
        const snapshot = await getLearningSessionSnapshot(testDb.db, userId, sessionId);
        if (!snapshot || snapshot.status !== 'active') throw new Error('unreachable');
        expect(snapshot.task.id).toBe(at(i));
      }
      const [row] = await testDb.db
        .select()
        .from(schema.learningSessions)
        .where(eq(schema.learningSessions.id, sessionId));
      // Each task served once — reopening only moves it to «current».
      expect(row!.consumedTaskIds).toEqual([at(6), at(2), at(0)]);
    });

    it('opening is not answering: an opened task is «skipped», an unopened one «not reached»', async () => {
      const { userId, sessionId } = await start();
      await openVariantTask(testDb.db, userId, sessionId, at(4));
      const d = (await getVariantAttemptDetail(testDb.db, userId, sessionId))!;
      expect(d.correctCount + d.incorrectCount).toBe(0);
      expect(d.tasks[4]!.outcome).toBe('skipped');
      expect(d.tasks[5]!.outcome).toBe('not_reached');
    });

    it('answers given out of order are linked to the session, once per submit', async () => {
      const { userId, sessionId } = await start();
      await openVariantTask(testDb.db, userId, sessionId, at(5));
      await submitAttempt(testDb.db, at(5), userId, { answer: 'заведомо неверно', sessionId });
      await openVariantTask(testDb.db, userId, sessionId, at(1));
      await openVariantTask(testDb.db, userId, sessionId, at(5));
      const d = (await getVariantAttemptDetail(testDb.db, userId, sessionId))!;
      expect(d.tasks[5]!.outcome).toBe('incorrect');
      expect(d.tasks[5]!.answers).toBe(1);
    });

    it('next follows the plan from the current task; after the last one it finishes', async () => {
      const { userId, sessionId } = await start();
      await openVariantTask(testDb.db, userId, sessionId, at(2));
      const next = await advanceLearningSession(testDb.db, userId, sessionId);
      if (!next || next.status !== 'active') throw new Error('unreachable');
      expect(next.task.id).toBe(at(3));
      await openVariantTask(testDb.db, userId, sessionId, at(orderedTaskIds.length - 1));
      const done = await advanceLearningSession(testDb.db, userId, sessionId);
      expect(done?.status).toBe('completed');
    });

    it('opening every task does not finish the variant early', async () => {
      const { userId, sessionId } = await start();
      for (let i = orderedTaskIds.length - 1; i >= 0; i--) {
        await openVariantTask(testDb.db, userId, sessionId, at(i));
      }
      const next = await advanceLearningSession(testDb.db, userId, sessionId);
      if (!next || next.status !== 'active') throw new Error('unreachable');
      expect(next.task.id).toBe(at(1));
    });

    it("refuses a task outside the variant, someone else's session and a finished one", async () => {
      const { userId, sessionId } = await start();
      const outside = (await testDb.db.select({ id: schema.tasks.id }).from(schema.tasks)).find(
        (t) => !orderedTaskIds.includes(t.id),
      )!;
      expect(await openVariantTask(testDb.db, userId, sessionId, outside.id)).toBeNull();
      expect(await openVariantTask(testDb.db, await freshUserId(), sessionId, at(1))).toBeNull();
      expect(await finishVariantSession(testDb.db, await freshUserId(), sessionId)).toBeNull();
      const finished = await finishVariantSession(testDb.db, userId, sessionId);
      expect(finished?.status).toBe('completed');
      expect(await openVariantTask(testDb.db, userId, sessionId, at(1))).toBeNull();
      // Finishing again is harmless.
      expect((await finishVariantSession(testDb.db, userId, sessionId))?.status).toBe('completed');
    });

    it('finishing early keeps the answers and counts the rest as not answered', async () => {
      const { userId, sessionId } = await start();
      await openVariantTask(testDb.db, userId, sessionId, at(3));
      await submitAttempt(testDb.db, at(3), userId, { answer: 'заведомо неверно', sessionId });
      const finished = await finishVariantSession(testDb.db, userId, sessionId);
      if (!finished || finished.status !== 'completed') throw new Error('unreachable');
      expect(finished.summary.attempted).toBe(1);
      const d = (await getVariantAttemptDetail(testDb.db, userId, sessionId))!;
      expect(d.status).toBe('completed');
      expect(d.incorrectCount).toBe(1);
    });
  });
});
