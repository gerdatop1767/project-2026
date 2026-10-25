import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateStressEntries, vowelIndices } from '@zybrilka/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../schema.js';
import { createTestDb } from '../testing.js';
import { STRESS_ENTRIES, STRESS_SOURCES, STRESS_WORDS_SOURCE } from './data.js';
import { importStressDictionary } from './import.js';

const officialPath = fileURLToPath(
  new URL('../../../../docs/sources/fipi-orthoepic-2026.json', import.meta.url),
);
const official = JSON.parse(readFileSync(officialPath, 'utf-8')) as {
  pdf: { sha256: string };
  excludedFrom2026: { forms: string[] };
  forms: { marked: string; page: number; section: string }[];
};

describe('stress dictionary — the data', () => {
  const { entries, problems } = validateStressEntries(STRESS_ENTRIES);
  const byMarked = new Map(entries.map((e) => [e.marked, e]));

  it('every line is valid: one stressed vowel, ≥2 vowels, «ё» stressed, no duplicates, a page', () => {
    expect(problems).toEqual([]);
    expect(entries.length).toBe(STRESS_ENTRIES.length);
    for (const e of entries) {
      expect(vowelIndices(e.word)).toContain(e.stressIndex);
      expect(e.pages.length).toBeGreaterThan(0);
    }
  });

  it('is the official «Орфоэпический список – 2026» one to one — forms, stress and pages', () => {
    const officialForms = [...new Set(official.forms.map((f) => f.marked))];
    expect(officialForms).toHaveLength(219);
    expect(entries.map((e) => e.marked)).toEqual(officialForms);
    for (const e of entries) {
      const pages = [
        ...new Set(official.forms.filter((f) => f.marked === e.marked).map((f) => f.page)),
      ];
      expect(e.pages, e.marked).toEqual(pages);
    }
  });

  it('none of the forms FIPI excluded from the 2026 campaign', () => {
    const words = new Set(entries.map((e) => e.word.replace(/ё/g, 'е')));
    expect(official.excludedFrom2026.forms).toHaveLength(10);
    for (const form of official.excludedFrom2026.forms) {
      expect(words.has(form.toLowerCase()), form).toBe(false);
    }
  });

  it('the part of speech follows the list section', () => {
    const pos: Record<string, string> = {
      'Имена существительные': 'сущ.',
      'Имена прилагательные': 'прил.',
      Глаголы: 'гл.',
      'Причастия и отглагольные прилагательные': 'прич.',
      Деепричастия: 'деепр.',
      Наречия: 'нар.',
    };
    for (const e of entries) {
      const sections = official.forms
        .filter((f) => f.marked === e.marked)
        .map((f) => pos[f.section]);
      expect(sections, e.marked).toContain(e.partOfSpeech);
    }
  });

  // The exam's classic traps, as the 2026 list marks them.
  it.each([
    ['тОрты', 1],
    ['звонИт', 4],
    ['свЁкла', 2],
    ['кУхонный', 1],
    ['нЕнависть', 1],
    ['аэропОрты', 5],
    ['каталОг', 5],
    ['договорЁнность', 7],
    ['жалюзИ', 5],
    ['досУг', 3],
    ['еретИк', 4],
    ['вОвремя', 1],
    ['начАвшись', 3],
  ])('%s', (marked, index) => {
    expect(byMarked.get(marked)?.stressIndex).toBe(index);
  });

  it('forms and meanings whose stress differs stay separate entries', () => {
    for (const form of [
      'зАнял',
      'занялА',
      'зАняли',
      'нАчал',
      'началА',
      'нАчали',
      'лОктя',
      'локтЕй',
    ]) {
      expect(byMarked.has(form), form).toBe(true);
    }
    expect(byMarked.get('Отзыв')!.formNote).toMatch(/о книге/);
    expect(byMarked.get('отзЫв')!.formNote).toMatch(/посла/);
  });

  it('records where it comes from', () => {
    const source = STRESS_SOURCES.find((s) => s.id === STRESS_WORDS_SOURCE)!;
    expect(source.kind).toBe('official');
    expect(source.verification).toContain(official.pdf.sha256);
  });
});

describe('stress dictionary — import', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    testDb = await createTestDb();
  });
  afterAll(async () => {
    await testDb.close();
  });
  const words = () => testDb.db.select().from(schema.stressWords);

  it('is idempotent: the same ids on every run, sources recorded', async () => {
    const first = await importStressDictionary(testDb.db);
    expect(first).toEqual({ words: STRESS_ENTRIES.length, deactivated: 0 });
    const ids = new Map((await words()).map((w) => [w.key, w.id]));
    await importStressDictionary(testDb.db);
    const again = await words();
    expect(again).toHaveLength(STRESS_ENTRIES.length);
    for (const w of again) expect(ids.get(w.key)).toBe(w.id);
    for (const w of again) {
      expect(w).toMatchObject({
        listStatus: 'fipi_verified',
        stressStatus: 'confirmed',
        active: true,
      });
    }
    expect(await testDb.db.select().from(schema.stressSources)).toHaveLength(STRESS_SOURCES.length);
  });

  it('an entry dropped from the data is deactivated, not deleted', async () => {
    const result = await importStressDictionary(
      testDb.db,
      STRESS_ENTRIES.filter((l) => !l.startsWith('тОрты')),
    );
    expect(result.deactivated).toBe(1);
    const [torty] = await testDb.db
      .select()
      .from(schema.stressWords)
      .where(eq(schema.stressWords.marked, 'тОрты'));
    expect(torty!.active).toBe(false);
    await importStressDictionary(testDb.db);
    const [back] = await testDb.db
      .select()
      .from(schema.stressWords)
      .where(eq(schema.stressWords.marked, 'тОрты'));
    expect(back).toMatchObject({ id: torty!.id, active: true });
  });

  it('invalid data writes nothing', async () => {
    const before = await words();
    await expect(
      importStressDictionary(testDb.db, [
        ...STRESS_ENTRIES,
        'тортЫ | сущ. | | с. 2',
        'кОт | сущ. | | с. 2',
      ]),
    ).rejects.toThrow(/invalid/);
    expect(await words()).toEqual(before);
  });
});
