import { schema } from '@zybrilka/db';
import { createImported2027TestDb } from '@zybrilka/db/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';

const SOURCE_2027 = 'Ященко ЕГЭ 2027. Типовые экзаменационные варианты';

/**
 * «ЕГЭ 2027 Ященко» is its own source (collection `inAllSources: false`):
 * the 2027 numbering (20 tasks) must never mix with the 2026 one (19).
 * Real imported data: 2026 Вариант 1 + 2027 Вариант 1-2.
 */
describe('ЕГЭ 2027 kept apart from «Все источники»', () => {
  let testDb: Awaited<ReturnType<typeof createImported2027TestDb>>;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    testDb = await createImported2027TestDb();
    app = buildApp({ version: 'test', db: testDb.db });
  });

  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  const list = async (query: string) => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/tasks?${query}` });
    expect(res.statusCode).toBe(200);
    return res.json().items as {
      id: string;
      taskNumber: number;
      source: string;
      sourceYear: number;
    }[];
  };

  it('«Все источники» (no collection) never lists a 2027 task, for any number', async () => {
    for (const n of [1, 14, 19, 20]) {
      const items = await list(`subject=math&taskNumber=${n}&limit=100`);
      expect(items.some((t) => t.source === SOURCE_2027)).toBe(false);
    }
    expect(await list('subject=math&taskNumber=20&limit=100')).toHaveLength(0);
  });

  it('the 2027 filter lists only 2027 tasks, numbered as in the 2027 book', async () => {
    const items = await list('collection=ege-2027-yashchenko&limit=100');
    expect(items).toHaveLength(38); // 2 × 20, minus №17 held for review
    expect(items.every((t) => t.source === SOURCE_2027 && t.sourceYear === 2027)).toBe(true);
    expect(new Set(items.map((t) => t.taskNumber))).toEqual(
      new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20]),
    );
    // №14 in 2027 is the trigonometric equation, not 2026's №14 (stereometry).
    const n14 = await list('collection=ege-2027-yashchenko&taskNumber=14');
    expect(n14).toHaveLength(2);
    expect(n14.every((t) => t.source === SOURCE_2027)).toBe(true);
  });

  it('the 2026 filter is unchanged: 19 tasks, no 2027', async () => {
    const items = await list('collection=ege-2026-yashchenko&limit=100');
    expect(items).toHaveLength(19);
    expect(items.some((t) => t.source === SOURCE_2027)).toBe(false);
  });

  it('random tasks and subject counts ignore 2027 unless asked for', async () => {
    const counts = (await app.inject({ method: 'GET', url: '/api/v1/tasks/counts' })).json()
      .items as { subjectId: string; count: number }[];
    const allPublishedMath = await testDb.db
      .select({ id: schema.tasks.id, source: schema.tasks.source })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.status, 'published')));
    const outside = allPublishedMath.filter((t) => t.source === SOURCE_2027).length;
    expect(outside).toBe(38);
    expect(counts.find((c) => c.subjectId === 'math')!.count).toBe(
      allPublishedMath.length - outside,
    );

    for (let i = 0; i < 15; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/tasks/random?subject=math&taskNumber=3',
      });
      expect(res.json().source).not.toBe(SOURCE_2027);
    }
    const in2027 = await app.inject({
      method: 'GET',
      url: '/api/v1/tasks/random?collection=ege-2027-yashchenko&taskNumber=20',
    });
    expect(in2027.json()).toMatchObject({ taskNumber: 20, source: SOURCE_2027 });
  });

  it('“same number” lists opened from a 2027 task stay inside 2027 (sameSourceAs)', async () => {
    const [task] = await list('collection=ege-2027-yashchenko&taskNumber=3&limit=1');
    const items = await list(`subject=math&taskNumber=3&sameSourceAs=${task!.id}&limit=100`);
    expect(items).toHaveLength(2);
    expect(items.every((t) => t.source === SOURCE_2027)).toBe(true);
    // From a 2026 task the list is the ordinary «Все источники» one.
    const [old] = await list('collection=ege-2026-yashchenko&taskNumber=3&limit=1');
    const fromOld = await list(`subject=math&taskNumber=3&sameSourceAs=${old!.id}&limit=100`);
    expect(fromOld.some((t) => t.source === SOURCE_2027)).toBe(false);
  });

  it('similar tasks of a 2027 task come from 2027, and never the reverse', async () => {
    const ids = async (taskId: string) => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/tasks/${taskId}/similar?limit=10`,
      });
      const found = (res.json().items as { taskId: string }[]).map((i) => i.taskId);
      if (found.length === 0) return [];
      return testDb.db
        .select({ source: schema.tasks.source })
        .from(schema.tasks)
        .where(inArray(schema.tasks.id, found));
    };
    const [t2027] = await list('collection=ege-2027-yashchenko&taskNumber=4&limit=1');
    const from2027 = await ids(t2027!.id);
    expect(from2027.length).toBeGreaterThan(0);
    expect(from2027.every((r) => r.source === SOURCE_2027)).toBe(true);
    const [t2026] = await list('collection=ege-2026-yashchenko&taskNumber=4&limit=1');
    expect((await ids(t2026!.id)).some((r) => r.source === SOURCE_2027)).toBe(false);
  });

  it('a 2027 task still opens directly, and its variant resolves within its own collection', async () => {
    const [task] = await list('collection=ege-2027-yashchenko&taskNumber=19&limit=1');
    const res = await app.inject({ method: 'GET', url: `/api/v1/tasks/${task!.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ taskNumber: 19, answerType: 'interval', sourceYear: 2027 });
    const variant = await app.inject({
      method: 'GET',
      url: `/api/v1/variants/for-task/${task!.id}`,
    });
    expect(variant.statusCode).toBe(200);
    expect(variant.json().collection.slug).toBe('ege-2027-yashchenko');
  });
});
