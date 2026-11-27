import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { importRussianDoshchinsky36 } from './importRussianDoshchinsky2027Book36.js';
import * as schema from './schema.js';
import { createTestDb } from './testing.js';

/**
 * Task 15 (Н / НН) of the Дощинский 2027 Russian books: the answer is a set
 * of place numbers, so every condition must carry its numbered places —
 * «созна(1)ии» — and every digit of the answer must be one of them. A
 * condition recognised without its gaps (variant 7, p. 53, before the fix)
 * showed whole words and could not be solved.
 */
describe('Дощинский 2027, task 15: numbered places', { timeout: 300_000 }, () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
    for (const run of [
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
    ])
      await run(testDb.db);
    await importRussianDoshchinsky36(testDb.db);
  }, 300_000);
  afterAll(async () => {
    await testDb.close();
  });

  const task15 = () =>
    testDb.db
      .select({
        id: schema.tasks.id,
        source: schema.tasks.source,
        condition: schema.tasks.conditionMd,
        answer: schema.tasks.correctAnswer,
      })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'russian'),
          eq(schema.tasks.taskNumber, 15),
          like(schema.tasks.source, 'Дощинский ЕГЭ 2027%'),
        ),
      );

  it('every task 15 has numbered places, and its answer only names them', async () => {
    const rows = await task15();
    expect(rows.length).toBeGreaterThanOrEqual(18 + 36);
    for (const r of rows) {
      const places = [...r.condition.matchAll(/\((\d)\)/g)].map((m) => m[1]!);
      expect(places.length, `${r.source} ${r.id}`).toBeGreaterThanOrEqual(2);
      expect(new Set(places).size, `${r.source} ${r.id}: a place twice`).toBe(places.length);
      for (const d of r.answer ?? '')
        expect(places, `${r.source} ${r.id}: answer ${r.answer}`).toContain(d);
    }
  });

  it('variant 7: the five places of the sentence after S. S. Kozlov, answer 234', async () => {
    const rows = await task15();
    const kozlov = rows.find((r) => r.condition.includes('утрата любимого человека'))!;
    expect(kozlov.condition).toContain(
      'в её созна(1)ии некие внутре(2)ие процессы, сделать её взгляд незамутнё(3)ым привяза(4)остями и самообма(5)ом.',
    );
    expect(kozlov.answer).toBe('234');
  });
});
