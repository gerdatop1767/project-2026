import { validateStressEntries, vowelIndices } from '@zybrilka/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../schema.js';
import { createTestDb } from '../testing.js';
import { STRESS_ENTRIES, STRESS_SOURCES, STRESS_WORDS_SOURCE } from './data.js';
import { importStressDictionary } from './import.js';

describe('stress dictionary — the data', () => {
  const { entries, problems } = validateStressEntries(STRESS_ENTRIES);
  const byMarked = new Map(entries.map((e) => [e.marked, e]));

  it('every line is valid: one stressed vowel, ≥2 vowels, «ё» stressed, no duplicates', () => {
    expect(problems).toEqual([]);
    expect(entries.length).toBe(STRESS_ENTRIES.length);
    for (const e of entries) expect(vowelIndices(e.word)).toContain(e.stressIndex);
  });

  it('covers every part of speech of the task-4 list', () => {
    const count = (pos: string) => entries.filter((e) => e.partOfSpeech === pos).length;
    expect(count('сущ.')).toBeGreaterThanOrEqual(50);
    expect(count('прил.')).toBeGreaterThanOrEqual(8);
    expect(count('гл.')).toBeGreaterThanOrEqual(80);
    expect(count('прич.')).toBeGreaterThanOrEqual(20);
    expect(count('деепр.')).toBeGreaterThanOrEqual(5);
    expect(count('нар.')).toBeGreaterThanOrEqual(8);
  });

  // An independent table of the exam's classic traps: where the stress
  // must fall (index of the vowel), checked against the data.
  it.each([
    ['тОрты', 1],
    ['звонИт', 4],
    ['свЁкла', 2],
    ['кухОнный', 3],
    ['каталОг', 5],
    ['договорЁнность', 7],
    ['жалюзИ', 5],
    ['бАнты', 1],
    ['крАны', 2],
    ['щавЕль', 3],
    ['цЕнтнер', 1],
    ['дефИс', 3],
    ['вероисповЕдание', 9],
    ['оптОвый', 3],
    ['красИвее', 4],
    ['облегчИть', 6],
    ['углубИть', 5],
    ['вклЮчит', -1], // the wrong one must NOT be there
    ['включИт', 5],
    ['начАв', 3],
    ['прИнятый', 2],
    ['вОвремя', 1],
    ['дОсуха', 1],
  ])('%s', (marked, index) => {
    const entry = byMarked.get(marked);
    if (index === -1) expect(entry).toBeUndefined();
    else expect(entry?.stressIndex).toBe(index);
  });

  it('forms whose stress differs stay separate entries', () => {
    for (const form of ['зАнял', 'занялА', 'зАняли', 'нАчал', 'началА', 'нАчали']) {
      expect(byMarked.has(form), form).toBe(true);
    }
    expect(byMarked.get('кремЕнь')!.formNote).toBe('И. п. ед. ч.');
    expect(byMarked.get('кремнЯ')!.formNote).toBe('Р. п. ед. ч.');
  });

  it('is honest about its provenance', () => {
    const source = STRESS_SOURCES.find((s) => s.id === STRESS_WORDS_SOURCE)!;
    expect(source.kind).toBe('official');
    expect(source.verification).toMatch(/не сверен/);
    // Only the four words a secondary source reports as dropped in 2026.
    expect(
      entries
        .filter((e) => e.removed2026)
        .map((e) => e.marked)
        .sort(),
    ).toEqual(['жилОсь', 'зАтемно', 'нарОст', 'пОручни'].sort());
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
    const removed = again.find((w) => w.marked === 'нарОст')!;
    expect(removed).toMatchObject({ listStatus: 'reported_removed', stressStatus: 'confirmed' });
    expect(removed.note).toMatch(/2026/);
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
      importStressDictionary(testDb.db, [...STRESS_ENTRIES, 'тортЫ | сущ.', 'кОт | сущ.']),
    ).rejects.toThrow(/invalid/);
    expect(await words()).toEqual(before);
  });
});
