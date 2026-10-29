import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema.js';
import { createImportedVariantsTestDb } from './testing.js';

const publicDir = fileURLToPath(new URL('../../../apps/web/public', import.meta.url));
const SOURCE_2026 = 'Ященко ЕГЭ 2026. Типовые экзаменационные варианты';

/**
 * Figures of ЕГЭ 2026 Ященко, варианты 1–10 (docs/imports/
 * ege-2026-v2-v10-figures-audit.md). A figure is a file of THIS
 * variant's own folder, used by exactly one task — never another
 * variant's picture.
 */
const KNOWN_MISSING = [
  // The condition refers to a figure the app does not have yet: the
  // source PDFs are needed to crop them (see the audit doc). When one is
  // added, remove it here.
  '3:2',
  '4:2',
  '6:2',
  '7:8',
  '7:11',
  '8:8',
  '8:11',
  '9:2',
  '9:11',
  '10:2',
  '10:11',
];

const refersToFigure = (text: string) =>
  /на рисунке|изображ[её]н|по рисунку|на клетчатой бумаге/i.test(text);

describe('ЕГЭ 2026 — figures belong to their own task', () => {
  let testDb: Awaited<ReturnType<typeof createImportedVariantsTestDb>>;
  let rows: (typeof schema.tasks.$inferSelect)[];

  beforeAll(async () => {
    testDb = await createImportedVariantsTestDb();
    rows = await testDb.db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.source, SOURCE_2026), eq(schema.tasks.subjectId, 'math')));
  });
  afterAll(async () => {
    await testDb.close();
  });

  it('every figure lies in its own variant folder, exists, and is used by one task only', () => {
    const withImage = rows.filter((r) => r.imageUrl);
    expect(withImage.length).toBe(10);
    const byHash = new Map<string, string>();
    for (const r of withImage) {
      const id = `${r.sourceVariant}:${r.taskNumber}`;
      expect(r.imageUrl, id).toMatch(
        new RegExp(
          `^/tasks/imports/ege-2026-variant-${r.sourceVariant}/task-${String(r.taskNumber).padStart(2, '0')}-`,
        ),
      );
      const file = `${publicDir}${r.imageUrl}`;
      expect(existsSync(file), id).toBe(true);
      const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
      expect(byHash.get(hash), `${id} reuses the figure of ${byHash.get(hash)}`).toBeUndefined();
      byHash.set(hash, id);
    }
    expect(new Set(withImage.map((r) => r.imageUrl)).size).toBe(withImage.length);
  });

  it('the figures present are exactly В1–В4 №8/№11 and В5–В6 №11', () => {
    const present = rows
      .filter((r) => r.imageUrl)
      .map((r) => `${r.sourceVariant}:${r.taskNumber}`)
      .sort();
    expect(present).toEqual(
      ['1:8', '1:11', '2:8', '2:11', '3:8', '3:11', '4:8', '4:11', '5:11', '6:11'].sort(),
    );
  });

  it('the tasks whose condition needs a figure but has none are exactly the known list', () => {
    const missing = rows
      .filter((r) => r.sourceVariant !== 1 && !r.imageUrl && refersToFigure(r.conditionMd))
      .map((r) => `${r.sourceVariant}:${r.taskNumber}`)
      .sort();
    expect(missing).toEqual([...KNOWN_MISSING].sort());
  });
});
