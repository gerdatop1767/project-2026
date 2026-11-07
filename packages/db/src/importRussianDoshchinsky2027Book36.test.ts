import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkAnswer, parseMultiPartSpec } from '@zybrilka/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  importRussianDoshchinsky36,
  R36_COLLECTION_SLUG,
  R36_SOURCE,
} from './importRussianDoshchinsky2027Book36.js';
import { importRussianVariant1 } from './importRussianDoshchinsky2027Variant1.js';
import { r36Variants } from './russianDoshchinsky36/index.js';
import * as schema from './schema.js';
import { createTestDb } from './testing.js';

/** Tasks the book repeats from an earlier variant (stored once, linked twice). */
const reusedCount = r36Variants.flatMap((v) => v.tasks).filter((t) => t.sameAs).length;
const uniqueTaskCount = r36Variants.length * 26 - reusedCount;

/** Sentence numbers «(1)…(N)» of a passage, in order of appearance. */
const sentenceNumbers = (md: string) => [...md.matchAll(/\((\d+)\)/g)].map((m) => Number(m[1]));

describe('«36 вариантов» data (static checks)', () => {
  it('every prepared variant has tasks 1–26 exactly once, with an explanation and a hint', () => {
    for (const v of r36Variants) {
      expect(v.tasks.map((t) => t.taskNumber)).toEqual(Array.from({ length: 26 }, (_, i) => i + 1));
      for (const t of v.tasks) {
        expect(t.conditionMd.length, `В${v.variant} №${t.taskNumber}`).toBeGreaterThan(40);
        expect(t.explanationMd.length, `В${v.variant} №${t.taskNumber}`).toBeGreaterThan(80);
        expect(t.hintMd.length, `В${v.variant} №${t.taskNumber}`).toBeGreaterThan(10);
        if (t.status === 'needs_review') expect(t.reviewReason).toBeTruthy();
      }
    }
  });

  it('answers have the format of their task number', () => {
    for (const v of r36Variants) {
      for (const t of v.tasks) {
        const where = `В${v.variant} №${t.taskNumber}`;
        const all = [t.correctAnswer, ...t.acceptedAnswers];
        if (t.taskNumber === 8 || t.taskNumber === 22) {
          expect(t.answerType, where).toBe('multi_part');
          expect(
            t.multiPart?.map((c) => c.label),
            where,
          ).toEqual(['А', 'Б', 'В', 'Г', 'Д']);
          expect(new Set(t.correctAnswer).size, where).toBe(5);
        } else if ([1, 5, 6, 7, 25].includes(t.taskNumber)) {
          for (const a of all) expect(a, where).toMatch(/^[а-яё-]+$/);
        } else {
          for (const a of all) expect(a, where).toMatch(/^\d+$/);
        }
      }
    }
  });

  it('the main answer and every accepted alternative pass the real answer checker', () => {
    for (const v of r36Variants) {
      for (const t of v.tasks) {
        if (t.answerType === 'multi_part') continue;
        for (const a of [t.correctAnswer, ...t.acceptedAnswers]) {
          const ok = [t.correctAnswer, ...t.acceptedAnswers].some((key) =>
            checkAnswer(a, key, { digitSetOrderInsensitive: t.digitSetOrderInsensitive }),
          );
          expect(ok, `В${v.variant} №${t.taskNumber}: ${a}`).toBe(true);
        }
      }
    }
  });

  it('a repeated task points to an earlier variant with the same condition and answer', () => {
    for (const v of r36Variants) {
      for (const t of v.tasks) {
        if (!t.sameAs) continue;
        const where = `В${v.variant} №${t.taskNumber}`;
        expect(t.sameAs.variant, where).toBeLessThan(v.variant);
        const original = r36Variants
          .find((x) => x.variant === t.sameAs!.variant)
          ?.tasks.find((x) => x.taskNumber === t.sameAs!.taskNumber);
        expect(original, where).toBeDefined();
        expect(original!.sameAs, where).toBeUndefined();
        expect(original!.conditionMd, where).toBe(t.conditionMd);
        expect(original!.correctAnswer, where).toBe(t.correctAnswer);
        expect(original!.acceptedAnswers, where).toEqual(t.acceptedAnswers);
        expect(original!.passage, where).toBeNull();
      }
    }
  });

  it('text B is numbered (1)…(N) without gaps; tasks 24 and 26 refer to existing sentences', () => {
    for (const v of r36Variants) {
      const nums = sentenceNumbers(v.passages.B.bodyMd);
      expect(nums, `В${v.variant}`).toEqual(Array.from({ length: nums.length }, (_, i) => i + 1));
      const max = nums.length;
      for (const n of [24, 26]) {
        const t = v.tasks.find((x) => x.taskNumber === n)!;
        for (const m of t.conditionMd.matchAll(/\b(\d{1,2})\b/g))
          expect(Number(m[1]), `В${v.variant} №${n}`).toBeLessThanOrEqual(max);
      }
    }
  });
});

