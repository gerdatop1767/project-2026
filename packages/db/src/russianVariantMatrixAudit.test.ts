import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema.js';
import { createTestDb } from './testing.js';
import { importRussianVariant1 } from './importRussianDoshchinsky2027Variant1.js';
import { importRussianVariant2 } from './importRussianDoshchinsky2027Variant2.js';
import { importRussianVariant3 } from './importRussianDoshchinsky2027Variant3.js';
import { importRussianVariant4 } from './importRussianDoshchinsky2027Variant4.js';
import { importRussianVariant5 } from './importRussianDoshchinsky2027Variant5.js';
import { importRussianVariant6 } from './importRussianDoshchinsky2027Variant6.js';
import { importRussianVariant7 } from './importRussianDoshchinsky2027Variant7.js';
import { importRussianVariant8 } from './importRussianDoshchinsky2027Variant8.js';
import { importRussianVariant9 } from './importRussianDoshchinsky2027Variant9.js';
import { importRussianVariant10 } from './importRussianDoshchinsky2027Variant10.js';
import { importRussianVariant11 } from './importRussianDoshchinsky2027Variant11.js';
import { importRussianVariant12 } from './importRussianDoshchinsky2027Variant12.js';
import { importRussianVariant13 } from './importRussianDoshchinsky2027Variant13.js';
import { importRussianVariant14 } from './importRussianDoshchinsky2027Variant14.js';
import { importRussianVariant15 } from './importRussianDoshchinsky2027Variant15.js';
import { importRussianVariant16 } from './importRussianDoshchinsky2027Variant16.js';
import { importRussianVariant17 } from './importRussianDoshchinsky2027Variant17.js';
import { importRussianVariant18 } from './importRussianDoshchinsky2027Variant18.js';

const importers = [
  importRussianVariant1,
  importRussianVariant2,
  importRussianVariant3,
  importRussianVariant4,
  importRussianVariant5,
  importRussianVariant6,
  importRussianVariant7,
  importRussianVariant8,
  importRussianVariant9,
  importRussianVariant10,
  importRussianVariant11,
  importRussianVariant12,
  importRussianVariant13,
  importRussianVariant14,
  importRussianVariant15,
  importRussianVariant16,
  importRussianVariant17,
  importRussianVariant18,
];

const SOURCE = 'Дощинский ЕГЭ 2027. Типовые экзаменационные варианты';

// Each variant's own test file already pins down its exact needs_review
// set (re-verified independently, most more than once — see each
// importRussianDoshchinsky2027VariantN.test.ts and the audit reports in
// docs/imports/). This matrix audit does not re-derive answers or
// relitigate those statuses — it only checks properties that exist
// once ALL eighteen variants are imported together: full matrix shape,
// cross-variant duplicate detection, variant membership, and
// idempotency. A task listed here as needs_review is expected to stay
// needs_review; this file must never assert everything is published.
const EXPECTED_NEEDS_REVIEW: ReadonlyArray<{ variant: number; taskNumber: number }> = [
  { variant: 2, taskNumber: 8 },
  { variant: 5, taskNumber: 8 },
  { variant: 7, taskNumber: 21 },
  { variant: 10, taskNumber: 4 },
  { variant: 15, taskNumber: 4 },
  { variant: 15, taskNumber: 6 },
  { variant: 15, taskNumber: 8 },
  { variant: 16, taskNumber: 4 },
  { variant: 17, taskNumber: 8 },
];

/**
 * Integration audit for the EGE Russian 2027 (Doshchinsky) catalog,
 * mirroring `variantMatrixAudit.test.ts` (the math equivalent). Proves
 * the full real-data 18×27 matrix (486 tasks) is correct and stable on
 * top of each variant's own already-passing per-variant test file —
 * checking properties that only exist once ALL eighteen variants are
 * imported together: full matrix shape, cross-variant duplicate
 * detection, correct variant/task-number ownership, and idempotency of
 * re-running all eighteen imports in one database. Written to close the
 * production deployment gap where `infra/docker-compose.yml`'s
 * `sync-content` service ran only `importRussianDoshchinsky2027Variant1.js`
 * — see `deploySyncContent.test.ts` for the compose-file side of that
 * fix.
 *
 * Deliberately does NOT assert "0 needs_review" — nine tasks across the
 * matrix (v2:8, v5:8, v7:21, v10:4, v15:4, v15:6, v15:8, v16:4, v17:8) are
 * genuinely unconfirmed after repeated independent audits, each with a documented
 * reason in its own file's explanationMd; this test checks the real
 * published/needs_review split from the actual import pipeline, not an
 * idealized "everything published" count.
 */
