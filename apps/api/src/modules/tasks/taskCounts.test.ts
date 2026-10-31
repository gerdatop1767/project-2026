import { schema } from '@zybrilka/db';
import { createImported2027TestDb, createTestDb } from '@zybrilka/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';

interface SubjectCount {
  subjectId: string;
  count: number;
  countAllSources: number;
  taskNumbers?: number[];
}
interface CollectionItem {
  collection: { slug: string };
  variants: { id: string; variantNumber: number; taskCount?: number }[];
  taskCount?: number;
  variantTaskCount?: number;
  taskNumbers?: number[];
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

/**
 * The task counters (GET /tasks/counts, GET /collections) against the
 * real imported data — every number is re-derived here with plain SQL,
 * never copied from the code under test.
 */
describe('task counters match the database', () => {
  let testDb: Awaited<ReturnType<typeof createImported2027TestDb>>;
  let app: ReturnType<typeof buildApp>;
  let counts: SubjectCount[];
  let collections: CollectionItem[];

  beforeAll(async () => {
    testDb = await createImported2027TestDb();
    app = buildApp({ version: 'test', db: testDb.db });
    counts = (await app.inject({ method: 'GET', url: '/api/v1/tasks/counts' })).json().items;
    collections = (await app.inject({ method: 'GET', url: '/api/v1/collections' })).json().items;
  });

  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  it('per subject: distinct published tasks, never needs_review, never double-counted', async () => {
    const expected = await testDb.db.execute<{ subject_id: string; n: number }>(sql`
      select subject_id, count(*)::int as n from tasks where status = 'published' group by 1`);
    for (const row of expected.rows) {
      expect(counts.find((c) => c.subjectId === row.subject_id)?.countAllSources).toBe(row.n);
    }
    const math = counts.find((c) => c.subjectId === 'math')!;
    // 488 published of ЕГЭ 2027 + the 2026 pool; the 12 on review are not in it.
    const pool = await testDb.db.execute<{ n: number }>(sql`
      select count(*)::int as n from tasks t where t.subject_id = 'math' and t.status = 'published'
        and t.id not in (select vt.task_id from variant_tasks vt join variants v on v.id = vt.variant_id
                         join collections c on c.id = v.collection_id where not c.in_all_sources)`);
    expect(math.count).toBe(pool.rows[0]!.n);
    expect(math.countAllSources - math.count).toBe(488);
  });

  it('«Все источники» numbers are the pool’s own (2026 format: 1–19, no 2027 №20)', () => {
    const math = counts.find((c) => c.subjectId === 'math')!;
    expect(math.taskNumbers).toEqual(range(1, 19));
  });

  it('ЕГЭ 2027 Ященко: numbers 1–20, 488 distinct tasks, per-variant real counts', () => {
    const c = collections.find((i) => i.collection.slug === 'ege-2027-yashchenko')!;
    expect(c.taskNumbers).toEqual(range(1, 20));
    expect(c.taskCount).toBe(488);
    expect(c.variantTaskCount).toBe(488);
    const hiddenIn = new Set([1, 2, 4, 5, 6, 9, 10, 14, 15, 16, 17, 18]);
    expect(c.variants).toHaveLength(25);
    for (const v of c.variants) {
      expect(v.taskCount, `variant ${v.variantNumber}`).toBe(
        hiddenIn.has(v.variantNumber) ? 19 : 20,
      );
    }
  });

  it('ЕГЭ 2026 Ященко keeps its own 1–19', () => {
    const c = collections.find((i) => i.collection.slug === 'ege-2026-yashchenko')!;
    expect(c.taskNumbers).toEqual(range(1, 19));
    expect(c.taskCount).toBe(19);
  });
});

describe('task counters: edge cases', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let app: ReturnType<typeof buildApp>;

  async function task(
    taskNumber: number,
    status: 'draft' | 'published' | 'needs_review' = 'published',
  ) {
    const [row] = await testDb.db
      .insert(schema.tasks)
      .values({
        subjectId: 'math',
        taskNumber,
        difficulty: 1,
        conditionMd: `Условие ${taskNumber} ${status}`,
        answerType: 'short_answer',
        correctAnswer: '1',
        explanationMd: 'Разбор.',
        source: 'test',
        status,
      })
      .returning();
    return row!.id;
  }

  async function collection(
    slug: string,
    opts: { status?: 'draft' | 'published'; inAllSources?: boolean },
  ) {
    const [c] = await testDb.db
      .insert(schema.collections)
      .values({
        subjectId: 'math',
        slug,
        title: slug,
        status: opts.status ?? 'published',
        inAllSources: opts.inAllSources ?? true,
      })
      .returning();
    return c!.id;
  }

  async function variant(collectionId: string, n: number, taskIds: string[]) {
    const [v] = await testDb.db
      .insert(schema.variants)
      .values({ collectionId, variantNumber: n, title: `В${n}`, status: 'published' })
      .returning();
    await testDb.db
      .insert(schema.variantTasks)
      .values(taskIds.map((taskId, i) => ({ variantId: v!.id, taskId, position: i + 1 })));
  }

  beforeAll(async () => {
    testDb = await createTestDb();
    await testDb.db.insert(schema.subjects).values({ id: 'math', name: 'Математика' });
    app = buildApp({ version: 'test', db: testDb.db });
  });

  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  const getCounts = async () =>
    (await app.inject({ method: 'GET', url: '/api/v1/tasks/counts' })).json()
      .items as SubjectCount[];
  const getCollections = async () =>
    (await app.inject({ method: 'GET', url: '/api/v1/collections' })).json()
      .items as CollectionItem[];

  it('an empty database: no rows, not fabricated zeros', async () => {
    expect(await getCounts()).toEqual([]);
    expect(await getCollections()).toEqual([]);
  });

  it('an empty collection: 0 tasks, no numbers', async () => {
    await collection('empty', {});
    const c = (await getCollections()).find((i) => i.collection.slug === 'empty')!;
    expect(c).toMatchObject({ taskCount: 0, variantTaskCount: 0, taskNumbers: [] });
  });

  it('a task in two variants is one task but two variant slots', async () => {
    const a = await task(1);
    const b = await task(2);
    const draft = await task(3, 'draft');
    const review = await task(4, 'needs_review');
    const c = await collection('dup', {});
    await variant(c, 1, [a, b, draft, review]);
    await variant(c, 2, [a]);
    const item = (await getCollections()).find((i) => i.collection.slug === 'dup')!;
    expect(item.taskCount).toBe(2);
    expect(item.variantTaskCount).toBe(3);
    expect(item.taskNumbers).toEqual([1, 2]);
    expect(item.variants.map((v) => v.taskCount)).toEqual([2, 1]);
    expect((await getCounts()).find((s) => s.subjectId === 'math')).toMatchObject({
      count: 2,
      countAllSources: 2,
      taskNumbers: [1, 2],
    });
  });

  it('a task only in an unpublished edition outside «Все источники» is not available', async () => {
    const hidden = await task(20);
    const c = await collection('draft-edition', { status: 'draft', inAllSources: false });
    await variant(c, 1, [hidden]);
    const math = (await getCounts()).find((s) => s.subjectId === 'math')!;
    expect(math.countAllSources).toBe(2);
    expect(math.taskNumbers).toEqual([1, 2]);
  });
});