describe('«36 вариантов» does not duplicate content already in the bot', () => {
  const letters = (s: string) => s.toLowerCase().replace(/[^а-яё]/g, '');
  const dir = fileURLToPath(new URL('.', import.meta.url));
  const existing = readdirSync(dir)
    .filter((f) => /^importRussianDoshchinsky2027Variant\d+\.ts$/.test(f))
    .map((f) => letters(readFileSync(dir + f, 'utf8').replace(/\\n/g, ' ')));
  /** 30-letter windows of a text, taken every 15 letters. */
  const windows = (s: string) => {
    const n = letters(s);
    const out: string[] = [];
    for (let i = 0; i + 30 < n.length; i += 15) out.push(n.slice(i, i + 30));
    return out;
  };
  const shared = (text: string, other: string) => {
    const ws = windows(text);
    return ws.length === 0 ? 0 : ws.filter((w) => other.includes(w)).length / ws.length;
  };

  it('no passage of the book repeats a passage of the earlier 18 variants or of another book variant', () => {
    const all = r36Variants.flatMap((v) =>
      (['A', 'B'] as const).map((k) => ({ id: `В${v.variant}${k}`, text: v.passages[k].bodyMd })),
    );
    for (const p of all) {
      for (const e of existing) expect(shared(p.text, e), p.id).toBeLessThan(0.3);
      for (const q of all)
        if (q.id !== p.id)
          expect(shared(p.text, letters(q.text)), `${p.id} ~ ${q.id}`).toBeLessThan(0.3);
    }
  });
});