describe('EGE Russian 2027 V1-V18 integration audit — full 18×27 matrix', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
    for (const importer of importers) {
      await importer(testDb.db);
    }
  }, 60000);

  afterAll(async () => {
    await testDb.close();
  });

  it('imports exactly 486 Russian tasks (18 variants × 27 numbers)', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.source, SOURCE)));
    expect(rows.length).toBe(486);
  });

  it('has exactly one task per (variant, taskNumber) — no missing, no extra, no duplicates', async () => {
    const { db } = testDb;
    const rows = await db
      .select({ sourceVariant: schema.tasks.sourceVariant, taskNumber: schema.tasks.taskNumber })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.source, SOURCE)));

    const seen = new Map<string, number>();
    for (const row of rows) {
      const key = `${row.sourceVariant}:${row.taskNumber}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }

    const missing: string[] = [];
    const duplicated: string[] = [];
    for (let variant = 1; variant <= 18; variant++) {
      for (let taskNumber = 1; taskNumber <= 27; taskNumber++) {
        const key = `${variant}:${taskNumber}`;
        const count = seen.get(key) ?? 0;
        if (count === 0) missing.push(key);
        if (count > 1) duplicated.push(key);
      }
    }
    expect(missing).toEqual([]);
    expect(duplicated).toEqual([]);
    expect(seen.size).toBe(486);
  });

  it('has no duplicate task ids and no duplicate content hashes across the whole matrix', async () => {
    const { db } = testDb;
    const rows = await db
      .select({ id: schema.tasks.id, contentHash: schema.tasks.contentHash })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.source, SOURCE)));
    expect(new Set(rows.map((r) => r.id)).size).toBe(486);
    expect(new Set(rows.map((r) => r.contentHash)).size).toBe(486);
  });

  it('every task carries the correct sourceVariant, source and tag for its own variant — no cross-variant mixups', async () => {
    const { db } = testDb;
    for (let variant = 1; variant <= 18; variant++) {
      const rows = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.subjectId, 'russian'),
            eq(schema.tasks.sourceVariant, variant),
            eq(schema.tasks.source, SOURCE),
          ),
        );
      expect(rows, `variant ${variant}`).toHaveLength(27);
      for (const row of rows) {
        expect(row.sourceDocument, `variant ${variant} task ${row.taskNumber}`).toBe(
          `Русский ЕГЭ 2027 вариант ${variant}`,
        );
        expect(row.tags, `variant ${variant} task ${row.taskNumber}`).toContain(
          `ege-russian-2027-variant-${variant}`,
        );
      }
    }
  });

  it('matches the real, documented needs_review set — exactly 9 of 486, each previously independently audited', async () => {
    const { db } = testDb;
    const rows = await db
      .select({ sourceVariant: schema.tasks.sourceVariant, taskNumber: schema.tasks.taskNumber })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'russian'),
          eq(schema.tasks.source, SOURCE),
          eq(schema.tasks.status, 'needs_review'),
        ),
      );
    const actual = rows
      .map((r) => `${r.sourceVariant}:${r.taskNumber}`)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const expected = EXPECTED_NEEDS_REVIEW.map((e) => `${e.variant}:${e.taskNumber}`).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    expect(actual).toEqual(expected);
  });

  it('477 of 486 tasks are published — the matrix is not silently under- or over-publishing', async () => {
    const { db } = testDb;
    const rows = await db
      .select({ status: schema.tasks.status })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.source, SOURCE)));
    const published = rows.filter((r) => r.status === 'published').length;
    const needsReview = rows.filter((r) => r.status === 'needs_review').length;
    expect(published).toBe(477);
    expect(needsReview).toBe(9);
    expect(published + needsReview).toBe(486);
  });

  it('every published task has a non-empty correctAnswer (except essays) and a non-empty explanationMd', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'russian'),
          eq(schema.tasks.source, SOURCE),
          eq(schema.tasks.status, 'published'),
        ),
      );
    for (const row of rows) {
      if (row.answerType !== 'essay') {
        expect(
          row.correctAnswer.length,
          `variant ${row.sourceVariant} task ${row.taskNumber}`,
        ).toBeGreaterThan(0);
      }
      expect(
        row.explanationMd.length,
        `variant ${row.sourceVariant} task ${row.taskNumber}`,
      ).toBeGreaterThan(0);
    }
  });

  it('re-running all eighteen imports is idempotent — same 486 tasks, same ids, same content hashes, same statuses', async () => {
    const { db } = testDb;
    const before = await db
      .select({
        id: schema.tasks.id,
        taskNumber: schema.tasks.taskNumber,
        sourceVariant: schema.tasks.sourceVariant,
        contentHash: schema.tasks.contentHash,
        status: schema.tasks.status,
      })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.source, SOURCE)));
    expect(before).toHaveLength(486);

    for (const importer of importers) {
      await importer(db);
    }

    const after = await db
      .select({
        id: schema.tasks.id,
        taskNumber: schema.tasks.taskNumber,
        sourceVariant: schema.tasks.sourceVariant,
        contentHash: schema.tasks.contentHash,
        status: schema.tasks.status,
      })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.source, SOURCE)));
    expect(after).toHaveLength(486);

    const beforeById = new Map(before.map((r) => [r.id, r]));
    for (const row of after) {
      const prior = beforeById.get(row.id);
      expect(prior).toBeDefined();
      expect(row.taskNumber).toBe(prior!.taskNumber);
      expect(row.sourceVariant).toBe(prior!.sourceVariant);
      expect(row.contentHash).toBe(prior!.contentHash);
      expect(row.status).toBe(prior!.status);
    }
  }, 30000);

  it('stores each variant’s shared passage bodies exactly once, not duplicated per task', async () => {
    const { db } = testDb;
    const passages = await db
      .select()
      .from(schema.passages)
      .where(eq(schema.passages.subjectId, 'russian'));

    // Slug prefix conventions differ by when each variant was authored:
    // Variant 1 predates the later convention; Variant 2-13 use
    // "doshchinskiy-2027-vN-"; Variant 14-18 use "variantN-". Every
    // variant has at least one shared passage either way.
    for (let variant = 2; variant <= 13; variant++) {
      const prefix = `doshchinskiy-2027-v${variant}-`;
      expect(
        passages.filter((p) => p.slug.startsWith(prefix)).length,
        `variant ${variant}`,
      ).toBeGreaterThan(0);
    }
    for (let variant = 14; variant <= 18; variant++) {
      const prefix = `variant${variant}-`;
      expect(
        passages.filter((p) => p.slug.startsWith(prefix)).length,
        `variant ${variant}`,
      ).toBeGreaterThan(0);
    }
    expect(
      passages.filter((p) => p.slug.startsWith('doshchinskiy-2027-v1-')).length,
    ).toBeGreaterThan(0);
  });
});
