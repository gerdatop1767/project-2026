import { parseMultiPartSpec } from '@zybrilka/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema.js';
import { seed } from './seed.js';
import { importVariant1 } from './importEge2026Variant1.js';
import { importVariant7 } from './importEge2026Variant7.js';
import { importVariant8, partForTaskNumber } from './importEge2026Variant8.js';
import { createTestDb } from './testing.js';

describe('importVariant8', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it('imports all 19 task numbers with no gaps, all published', async () => {
    const { db } = testDb;
    const result = await importVariant8(db);
    expect(result.total).toBe(19);
    expect(result.published).toBe(19);
    expect(result.needsReview).toBe(0);

    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.sourceVariant, 8)));
    expect(rows.length).toBe(19);

    const numbers = rows.map((r) => r.taskNumber).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    expect(rows.every((r) => r.status === 'published')).toBe(true);
  });

  it('task 6 resolves to the single root valid in the domain', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.sourceVariant, 8)));
    const task6 = rows.find((r) => r.taskNumber === 6);
    expect(task6?.answerType).toBe('short_answer');
    expect(task6?.correctAnswer).toBe('10');
  });

  it('task 19 is answerType=multi_part with three well-formed parts (a/б/в)', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.sourceVariant, 8)));
    const task19 = rows.find((r) => r.taskNumber === 19);
    expect(task19?.answerType).toBe('multi_part');
    const spec = parseMultiPartSpec(task19!.correctAnswer);
    expect(spec).not.toBeNull();
    expect(spec!.parts).toHaveLength(3);
    expect(spec!.parts.map((p) => p.correctAnswer)).toEqual(['да', 'нет', '385']);
  });

  it('keeps full provenance for every imported task', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.sourceVariant, 8)));
    for (const row of rows) {
      expect(row.sourceDocument).toBe('ЕГЭ 2026 Ященко варианты 6-10');
      expect(row.sourceVariant).toBe(8);
      expect(row.sourcePage).toBeGreaterThanOrEqual(1);
      expect(row.sourcePage).toBeLessThanOrEqual(4);
      expect(row.rawStatement).toBeTruthy();
      expect(row.contentHash).toBeTruthy();
      expect(row.tags).toContain('ege-2026-variant-8');
    }
  });

  it('has no image-attached tasks (no graph required image fallback)', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.sourceVariant, 8)));
    for (const row of rows) {
      expect(row.imageUrl).toBeNull();
    }
  });

  it('is idempotent — re-running does not duplicate rows or touch other sources', async () => {
    const { db } = testDb;
    await seed(db);
    const demoBefore = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.source, 'Zybrilka demo (не ФИПИ)'));

    await importVariant8(db);
    const first = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.sourceVariant, 8)));
    await importVariant8(db);
    const second = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.sourceVariant, 8)));
    expect(second.length).toBe(first.length);

    const demoAfter = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.source, 'Zybrilka demo (не ФИПИ)'));
    expect(demoAfter.length).toBe(demoBefore.length);
  });

  it('creates exactly one collection and one variant with 19 ordered variant_tasks', async () => {
    const { db } = testDb;
    const result = await importVariant8(db);

    const collections = await db
      .select()
      .from(schema.collections)
      .where(eq(schema.collections.slug, 'ege-2026-yashchenko'));
    expect(collections).toHaveLength(1);
    expect(collections[0]!.id).toBe(result.collectionId);

    const variants = await db
      .select()
      .from(schema.variants)
      .where(eq(schema.variants.collectionId, result.collectionId));
    const v8 = variants.find((v) => v.variantNumber === 8);
    expect(v8).toBeDefined();
    expect(v8!.id).toBe(result.variantId);
    expect(v8!.status).toBe('published');

    const members = await db
      .select()
      .from(schema.variantTasks)
      .where(eq(schema.variantTasks.variantId, result.variantId))
      .orderBy(schema.variantTasks.position);
    expect(members).toHaveLength(19);
    expect(members.map((m) => m.position)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));

    const taskIds = new Set(members.map((m) => m.taskId));
    expect(taskIds.size).toBe(19);
  });

  it('shares one collection with Вариант 1 and Вариант 7 — three variants, never a second collection', async () => {
    const { db } = testDb;
    await importVariant1(db);
    await importVariant7(db);
    const result8 = await importVariant8(db);

    const collections = await db
      .select()
      .from(schema.collections)
      .where(eq(schema.collections.slug, 'ege-2026-yashchenko'));
    expect(collections).toHaveLength(1);

    const variants = await db
      .select()
      .from(schema.variants)
      .where(eq(schema.variants.collectionId, result8.collectionId));
    const numbers = variants.map((v) => v.variantNumber).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 7, 8]);
  });

  it('derives Часть 1 / Часть 2 from task number (1-12 vs 13-19)', () => {
    expect(partForTaskNumber(1)).toBe(1);
    expect(partForTaskNumber(12)).toBe(1);
    expect(partForTaskNumber(13)).toBe(2);
    expect(partForTaskNumber(19)).toBe(2);
  });

  it('keeps every task id stable across a re-import', async () => {
    const { db } = testDb;
    await importVariant8(db);
    const before = await db
      .select({ id: schema.tasks.id, taskNumber: schema.tasks.taskNumber })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.sourceVariant, 8)));

    await importVariant8(db);
    const after = await db
      .select({ id: schema.tasks.id, taskNumber: schema.tasks.taskNumber })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.sourceVariant, 8)));

    const idByNumberBefore = new Map(before.map((r) => [r.taskNumber, r.id]));
    for (const row of after) {
      expect(row.id).toBe(idByNumberBefore.get(row.taskNumber));
    }
  });

  it('never collides with Вариант 1 or Вариант 7 task ids for the same taskNumber', async () => {
    const { db } = testDb;
    await importVariant1(db);
    await importVariant7(db);
    await importVariant8(db);

    const rows = await db
      .select({
        id: schema.tasks.id,
        taskNumber: schema.tasks.taskNumber,
        sourceVariant: schema.tasks.sourceVariant,
      })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.taskNumber, 2)));

    const byVariant = new Map(rows.map((r) => [r.sourceVariant, r.id]));
    const ids = new Set(rows.map((r) => r.id));
    expect(ids.size).toBe(rows.length);
    expect(byVariant.get(1)).not.toBe(byVariant.get(8));
    expect(byVariant.get(7)).not.toBe(byVariant.get(8));
  });
});
