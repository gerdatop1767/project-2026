import { readFileSync } from 'node:fs';
import { buildScoringSnapshot, maxPrimaryTotal, currentScoringRules } from '@zybrilka/shared';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  R26_COLLECTION_SLUG,
  importRussianDoshchinsky2026Book36,
} from './importRussianDoshchinsky2026Book36.js';
import {
  R36_COLLECTION_SLUG,
  importRussianDoshchinsky36,
} from './importRussianDoshchinsky2027Book36.js';
import * as schema from './schema.js';
import { createImportedRussian2027TestDb } from './testing.js';

/**
 * A clean import of all three Russian collections gives each one its
 * exam format, so its variants are scored by the FIPI rules and converted
 * to test points (packages/shared examScoring, docs/SCORING.md).
 */
const EXPECTED = [
  { slug: 'ege-2027-doshchinskiy-russian', format: 'ege-russian-2027', variants: 18 },
  { slug: R26_COLLECTION_SLUG, format: 'ege-russian-2026', variants: 36 },
  { slug: R36_COLLECTION_SLUG, format: 'ege-russian-2027', variants: 36 },
] as const;

describe('Russian collections — exam format after a clean import', { timeout: 180_000 }, () => {
  let testDb: Awaited<ReturnType<typeof createImportedRussian2027TestDb>>;
  beforeAll(async () => {
    testDb = await createImportedRussian2027TestDb(); // the 18 Дощинский variants
    await importRussianDoshchinsky2026Book36(testDb.db);
    await importRussianDoshchinsky36(testDb.db);
  }, 180_000);
  afterAll(async () => {
    await testDb.close();
  });

  it('every collection gets its format from its importer', async () => {
    for (const e of EXPECTED) {
      const [c] = await testDb.db
        .select()
        .from(schema.collections)
        .where(eq(schema.collections.slug, e.slug));
      expect(c?.examFormat, e.slug).toBe(e.format);
      const variants = await testDb.db
        .select()
        .from(schema.variants)
        .where(eq(schema.variants.collectionId, c!.id));
      expect(variants, e.slug).toHaveLength(e.variants);
    }
  });

  it('every variant scores out of 50; the essay-less 2027 book offers 28 (no №27)', async () => {
    for (const e of EXPECTED) {
      expect(maxPrimaryTotal(currentScoringRules(e.format)!)).toBe(50);
      const rows = await testDb.db
        .select({ variantId: schema.variants.id, task: schema.tasks })
        .from(schema.variantTasks)
        .innerJoin(schema.variants, eq(schema.variants.id, schema.variantTasks.variantId))
        .innerJoin(schema.collections, eq(schema.collections.id, schema.variants.collectionId))
        .innerJoin(schema.tasks, eq(schema.tasks.id, schema.variantTasks.taskId))
        .where(eq(schema.collections.slug, e.slug))
        .orderBy(asc(schema.variantTasks.position));
      const byVariant = new Map<string, { taskId: string; taskNumber: number }[]>();
      for (const r of rows) {
        byVariant.set(r.variantId, [
          ...(byVariant.get(r.variantId) ?? []),
          { taskId: r.task.id, taskNumber: r.task.taskNumber },
        ]);
      }
      for (const planned of byVariant.values()) {
        const snap = buildScoringSnapshot(e.format, planned)!;
        expect(snap.examMaxTotal).toBe(50);
        const offered = snap.tasks.reduce((a, t) => a + t.rule.max, 0);
        // Tasks on review are not offered; the max never exceeds 50.
        expect(offered).toBeLessThanOrEqual(50);
        if (e.slug === R36_COLLECTION_SLUG) expect(snap.unavailableTaskNumbers).toContain(27);
      }
    }
  });

  it('all 20 Russian importers run in the sync-content chain', () => {
    const compose = readFileSync(
      new URL('../../../infra/docker-compose.yml', import.meta.url),
      'utf8',
    );
    const chain = new Set(compose.match(/importRussian[A-Za-z0-9]+\.js/g));
    for (let n = 1; n <= 18; n++) {
      expect(chain.has(`importRussianDoshchinsky2027Variant${n}.js`), `V${n}`).toBe(true);
    }
    expect(chain.has('importRussianDoshchinsky2026Book36.js')).toBe(true);
    expect(chain.has('importRussianDoshchinsky2027Book36.js')).toBe(true);
  });
});
