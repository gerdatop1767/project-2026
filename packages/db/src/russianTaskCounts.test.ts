import { eq } from 'drizzle-orm';
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
 * Verifies the Russian ЕГЭ task counter arithmetic: 6 imported variants
 * (1, 14-18) × 27 tasks = 162 total. A full-base re-audit (covering all
 * 18 variants, this slice included) resolved variant 16 task 18 and most
 * of variant 17/18's remaining items (17:10, 17:18, 17:26, 18:5, 18:10,
 * 18:18) via independent re-verification against source page images;
 * the 2026-11 quality audit then resolved 15:8 and 17:8, so only
 * variant 15's task 6 (a stray word in the condition that needs the scan)
 * remains `needs_review` from that group; the task 4 audit
 * (docs/imports/task-4-audit-2027.md) added 15:4 and 16:4, whose keys
 * contradict FIPI's orthoepic list and wait for a scan check. 159 of 162
 * tasks in this slice are
 * `published`. A "why does it say N" question was raised during a UI
 * audit; this test establishes, against the real import pipeline (not a
 * guess), that this count is correct for exactly this reason, not a
 * counting bug — so a future change to this number is a real signal, not
 * noise.
 */
describe('Russian ЕГЭ task counts (162 total / 159 published / 3 needs_review)', () => {
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

  it('imports exactly 27 tasks per variant, 162 total for the russian subject', async () => {
    const { db } = testDb;
    const rows = await db.select().from(schema.tasks).where(eq(schema.tasks.subjectId, 'russian'));
    expect(rows).toHaveLength(162);
    const byVariant = new Map<number, number>();
    for (const row of rows) {
      if (row.sourceVariant == null) continue;
      byVariant.set(row.sourceVariant, (byVariant.get(row.sourceVariant) ?? 0) + 1);
    }
    for (const variant of [1, 14, 15, 16, 17, 18]) {
      expect(byVariant.get(variant), `variant ${variant}`).toBe(27);
    }
  });

  it('159 published + 3 needs_review = 162', async () => {
    const { db } = testDb;
    const rows = await db.select().from(schema.tasks).where(eq(schema.tasks.subjectId, 'russian'));
    const published = rows.filter((r) => r.status === 'published');
    const needsReview = rows.filter((r) => r.status === 'needs_review');
    expect(published).toHaveLength(159);
    expect(needsReview).toHaveLength(3);
    expect(published.length + needsReview.length).toBe(rows.length);
  });

  it('every needs_review task is one of the 3 documented, audited ones — nothing unexpectedly unpublished', async () => {
    const { db } = testDb;
    const rows = await db.select().from(schema.tasks).where(eq(schema.tasks.subjectId, 'russian'));
    const needsReview = rows
      .filter((r) => r.status === 'needs_review')
      .map((r) => `${r.sourceVariant}:${r.taskNumber}`)
      .sort();
    // Essay task 27 publishes with a sample in every variant now, so
    // none of it shows up here. В15 №8 and В17 №8 were resolved and published by the
    // 2026-11 quality audit (docs/reports/2026-11-russian-quality-audit.md).
    const expected = ['15:4', '15:6', '16:4'].sort();
    expect(needsReview).toEqual(expected);
  });
});
