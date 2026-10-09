import { randomUUID } from 'node:crypto';
import { importRussianVariant1, importVariant1, schema } from '@zybrilka/db';
import { createTestDb } from '@zybrilka/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';

/**
 * EXPERIMENTAL pilot check (not part of the production math fixture —
 * see importRussianDoshchinsky2027Variant1.ts's own doc comment):
 * proves the Russian Вариант 1 catalog is reachable through the real
 * public API, not just present as rows in the importer's own test DB.
 * All 27 tasks are published — tasks 3, 8, 11, 12 were independently
 * re-derived and resolved (see the importer's own doc comment); there
 * is no needs_review task left in this variant.
 */
describe('Russian Вариант 1 is browsable through the real API (not just importer rows)', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    testDb = await createTestDb();
    app = buildApp({ version: 'test', db: testDb.db });
    await importRussianVariant1(testDb.db);
  });

  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  it('GET /api/v1/variants/:id returns all 27 published tasks — the full variant', async () => {
    const [variant] = await testDb.db
      .select()
      .from(schema.variants)
      .where(eq(schema.variants.variantNumber, 1));

    const res = await app.inject({ method: 'GET', url: `/api/v1/variants/${variant!.id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.collection.slug).toBe('ege-2027-doshchinskiy-russian');
    expect(body.tasks).toHaveLength(27);
    const numbers = body.tasks.map((t: { task: { taskNumber: number } }) => t.task.taskNumber);
    expect(numbers.sort((a: number, b: number) => a - b)).toEqual(
      Array.from({ length: 27 }, (_, i) => i + 1),
    );
  });

  it('task 27 is browsable as a normal task via GET /api/v1/tasks/:id — essay answerType, explanation visible up front (no real answer to leak)', async () => {
    const [task27] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'russian'),
          eq(schema.tasks.sourceVariant, 1),
          eq(schema.tasks.taskNumber, 27),
        ),
      );

    const res = await app.inject({ method: 'GET', url: `/api/v1/tasks/${task27!.id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.answerType).toBe('essay');
    // No attempt was ever made (essay attempts are always rejected), yet
    // the explanation is already visible — essay tasks skip the
    // attempt-gate entirely since correctAnswer is an empty sentinel,
    // never a real answer to protect.
    expect(body.correctAnswer).toBe('');
    expect(body.explanationMd).toBeTruthy();
    expect(body.conditionMd).toContain('старинные вещи');
  });

  it('any attempt against task 27 is rejected with 400 essay_not_gradable, never served as correct/incorrect', async () => {
    const [task27] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'russian'),
          eq(schema.tasks.sourceVariant, 1),
          eq(schema.tasks.taskNumber, 27),
        ),
      );

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task27!.id}/attempt`,
      headers: { 'x-anon-id': crypto.randomUUID() },
      payload: { answer: 'Текст сочинения...' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('essay_not_gradable');
  });

  it('a task marked digitSetOrderInsensitive accepts the correct digits in any order (e.g. task 16, "35" vs "53")', async () => {
    const [task16] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'russian'),
          eq(schema.tasks.sourceVariant, 1),
          eq(schema.tasks.taskNumber, 16),
        ),
      );
    expect(task16!.digitSetOrderInsensitive).toBe(true);
    expect(task16!.correctAnswer).toBe('35');

    const resSameOrder = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task16!.id}/attempt`,
      headers: { 'x-anon-id': randomUUID() },
      payload: { answer: '35' },
    });
    expect(resSameOrder.json().correct).toBe(true);

    const resReordered = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task16!.id}/attempt`,
      headers: { 'x-anon-id': randomUUID() },
      payload: { answer: '53' },
    });
    expect(resReordered.json().correct).toBe(true);

    const resWrongDigits = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task16!.id}/attempt`,
      headers: { 'x-anon-id': randomUUID() },
      payload: { answer: '34' },
    });
    expect(resWrongDigits.json().correct).toBe(false);
  });

  it('a short-answer task without the flag (e.g. word answer task 5) stays exact/order-sensitive as before', async () => {
    const [task5] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'russian'),
          eq(schema.tasks.sourceVariant, 1),
          eq(schema.tasks.taskNumber, 5),
        ),
      );
    expect(task5!.digitSetOrderInsensitive).toBe(false);
  });

  it('math tasks default to digitSetOrderInsensitive=false and stay order-sensitive (no regression from the new column)', async () => {
    await importVariant1(testDb.db);
    const mathRows = await testDb.db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.sourceVariant, 1)));
    expect(mathRows.length).toBeGreaterThan(0);
    expect(mathRows.every((r) => r.digitSetOrderInsensitive === false)).toBe(true);
  });

  it('no needs_review tasks remain — every task row is published', async () => {
    const needsReviewRows = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'russian'),
          eq(schema.tasks.sourceVariant, 1),
          eq(schema.tasks.status, 'needs_review'),
        ),
      );
    expect(needsReviewRows).toHaveLength(0);
  });

  it('tasks 3 and 8 (formerly needs_review) grade correctly through the real API', async () => {
    const [task3] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'russian'),
          eq(schema.tasks.sourceVariant, 1),
          eq(schema.tasks.taskNumber, 3),
        ),
      );
    expect(task3!.correctAnswer).toBe('234');
    const res3 = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task3!.id}/attempt`,
      headers: { 'x-anon-id': randomUUID() },
      payload: { answer: '432' },
    });
    expect(res3.json().correct).toBe(true);

    const [task8] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'russian'),
          eq(schema.tasks.sourceVariant, 1),
          eq(schema.tasks.taskNumber, 8),
        ),
      );
    const res8 = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task8!.id}/attempt`,
      headers: { 'x-anon-id': randomUUID() },
      payload: { answer: { a: '9', b: '5', v: '3', g: '4', d: '7' } },
    });
    expect(res8.json().correct).toBe(true);
  });

  it('tasks 11 and 12 (independently re-derived, digitSetOrderInsensitive) grade correctly through the real API', async () => {
    const [task11] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'russian'),
          eq(schema.tasks.sourceVariant, 1),
          eq(schema.tasks.taskNumber, 11),
        ),
      );
    expect(task11!.correctAnswer).toBe('145');
    expect(task11!.digitSetOrderInsensitive).toBe(true);

    const resReordered = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task11!.id}/attempt`,
      headers: { 'x-anon-id': randomUUID() },
      payload: { answer: '514' },
    });
    expect(resReordered.json().correct).toBe(true);

    const resWrong = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task11!.id}/attempt`,
      headers: { 'x-anon-id': randomUUID() },
      payload: { answer: '245' },
    });
    expect(resWrong.json().correct).toBe(false);

    const [task12] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'russian'),
          eq(schema.tasks.sourceVariant, 1),
          eq(schema.tasks.taskNumber, 12),
        ),
      );
    expect(task12!.correctAnswer).toBe('234');
    expect(task12!.digitSetOrderInsensitive).toBe(true);
  });
});
