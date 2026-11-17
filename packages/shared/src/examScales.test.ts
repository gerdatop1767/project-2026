import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EXAM_SCALES,
  EXAM_SCORING_RULES,
  LEGACY_SCALE_MAX_YEAR,
  buildScoringSnapshot,
  convertPrimaryToTest,
  currentScoringRules,
  maxPrimaryTotal,
  scaleForFormat,
  scaleLabel,
  scaleShortLabel,
  scoreVariantAttempt,
  testScoreGain,
  validateScale,
  type ExamScale,
  type FirstAnswer,
  type VariantScoringSnapshot,
} from './examScoring.js';

/** The values as copied from the Rosobrnadzor document (with its checksum). */
const SOURCE = JSON.parse(
  readFileSync(new URL('../../../docs/sources/ege-2026-scales.json', import.meta.url), 'utf8'),
) as {
  pdfSha256: string;
  scales: Record<'russian' | 'math-profile', { maxPrimary: number; testByPrimary: number[] }>;
};

const RU = EXAM_SCALES.find((s) => s.format === 'ege-russian-2026')!;
const MATH = EXAM_SCALES.find((s) => s.format === 'ege-math-profile-2026')!;
const planned = (numbers: readonly number[]) =>
  numbers.map((n) => ({ taskId: `t${n}`, taskNumber: n }));
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('official ЕГЭ-2026 tables (Rosobrnadzor, таблица № 6)', () => {
  it('are registered for Russian (0–50) and profile math (0–32), year 2026, with the document', () => {
    expect(RU).toMatchObject({ subjectId: 'russian', examYear: 2026, status: 'official' });
    expect(MATH).toMatchObject({ subjectId: 'math', examYear: 2026, status: 'official' });
    for (const s of [RU, MATH]) {
      expect(s.source).toMatch(/04-1\/КИД.*04-6\/КИД.*таблица № 6/);
      expect(validateScale(s)).toEqual([]);
    }
    expect(RU.testByPrimary).toHaveLength(51);
    expect(MATH.testByPrimary).toHaveLength(33);
    expect(SOURCE.pdfSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(EXAM_SCALES.map((s) => s.id)).size).toBe(EXAM_SCALES.length);
  });

  it('match the source copy value by value; every primary point converts exactly', () => {
    expect(RU.testByPrimary).toEqual(SOURCE.scales.russian.testByPrimary);
    expect(MATH.testByPrimary).toEqual(SOURCE.scales['math-profile'].testByPrimary);
    SOURCE.scales.russian.testByPrimary.forEach((test, primary) => {
      expect(convertPrimaryToTest(primary, null, 'ege-russian-2026')).toMatchObject({
        available: true,
        testScore: test,
      });
    });
    SOURCE.scales['math-profile'].testByPrimary.forEach((test, primary) => {
      expect(convertPrimaryToTest(primary, null, 'ege-math-profile-2026')).toMatchObject({
        available: true,
        testScore: test,
      });
    });
  });

  it('known points: zero, minimums, intermediate values, maximum', () => {
    const ru = (p: number) => RU.testByPrimary[p];
    const math = (p: number) => MATH.testByPrimary[p];
    expect([ru(0), ru(10), ru(15), ru(40), ru(42), ru(43), ru(49), ru(50)]).toEqual([
      0, 24, 36, 73, 78, 81, 97, 100,
    ]);
    expect([math(0), math(5), math(12), math(13), math(24), math(29), math(30), math(32)]).toEqual([
      0, 27, 70, 72, 94, 99, 100, 100,
    ]);
  });

  it('values above the maximum or below zero are refused, never clamped', () => {
    for (const [p, format] of [
      [51, 'ege-russian-2026'],
      [33, 'ege-math-profile-2026'],
      [-1, 'ege-russian-2026'],
    ] as const) {
      const c = convertPrimaryToTest(p, null, format);
      expect(c.available).toBe(false);
      if (!c.available) expect(c.reason).toMatch(/некорректен/);
    }
  });

  it('no interpolation, no rounding: a fraction is refused, a whole score is the table value', () => {
    for (let p = 0; p <= 50; p += 0.25) {
      const c = convertPrimaryToTest(p, null, 'ege-russian-2026');
      if (Number.isInteger(p)) expect(c).toMatchObject({ testScore: RU.testByPrimary[p] });
      else expect(c.available).toBe(false);
    }
    for (const p of [12.4, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(convertPrimaryToTest(p, null, 'ege-math-profile-2026').available).toBe(false);
    }
  });

  it('real results are whole numbers: every rule awards whole points only', () => {
    for (const rules of EXAM_SCORING_RULES) {
      for (const rule of Object.values(rules.tasks)) {
        const values = [
          rule.max,
          rule.pointsIfCorrect ?? 0,
          ...Object.values(rule.partPoints ?? {}),
        ];
        expect(values.every(Number.isInteger), rules.id).toBe(true);
      }
    }
  });
});

describe('which table a result uses', () => {
  it('math 2026 uses its own table, labelled as a guide for ЕГЭ-2027', () => {
    expect(scaleForFormat('ege-math-profile-2026')).toMatchObject({
      basis: 'same-format',
      scale: { id: MATH.id },
    });
    const c = convertPrimaryToTest(10, null, 'ege-math-profile-2026');
    expect(c).toMatchObject({ available: true, testScore: 58, examYear: 2026 });
    if (c.available) {
      expect(c.label).toBe('Тестовый балл · ориентир по шкале ЕГЭ-2026');
      expect(scaleShortLabel(c.label)).toBe('ориентир по шкале ЕГЭ-2026');
    }
  });

  it('the Yashchenko-2027 format (33 points) never gets the 32-point table', () => {
    expect(maxPrimaryTotal(currentScoringRules('ege-math-profile-2027')!)).toBe(33);
    expect(scaleForFormat('ege-math-profile-2027')).toBeNull();
    const c = convertPrimaryToTest(33, null, 'ege-math-profile-2027');
    expect(c.available).toBe(false);
    if (!c.available) expect(c.reason).toMatch(/максимум 33 .* рассчитана на 32/);
    // Even a frozen 32-point table is refused for a 33-point attempt.
    expect(
      convertPrimaryToTest(10, MATH.id, 'ege-math-profile-2027', EXAM_SCALES, 33).available,
    ).toBe(false);
  });

  it('labels: a guide for an earlier year, plain for the exam year itself', () => {
    expect(scaleLabel({ examYear: 2026, status: 'official' })).toBe(
      'Тестовый балл · ориентир по шкале ЕГЭ-2026',
    );
    expect(scaleLabel({ examYear: 2027, status: 'official' })).toBe(
      'Тестовый балл · по шкале ЕГЭ-2027',
    );
  });

  it('a frozen table missing from the registry is never swapped silently', () => {
    const c = convertPrimaryToTest(10, 'removed-table', 'ege-math-profile-2026');
    expect(c.available).toBe(false);
    if (!c.available) expect(c.reason).toMatch(/не найдена/);
  });
});

describe('gain in test points', () => {
  it('is the difference of two results by the same table («было → станет»)', () => {
    expect(testScoreGain('ege-math-profile-2026', 10, 5)).toMatchObject({
      available: true,
      from: 58,
      to: 76,
      gain: 18,
      examYear: 2026,
      label: 'Тестовый балл · ориентир по шкале ЕГЭ-2026',
    });
    expect(testScoreGain('ege-russian-2026', 20, 5)).toMatchObject({ from: 43, to: 51, gain: 8 });
    expect(testScoreGain('ege-math-profile-2026', 30, 2)).toMatchObject({ gain: 0 });
  });

  it('is not given without a fitting table or past the maximum — with the reason', () => {
    const g = testScoreGain('ege-math-profile-2027', 10, 5);
    expect(g.available).toBe(false);
    if (!g.available) expect(g.reason).toMatch(/Растягивать шкалу нельзя/);
    expect(testScoreGain('ege-math-profile-2026', 30, 5).available).toBe(false);
  });
});

describe('table stored with each attempt', () => {
  it('a new attempt freezes the table and its year', () => {
    const math = buildScoringSnapshot('ege-math-profile-2026', planned(range(1, 19)))!;
    expect(math).toMatchObject({ scaleId: MATH.id, scaleYear: 2026 });
  });

  // A stand-in 2027 table — NOT real values, only the switching mechanics.
  const fake2027: ExamScale = {
    ...MATH,
    id: 'test-math-2027',
    examYear: 2027,
    updatedAt: '2027-04-20',
    testByPrimary: MATH.testByPrimary.map((v, p) => (p === 10 ? 59 : v)),
  };
  const withNext = [...EXAM_SCALES, fake2027];
  const answers = new Map<string, FirstAnswer>(
    range(1, 10).map((n) => [`t${n}`, { correct: true }]),
  );

  it('when a 2027 table is added, new results use it and old ones keep the 2026 table', () => {
    const old = buildScoringSnapshot('ege-math-profile-2026', planned(range(1, 19)))!;
    expect(convertPrimaryToTest(10, null, 'ege-math-profile-2026', withNext)).toMatchObject({
      testScore: 59,
      examYear: 2027,
      label: 'Тестовый балл · по шкале ЕГЭ-2027',
    });
    expect(scoreVariantAttempt(old, answers, withNext).conversion).toMatchObject({
      testScore: 58,
      examYear: 2026,
      scaleId: MATH.id,
    });
  });

  it('an attempt from before tables were registered stays on the 2026 table', () => {
    const legacy = {
      ...buildScoringSnapshot('ege-math-profile-2026', planned(range(1, 19)))!,
      scaleId: null,
    } as VariantScoringSnapshot & { scaleYear?: number | null };
    delete legacy.scaleYear;
    const c = scoreVariantAttempt(legacy, answers, withNext).conversion;
    expect(c).toMatchObject({
      available: true,
      testScore: 58,
      examYear: LEGACY_SCALE_MAX_YEAR,
      scaleId: MATH.id,
    });
  });
});
