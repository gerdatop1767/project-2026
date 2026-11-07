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

  it('coexists with the earlier Дощинский collection without touching it', async () => {
    const earlier = await importRussianVariant1(testDb.db);
    expect(earlier.total).toBe(27);
    await importRussianDoshchinsky36(testDb.db);
    expect(await bookTasks()).toHaveLength(uniqueTaskCount);
  });
});
