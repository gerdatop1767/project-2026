import { parseIntervalSet, parseMultiPartSpec } from '@zybrilka/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema.js';
import { seed } from './seed.js';
import { importVariant1 } from './importEge2026Variant1.js';
import { importVariant2, partForTaskNumber } from './importEge2026Variant2.js';
import { createTestDb } from './testing.js';

describe('importVariant2', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it('imports all 19 task numbers with no gaps, all published', async () => {
    const { db } = testDb;
    const result = await importVariant2(db);
    expect(result.total).toBe(19);
    expect(result.published).toBe(19);
    expect(result.needsReview).toBe(0);

    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.sourceVariant, 2)));
    expect(rows.length).toBe(19);

    const numbers = rows.map((r) => r.taskNumber).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    expect(rows.every((r) => r.status === 'published')).toBe(true);
  });

  it('task 15 is answerType=interval with a well-formed interval-set answer', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.sourceVariant, 2)));
    const task15 = rows.find((r) => r.taskNumber === 15);
    expect(task15?.answerType).toBe('interval');
    expect(parseIntervalSet(task15!.correctAnswer)).not.toBeNull();
  });

  it('task 18 is a short_answer parameter answer (point ∪ interval, like Вариант 1\'s task 18)', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.sourceVariant, 2)));
    const task18 = rows.find((r) => r.taskNumber === 18);
    expect(task18?.answerType).toBe('short_answer');
    expect(task18?.correctAnswer).toBeTruthy();
  });

  it('task 19 is answerType=multi_part with three well-formed parts (a/б/в)', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.sourceVariant, 2)));
    const task19 = rows.find((r) => r.taskNumber === 19);
    expect(task19?.answerType).toBe('multi_part');
    const spec = parseMultiPartSpec(task19!.correctAnswer);
    expect(spec).not.toBeNull();
    expect(spec!.parts).toHaveLength(3);
    expect(spec!.parts.map((p) => p.correctAnswer)).toEqual(['нет', '833', '1001']);
  });

  it('keeps full provenance for every imported task', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.sourceVariant, 2)));
    for (const row of rows) {
      expect(row.sourceDocument).toBe('ЕГЭ 2026 Ященко 36 вариантов');
      expect(row.sourceVariant).toBe(2);
      expect(row.sourcePage).toBeGreaterThanOrEqual(1);
      expect(row.rawStatement).toBeTruthy();
      expect(row.contentHash).toBeTruthy();
      expect(row.tags).toContain('ege-2026-variant-2');
    }
  });

  it('attaches an image to the two graph-dependent tasks (8 and 11) and no others', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.sourceVariant, 2)));
    for (const row of rows) {
      if (row.taskNumber === 8 || row.taskNumber === 11) {
        expect(row.imageUrl).toMatch(/^\/tasks\/imports\/ege-2026-variant-2\//);
      } else {
        expect(row.imageUrl).toBeNull();
      }
    }
  });

  it('is idempotent — re-running does not duplicate rows or touch other sources', async () => {
    const { db } = testDb;
    await seed(db);
    const demoBefore = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.source, 'Zybrilka demo (не ФИПИ)'));

    await importVariant2(db);
    const first = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.sourceVariant, 2)));
    await importVariant2(db);
    const second = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.sourceVariant, 2)));
    expect(second.length).toBe(first.length);

    const demoAfter = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.source, 'Zybrilka demo (не ФИПИ)'));
    expect(demoAfter.length).toBe(demoBefore.length);
  });

  it('creates exactly one collection and one variant with 19 ordered variant_tasks', async () => {
    const { db } = testDb;
    const result = await importVariant2(db);

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
    const v2 = variants.find((v) => v.variantNumber === 2);
    expect(v2).toBeDefined();
    expect(v2!.id).toBe(result.variantId);
    expect(v2!.status).toBe('published');

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

  it('shares one collection with Вариант 1 — two variants, both present, never a second collection', async () => {
    const { db } = testDb;
    await importVariant1(db);
    const result2 = await importVariant2(db);

    const collections = await db
      .select()
      .from(schema.collections)
      .where(eq(schema.collections.slug, 'ege-2026-yashchenko'));
    expect(collections).toHaveLength(1);

    const variants = await db
      .select()
      .from(schema.variants)
      .where(eq(schema.variants.collectionId, result2.collectionId));
    const numbers = variants.map((v) => v.variantNumber).sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2]);
  });

  it('derives Часть 1 / Часть 2 from task number (1-12 vs 13-19)', () => {
    expect(partForTaskNumber(1)).toBe(1);
    expect(partForTaskNumber(12)).toBe(1);
    expect(partForTaskNumber(13)).toBe(2);
    expect(partForTaskNumber(19)).toBe(2);
  });

  it('keeps every task id stable across a re-import', async () => {
    const { db } = testDb;
    await importVariant2(db);
    const before = await db
      .select({ id: schema.tasks.id, taskNumber: schema.tasks.taskNumber })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.sourceVariant, 2)));

    await importVariant2(db);
    const after = await db
      .select({ id: schema.tasks.id, taskNumber: schema.tasks.taskNumber })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.sourceVariant, 2)));

    const idByNumberBefore = new Map(before.map((r) => [r.taskNumber, r.id]));
    for (const row of after) {
      expect(row.id).toBe(idByNumberBefore.get(row.taskNumber));
    }
  });
});
