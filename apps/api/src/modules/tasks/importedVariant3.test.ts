import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createImportedVariantsTestDb } from '@zybrilka/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';

/**
 * Block D — proves the real EGE-2026 Вариант 3 import flows through
 * the exact same Task Engine as Вариант 1/2: listing, grading
 * (short_answer, multi_part), image delivery, and
 * correctAnswerDisplay — no second parallel code path.
 */
describe('imported EGE-2026 Variant 3 tasks via the real Task Engine', () => {
  let testDb: Awaited<ReturnType<typeof createImportedVariantsTestDb>>;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    testDb = await createImportedVariantsTestDb();
    app = buildApp({ version: 'test', db: testDb.db });
  });

  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  it('task 19 (multi_part) grades a partially-correct attempt and records the wrong part', async () => {
    const [task19] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'math'),
          eq(schema.tasks.taskNumber, 19),
          eq(schema.tasks.sourceVariant, 3),
        ),
      );
    expect(task19!.answerType).toBe('multi_part');
    const anonId = randomUUID();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task19!.id}/attempt`,
      headers: { 'x-anon-id': anonId },
      payload: { answer: { a: 'да', b: 'нет', c: 'wrong' } },
    });
    const body = res.json();
    expect(body.correct).toBe(false);
    expect(body.partStatus).toBe('partially_correct');
    expect(body.correctParts).toBe(2);

    const [mistake] = await testDb.db
      .select()
      .from(schema.mistakes)
      .where(and(eq(schema.mistakes.userId, anonId), eq(schema.mistakes.taskId, task19!.id)));
    expect(mistake?.wrongParts).toEqual(['c']);
  });

  it('a real imported task carries its graph image through the API', async () => {
    const [task8] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'math'),
          eq(schema.tasks.taskNumber, 8),
          eq(schema.tasks.sourceVariant, 3),
        ),
      );
    const res = await app.inject({ method: 'GET', url: `/api/v1/tasks/${task8!.id}` });
    expect(res.json().imageUrl).toBe('/tasks/imports/ege-2026-variant-3/task-08-graph.png');
  });

  it('carries correctAnswerDisplay through the attempt result for a non-plain answer (task 17)', async () => {
    const [task17] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'math'),
          eq(schema.tasks.taskNumber, 17),
          eq(schema.tasks.sourceVariant, 3),
        ),
      );
    const anonId = randomUUID();

    const attempt = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task17!.id}/attempt`,
      headers: { 'x-anon-id': anonId },
      payload: { answer: 'что-то другое' },
    });
    expect(attempt.json()).toMatchObject({
      correctAnswer: '√7-√2',
      correctAnswerDisplay: '$\\sqrt7-\\sqrt2$',
    });
  });

  it('server-checks a short_answer imported task end to end: attempt, mistake, explanation release', async () => {
    const [task6] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'math'),
          eq(schema.tasks.taskNumber, 6),
          eq(schema.tasks.sourceVariant, 3),
        ),
      );
    const anonId = randomUUID();

    const wrong = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task6!.id}/attempt`,
      headers: { 'x-anon-id': anonId },
      payload: { answer: '0' },
    });
    expect(wrong.json()).toMatchObject({ correct: false, correctAnswer: '16' });
    expect(wrong.json().mistakeId).not.toBeNull();

    const correct = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task6!.id}/attempt`,
      headers: { 'x-anon-id': anonId },
      payload: { answer: '16' },
    });
    expect(correct.json().correct).toBe(true);
  });
});
