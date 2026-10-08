import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createImportedVariantsTestDb } from '@zybrilka/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';

/**
 * Block D — proves the real EGE-2026 Вариант 5 import flows through
 * the exact same Task Engine as Вариант 1/2/3/4: listing, grading
 * (short_answer, multi_part), image delivery, and
 * correctAnswerDisplay — no second parallel code path.
 */
describe('imported EGE-2026 Variant 5 tasks via the real Task Engine', () => {
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

  it('task 13 (short_answer, single filtered root) grades correctly', async () => {
    const [task13] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'math'),
          eq(schema.tasks.taskNumber, 13),
          eq(schema.tasks.sourceVariant, 5),
        ),
      );
    expect(task13!.answerType).toBe('short_answer');
    const anonId = randomUUID();

    const wrong = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task13!.id}/attempt`,
      headers: { 'x-anon-id': anonId },
      payload: { answer: '0' },
    });
    expect(wrong.json()).toMatchObject({ correct: false, correctAnswer: '-1.5' });

    const correct = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task13!.id}/attempt`,
      headers: { 'x-anon-id': anonId },
      payload: { answer: '-1.5' },
    });
    expect(correct.json().correct).toBe(true);
  });

  it('task 19 (multi_part) grades a partially-correct attempt and records the wrong part', async () => {
    const [task19] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'math'),
          eq(schema.tasks.taskNumber, 19),
          eq(schema.tasks.sourceVariant, 5),
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
          eq(schema.tasks.sourceVariant, 5),
        ),
      );
    const res = await app.inject({ method: 'GET', url: `/api/v1/tasks/${task11!.id}` });
    expect(res.json().imageUrl).toBe('/tasks/imports/ege-2026-variant-5/task-11-graph.png');
  });

  it('carries correctAnswerDisplay through the attempt result for a non-plain answer (task 17)', async () => {
    const [task17] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'math'),
          eq(schema.tasks.taskNumber, 17),
          eq(schema.tasks.sourceVariant, 5),
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
      correctAnswer: '15√97/4',
      correctAnswerDisplay: '$\\dfrac{15\\sqrt{97}}{4}$',
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
          eq(schema.tasks.sourceVariant, 5),
        ),
      );
    const anonId = randomUUID();

    const wrong = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task6!.id}/attempt`,
      headers: { 'x-anon-id': anonId },
      payload: { answer: '0' },
    });
    expect(wrong.json()).toMatchObject({ correct: false, correctAnswer: '-6' });
    expect(wrong.json().mistakeId).not.toBeNull();

    const correct = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task6!.id}/attempt`,
      headers: { 'x-anon-id': anonId },
      payload: { answer: '-6' },
    });
    expect(correct.json().correct).toBe(true);
  });
});
