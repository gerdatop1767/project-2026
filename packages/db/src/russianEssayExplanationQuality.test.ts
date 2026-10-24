import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema.js';
import { importRussianVariant1 } from './importRussianDoshchinsky2027Variant1.js';
import { importRussianVariant14 } from './importRussianDoshchinsky2027Variant14.js';
import { importRussianVariant15 } from './importRussianDoshchinsky2027Variant15.js';
import { importRussianVariant16 } from './importRussianDoshchinsky2027Variant16.js';
import { importRussianVariant17 } from './importRussianDoshchinsky2027Variant17.js';
import { importRussianVariant18 } from './importRussianDoshchinsky2027Variant18.js';
import { createTestDb } from './testing.js';

/**
 * Regression guard: `explanationMd`/`hintMd`/`conditionMd`/`sampleEssayMd`
 * are rendered to end users as-is through `MathText`, which has no
 * concept of backtick code spans or markdown tables — a backtick-wrapped
 * identifier like `correctAnswer` or an internal file path renders as
 * literal, confusing text on screen, not a styled code span. A prior
 * pass left exactly this kind of leak in several Russian ЕГЭ variants'
 * task 27 explanations (references to `EssayNotGradableError`, a repo
 * doc path, `acceptedAnswers`) — this test makes sure it can't silently
 * come back for any Russian task, in any variant.
 */
describe('Russian ЕГЭ explanations never leak technical identifiers to the UI', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
    const { db } = testDb;
    await importRussianVariant1(db);
    await importRussianVariant14(db);
    await importRussianVariant15(db);
    await importRussianVariant16(db);
    await importRussianVariant17(db);
    await importRussianVariant18(db);
  });

  afterAll(async () => {
    await testDb.close();
  });

  it('no explanationMd/hintMd/conditionMd/sampleEssayMd contains a backtick (code-span markdown MathText does not render)', async () => {
    const { db } = testDb;
    const rows = await db.select().from(schema.tasks).where(eq(schema.tasks.subjectId, 'russian'));
    expect(rows.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const row of rows) {
      for (const [field, value] of [
        ['explanationMd', row.explanationMd],
        ['hintMd', row.hintMd],
        ['conditionMd', row.conditionMd],
        ['sampleEssayMd', row.sampleEssayMd],
      ] as const) {
        if (value?.includes('`')) {
          offenders.push(`вариант ${row.sourceVariant} задание ${row.taskNumber} (${field})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('task 27 (essay) in every variant tells the user honestly there is no single correct answer', async () => {
    const { db } = testDb;
    for (const variant of [1, 14, 15, 16, 17, 18]) {
      const [task27] = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.subjectId, 'russian'),
            eq(schema.tasks.sourceVariant, variant),
            eq(schema.tasks.taskNumber, 27),
          ),
        );
      expect(task27, `variant ${variant} task 27`).toBeDefined();
      expect(task27!.explanationMd).toContain('нет единственного правильного ответа');
      expect(task27!.explanationMd).toContain('критери');
    }
  });

  it('task 27 explanation names the real К1-К12 scale, not an invented or per-text score', async () => {
    const { db } = testDb;
    for (const variant of [1, 14, 15, 16, 17, 18]) {
      const [task27] = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.subjectId, 'russian'),
            eq(schema.tasks.sourceVariant, variant),
            eq(schema.tasks.taskNumber, 27),
          ),
        );
      expect(task27!.explanationMd).toContain('К1');
      expect(task27!.explanationMd).toContain('К12');
      expect(task27!.explanationMd).toContain('25 балл');
      // Never claims to have scored this specific essay.
      expect(task27!.explanationMd).not.toMatch(/твоя работа.*получ|ты набрал|балл[аы]? за эт/i);
    }
  });

  it('no internal implementation names (error classes, repo/doc paths, DB field names) leak into explanationMd', async () => {
    const { db } = testDb;
    const rows = await db
      .select({
        explanationMd: schema.tasks.explanationMd,
        sourceVariant: schema.tasks.sourceVariant,
        taskNumber: schema.tasks.taskNumber,
      })
      .from(schema.tasks)
      .where(eq(schema.tasks.subjectId, 'russian'));
    const forbidden = [
      'EssayNotGradableError',
      'docs/imports/',
      'apps/api/src',
      'schema.tasks',
      'acceptedAnswers',
    ];
    for (const row of rows) {
      for (const needle of forbidden) {
        expect(
          row.explanationMd.includes(needle),
          `variant ${row.sourceVariant} task ${row.taskNumber} explanationMd contains "${needle}"`,
        ).toBe(false);
      }
    }
  });
});
