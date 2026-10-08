import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema.js';
import { createImportedVariantsTestDb } from './testing.js';
import { importVariant1 } from './importEge2026Variant1.js';
import { importVariant2 } from './importEge2026Variant2.js';
import { importVariant3 } from './importEge2026Variant3.js';
import { importVariant4 } from './importEge2026Variant4.js';
import { importVariant5 } from './importEge2026Variant5.js';

/**
 * Integration audit (Block "audit ege 2026 variants 1-5 integration"):
 * proves the full real-data 5×19 matrix is correct and stable, on top
 * of each variant's own already-passing per-variant test file. This
 * file checks properties that only exist once ALL five variants are
 * imported together — the full matrix shape, cross-variant duplicate
 * detection, and idempotency of re-running all five imports in one
 * database — which no single variant's test file can check on its
 * own.
 */
describe('EGE-2026 V1-V5 integration audit — full 5×19 matrix', () => {
  let testDb: Awaited<ReturnType<typeof createImportedVariantsTestDb>>;

  beforeAll(async () => {
    testDb = await createImportedVariantsTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it('has exactly 95 published real EGE-2026 tasks (5 variants × 19 numbers)', async () => {
    const { db } = testDb;
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(
        and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.source, 'Ященко ЕГЭ 2026. Типовые экзаменационные варианты')),
      );
    expect(rows.length).toBe(95);
    expect(rows.every((r) => r.status === 'published')).toBe(true);
  });

  it('has exactly one task per (variant, taskNumber) — no missing, no extra, no duplicates', async () => {
    const { db } = testDb;
    const rows = await db
      .select({ sourceVariant: schema.tasks.sourceVariant, taskNumber: schema.tasks.taskNumber })
      .from(schema.tasks)
      .where(
        and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.source, 'Ященко ЕГЭ 2026. Типовые экзаменационные варианты')),
      );

    const seen = new Map<string, number>();
    for (const row of rows) {
      const key = `${row.sourceVariant}:${row.taskNumber}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }

    const missing: string[] = [];
    const duplicated: string[] = [];
    for (const variant of [1, 2, 3, 4, 5]) {
      for (let taskNumber = 1; taskNumber <= 19; taskNumber++) {
        const key = `${variant}:${taskNumber}`;
        const count = seen.get(key) ?? 0;
        if (count === 0) missing.push(key);
        if (count > 1) duplicated.push(key);
      }
    }
    expect(missing).toEqual([]);
    expect(duplicated).toEqual([]);
    expect(seen.size).toBe(95);
  });

  it('has no duplicate task ids and no duplicate content hashes across the whole matrix', async () => {
    const { db } = testDb;
    const rows = await db
      .select({ id: schema.tasks.id, contentHash: schema.tasks.contentHash })
      .from(schema.tasks)
      .where(
        and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.source, 'Ященко ЕГЭ 2026. Типовые экзаменационные варианты')),
      );
    expect(new Set(rows.map((r) => r.id)).size).toBe(95);
    expect(new Set(rows.map((r) => r.contentHash)).size).toBe(95);
  });

  it('every task belongs to the correct variant via variant_tasks, with matching position', async () => {
    const { db } = testDb;
    const variants = await db
      .select()
      .from(schema.variants)
      .innerJoin(schema.collections, eq(schema.collections.id, schema.variants.collectionId))
      .where(eq(schema.collections.slug, 'ege-2026-yashchenko'));
    expect(variants).toHaveLength(5);

    for (const { variants: variant } of variants) {
      const members = await db
        .select()
        .from(schema.variantTasks)
        .innerJoin(schema.tasks, eq(schema.tasks.id, schema.variantTasks.taskId))
        .where(eq(schema.variantTasks.variantId, variant.id));
      expect(members).toHaveLength(19);
      for (const { variant_tasks: vt, tasks: task } of members) {
        // The variant_tasks row's position must match the task's own
        // real taskNumber and sourceVariant — never a reused id from a
        // different variant's table (variant isolation).
        expect(vt.position).toBe(task.taskNumber);
        expect(task.sourceVariant).toBe(variant.variantNumber);
      }
    }
  });

  it('re-running all five imports is idempotent — same 95 tasks, same ids, same content hashes', async () => {
    const { db } = testDb;
    const before = await db
      .select({ id: schema.tasks.id, taskNumber: schema.tasks.taskNumber, sourceVariant: schema.tasks.sourceVariant, contentHash: schema.tasks.contentHash })
      .from(schema.tasks)
      .where(
        and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.source, 'Ященко ЕГЭ 2026. Типовые экзаменационные варианты')),
      );
    expect(before).toHaveLength(95);

    await importVariant1(db);
    await importVariant2(db);
    await importVariant3(db);
    await importVariant4(db);
    await importVariant5(db);

    const after = await db
      .select({ id: schema.tasks.id, taskNumber: schema.tasks.taskNumber, sourceVariant: schema.tasks.sourceVariant, contentHash: schema.tasks.contentHash })
      .from(schema.tasks)
      .where(
        and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.source, 'Ященко ЕГЭ 2026. Типовые экзаменационные варианты')),
      );
    expect(after).toHaveLength(95);

    const beforeById = new Map(before.map((r) => [r.id, r]));
    for (const row of after) {
      const prior = beforeById.get(row.id);
      expect(prior).toBeDefined();
      expect(row.taskNumber).toBe(prior!.taskNumber);
      expect(row.sourceVariant).toBe(prior!.sourceVariant);
      expect(row.contentHash).toBe(prior!.contentHash);
    }

    // variant_tasks relations must also stay exactly 19 per variant,
    // never doubled by the re-import.
    const variants = await db
      .select()
      .from(schema.variants)
      .innerJoin(schema.collections, eq(schema.collections.id, schema.variants.collectionId))
      .where(eq(schema.collections.slug, 'ege-2026-yashchenko'));
    for (const { variants: variant } of variants) {
      const members = await db
        .select()
        .from(schema.variantTasks)
        .where(eq(schema.variantTasks.variantId, variant.id));
      expect(members).toHaveLength(19);
    }

    // Still exactly one collection and five variants — the re-import
    // must never create a second collection row.
    const collections = await db
      .select()
      .from(schema.collections)
      .where(eq(schema.collections.slug, 'ege-2026-yashchenko'));
    expect(collections).toHaveLength(1);
    expect(variants).toHaveLength(5);
  });

  it('answer type distribution across the 95-task matrix matches each variant report (interval/short_answer/multi_part only)', async () => {
    const { db } = testDb;
    const rows = await db
      .select({ answerType: schema.tasks.answerType })
      .from(schema.tasks)
      .where(
        and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.source, 'Ященко ЕГЭ 2026. Типовые экзаменационные варианты')),
      );
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.answerType, (counts.get(row.answerType) ?? 0) + 1);
    }
    // Every value must be one of the three answer types the grading
    // system supports — no stray/unknown type slipped in by a typo.
    expect([...counts.keys()].every((t) => ['short_answer', 'interval', 'multi_part'].includes(t))).toBe(
      true,
    );
    expect(rows).toHaveLength(95);
  });

  it('every imageUrl on the matrix points at a file that actually exists on disk', async () => {
    const { db } = testDb;
    const rows = await db
      .select({ imageUrl: schema.tasks.imageUrl, taskNumber: schema.tasks.taskNumber, sourceVariant: schema.tasks.sourceVariant })
      .from(schema.tasks)
      .where(
        and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.source, 'Ященко ЕГЭ 2026. Типовые экзаменационные варианты')),
      );
    const withImages = rows.filter((r) => r.imageUrl !== null);
    expect(withImages.length).toBeGreaterThan(0);

    const publicDir = fileURLToPath(new URL('../../../apps/web/public', import.meta.url));
    for (const row of withImages) {
      const relativePath = row.imageUrl!.replace(/^\//, '');
      const dir = relativePath.split('/').slice(0, -1).join('/');
      const filename = relativePath.split('/').at(-1)!;
      const entries = readdirSync(`${publicDir}/${dir}`);
      expect(entries, `V${row.sourceVariant} №${row.taskNumber}: ${row.imageUrl}`).toContain(filename);
    }
  });

  it('every task_skills link points at a skill that exists (no broken skill references)', async () => {
    const { db } = testDb;
    const links = await db.select().from(schema.taskSkills);
    const skillIds = new Set((await db.select({ id: schema.skills.id }).from(schema.skills)).map((s) => s.id));
    for (const link of links) {
      expect(skillIds.has(link.skillId), `dangling skillId ${link.skillId}`).toBe(true);
    }
  });
});