describe('importRussianDoshchinsky36 (database)', { timeout: 60_000 }, () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    testDb = await createTestDb();
  });
  afterAll(async () => {
    await testDb.close();
  });

  const bookTasks = () =>
    testDb.db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.source, R36_SOURCE)));

  it('imports every prepared variant into its own collection and is idempotent', async () => {
    const first = await importRussianDoshchinsky36(testDb.db);
    expect(first.variants).toBe(r36Variants.length);
    expect(first.total).toBe(r36Variants.length * 26);
    expect(first.reused).toBe(reusedCount);
    const ids = (await bookTasks()).map((t) => t.id).sort();
    expect(ids).toHaveLength(uniqueTaskCount);
    const again = await importRussianDoshchinsky36(testDb.db);
    expect(again.total).toBe(first.total);
    expect((await bookTasks()).map((t) => t.id).sort()).toEqual(ids);

    const [collection] = await testDb.db
      .select()
      .from(schema.collections)
      .where(eq(schema.collections.slug, R36_COLLECTION_SLUG));
    const variants = await testDb.db
      .select()
      .from(schema.variants)
      .where(eq(schema.variants.collectionId, collection!.id));
    expect(variants).toHaveLength(r36Variants.length);
    for (const v of variants) {
      const links = await testDb.db
        .select()
        .from(schema.variantTasks)
        .where(eq(schema.variantTasks.variantId, v.id));
      expect(
        links.map((l) => l.position).sort((a, b) => a - b),
        v.title,
      ).toEqual(Array.from({ length: 26 }, (_, i) => i + 1));
    }
  });

  it('stores alternatives, any-order flags, multi_part keys, passages and needs_review status', async () => {
    const rows = await bookTasks();
    for (const v of r36Variants) {
      for (const t of v.tasks) {
        const from = t.sameAs ?? { variant: v.variant, taskNumber: t.taskNumber };
        const row = rows.find(
          (r) => r.sourceVariant === from.variant && r.taskNumber === from.taskNumber,
        )!;
        const where = `В${v.variant} №${t.taskNumber}`;
        expect(row.status, where).toBe(t.status);
        expect(row.acceptedAnswers, where).toEqual([...t.acceptedAnswers]);
        expect(row.digitSetOrderInsensitive, where).toBe(t.digitSetOrderInsensitive);
        if (t.answerType === 'multi_part') {
          const spec = parseMultiPartSpec(row.correctAnswer);
          expect(spec?.parts.map((p) => p.correctAnswer).join(''), where).toBe(t.correctAnswer);
        } else {
          expect(row.correctAnswer, where).toBe(t.correctAnswer);
        }
        expect(row.passageId === null, where).toBe(t.passage === null);
      }
    }
  });

  it('a repeated import changes nothing: no new rows, no rewrites, same ids', async () => {
    const before = await bookTasks();
    const again = await importRussianDoshchinsky36(testDb.db);
    expect(again.created).toBe(0);
    expect(again.updated).toBe(0);
    expect(again.unchanged).toBe(uniqueTaskCount);
    expect(again.unique).toBe(uniqueTaskCount);
    expect(again.unlinked).toBe(0);
    const after = await bookTasks();
    const stamp = (rows: typeof before) =>
      rows.map((r) => `${r.id}|${r.updatedAt.toISOString()}`).sort();
    expect(stamp(after)).toEqual(stamp(before));
  });

  it('keeps attempts, mistakes and favorites on book tasks across re-imports', async () => {
    const [task] = await bookTasks();
    const [user] = await testDb.db.insert(schema.users).values({}).returning();
    const [attempt] = await testDb.db
      .insert(schema.attempts)
      .values({ userId: user!.id, taskId: task!.id, answerRaw: 'x', isCorrect: false })
      .returning();
    await testDb.db.insert(schema.mistakes).values({
      userId: user!.id,
      taskId: task!.id,
      firstAttemptId: attempt!.id,
      lastAttemptId: attempt!.id,
    });
    await testDb.db.insert(schema.favorites).values({ userId: user!.id, taskId: task!.id });

    await importRussianDoshchinsky36(testDb.db);

    const byUser = <T extends { userId: unknown }>(t: T) => eq(t.userId as never, user!.id);
    expect(
      await testDb.db.select().from(schema.attempts).where(byUser(schema.attempts)),
    ).toHaveLength(1);
    expect(
      await testDb.db.select().from(schema.mistakes).where(byUser(schema.mistakes)),
    ).toHaveLength(1);
    expect(
      await testDb.db.select().from(schema.favorites).where(byUser(schema.favorites)),
    ).toHaveLength(1);
    const [still] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, task!.id));
    expect(still?.status).toBe(task!.status);
  });

  it('refuses invalid data before writing anything (no partial import)', async () => {
    const before = (await bookTasks()).length;
    const broken = r36Variants.map((v) =>
      v.variant === 36 ? { ...v, tasks: v.tasks.filter((t) => t.taskNumber !== 26) } : v,
    );
    await expect(importRussianDoshchinsky36(testDb.db, broken)).rejects.toThrow(
      /В36: tasks are not 1–26/,
    );
    const badRef = r36Variants.map((v) =>
      v.variant === 21
        ? {
            ...v,
            tasks: v.tasks.map((t) =>
              t.sameAs ? { ...t, sameAs: { variant: 30, taskNumber: 13 } } : t,
            ),
          }
        : v,
    );
    await expect(importRussianDoshchinsky36(testDb.db, badRef)).rejects.toThrow(/bad sameAs/);
    expect(await bookTasks()).toHaveLength(before);
  });

  it('rolls back the whole book when the database rejects a row late in the import', async () => {
    const original = (await bookTasks()).find((t) => t.sourceVariant === 1 && t.taskNumber === 1);
    expect(original).toBeDefined();
    // В1 №1 changes (written first), then В36 №26 violates NOT NULL (written last).
    const failing = r36Variants.map((v) =>
      v.variant === 1
        ? {
            ...v,
            tasks: v.tasks.map((t) =>
              t.taskNumber === 1 ? { ...t, explanationMd: 'изменённое объяснение' } : t,
            ),
          }
        : v.variant === 36
          ? {
              ...v,
              tasks: v.tasks.map((t) =>
                t.taskNumber === 26 ? { ...t, conditionMd: null as unknown as string } : t,
              ),
            }
          : v,
    );
    await expect(importRussianDoshchinsky36(testDb.db, failing)).rejects.toThrow(
      /condition_md|null/i,
    );
    const after = (await bookTasks()).find((t) => t.id === original!.id);
    expect(after?.explanationMd).toBe(original!.explanationMd);
    expect(after?.updatedAt).toEqual(original!.updatedAt);
  });

  it('stores a needs_review task hidden and publishes it only when the data says so', async () => {
    const flagged = r36Variants.map((v) =>
      v.variant === 9
        ? {
            ...v,
            tasks: v.tasks.map((t) =>
              t.taskNumber === 26
                ? { ...t, status: 'needs_review' as const, reviewReason: 'test' }
                : t,
            ),
          }
        : v,
    );
    const r = await importRussianDoshchinsky36(testDb.db, flagged);
    expect(r.needsReview).toBe(1);
    expect(r.updated).toBe(1);
    const row = (await bookTasks()).find((t) => t.sourceVariant === 9 && t.taskNumber === 26)!;
    expect(row.status).toBe('needs_review');
    const back = await importRussianDoshchinsky36(testDb.db);
    expect(back.updated).toBe(1);
    const again = (await bookTasks()).find((t) => t.sourceVariant === 9 && t.taskNumber === 26)!;
    expect(again.status).toBe(
      r36Variants.find((v) => v.variant === 9)!.tasks.find((t) => t.taskNumber === 26)!.status,
    );
    expect(again.id).toBe(row.id);
  });

  it('replaces a stale own row of a repeated task with the link to the original (row archived, not deleted)', async () => {
    const [collection] = await testDb.db
      .select()
      .from(schema.collections)
      .where(eq(schema.collections.slug, R36_COLLECTION_SLUG));
    const [v21] = await testDb.db
      .select()
      .from(schema.variants)
      .where(
        and(
          eq(schema.variants.collectionId, collection!.id),
          eq(schema.variants.variantNumber, 21),
        ),
      );
    const [stale] = await testDb.db
      .insert(schema.tasks)
      .values({
        subjectId: 'russian',
        taskNumber: 13,
        conditionMd: 'stale copy',
        rawStatement: 'stale copy',
        difficulty: 2,
        correctAnswer: '23',
        explanationMd: '',
        source: R36_SOURCE,
        sourceVariant: 21,
        contentHash: 'stale-v21-13',
        status: 'published',
      })
      .returning();
    await testDb.db
      .insert(schema.variantTasks)
      .values({ variantId: v21!.id, taskId: stale!.id, position: 13 });

    const r = await importRussianDoshchinsky36(testDb.db);
    expect(r.unlinked).toBe(1);
    const links = await testDb.db
      .select()
      .from(schema.variantTasks)
      .where(eq(schema.variantTasks.variantId, v21!.id));
    expect(links).toHaveLength(26);
    expect(links.some((l) => l.taskId === stale!.id)).toBe(false);
    const [archived] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, stale!.id));
    expect(archived?.status).toBe('archived');
  });

  it('coexists with the earlier Дощинский collection without touching it', async () => {
    const earlier = await importRussianVariant1(testDb.db);
    expect(earlier.total).toBe(27);
    await importRussianDoshchinsky36(testDb.db);
    // Book rows: the unique tasks plus the archived stale row from the test above.
    const rows = await bookTasks();
    expect(rows.filter((r) => r.status !== 'archived')).toHaveLength(uniqueTaskCount);
  });
});
