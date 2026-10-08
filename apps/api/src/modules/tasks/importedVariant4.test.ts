import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createImportedVariantsTestDb } from '@zybrilka/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';

/**
 * Block D — proves the real EGE-2026 Вариант 4 import flows through
 * the exact same Task Engine as Вариант 1/2/3: listing, grading
 * (short_answer, multi_part), image delivery, and
 * correctAnswerDisplay — no second parallel code path.
 */
describe('imported EGE-2026 Variant 4 tasks via the real Task Engine', () => {
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

  it('task 13 (multi_part, two roots) grades a partially-correct attempt', async () => {
    const [task13] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'math'),
          eq(schema.tasks.taskNumber, 13),
          eq(schema.tasks.sourceVariant, 4),
        ),
      );
    expect(task13!.answerType).toBe('multi_part');
    const anonId = randomUUID();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task13!.id}/attempt`,
      headers: { 'x-anon-id': anonId },
      payload: { answer: { a: 'wrong', b: '-0.2' } },
    });
    const body = res.json();
    expect(body.correct).toBe(false);
    expect(body.partStatus).toBe('partially_correct');
    expect(body.correctParts).toBe(1);
  });

  it('task 19 (multi_part) grades a partially-correct attempt and records the wrong part', async () => {
    const [task19] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'math'),
          eq(schema.tasks.taskNumber, 19),
          eq(schema.tasks.sourceVariant, 4),
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
    const [task11] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'math'),
          eq(schema.tasks.taskNumber, 11),
          eq(schema.tasks.sourceVariant, 4),
        ),
      );
    const res = await app.inject({ method: 'GET', url: `/api/v1/tasks/${task11!.id}` });
    expect(res.json().imageUrl).toBe('/tasks/imports/ege-2026-variant-4/task-11-graph.png');
  });

  it('carries correctAnswerDisplay through the attempt result for a non-plain answer (task 17)', async () => {
    const [task17] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'math'),
          eq(schema.tasks.taskNumber, 17),
          eq(schema.tasks.sourceVariant, 4),
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
      correctAnswer: '5/3',
      correctAnswerDisplay: '$\\dfrac53$',
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
          eq(schema.tasks.sourceVariant, 4),
        ),
      );
    const anonId = randomUUID();

    const wrong = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task6!.id}/attempt`,
      headers: { 'x-anon-id': anonId },
      payload: { answer: '0' },
    });
    expect(wrong.json()).toMatchObject({ correct: false, correctAnswer: '-10' });
    expect(wrong.json().mistakeId).not.toBeNull();

    const correct = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task6!.id}/attempt`,
      headers: { 'x-anon-id': anonId },
      payload: { answer: '-10' },
    });
    expect(correct.json().correct).toBe(true);
  });
});
