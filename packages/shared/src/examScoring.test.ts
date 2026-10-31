import { describe, expect, it } from 'vitest';
import {
  EXAM_SCALES,
  buildScoringSnapshot,
  convertPrimaryToTest,
  currentScoringRules,
  maxPrimaryTotal,
  scoreTask,
  scoreVariantAttempt,
  type ExamScale,
  type FirstAnswer,
} from './examScoring.js';

const planned2027 = (numbers: readonly number[]) =>
  numbers.map((n) => ({ taskId: `t${n}`, taskNumber: n }));
const ALL_2027 = Array.from({ length: 20 }, (_, i) => i + 1);

describe('exam scoring rules', () => {
  it('2026: 19 tasks, 32 points; 2027 (project): 20 tasks, 33 points', () => {
    const r2026 = currentScoringRules('ege-math-profile-2026')!;
    const r2027 = currentScoringRules('ege-math-profile-2027')!;
    expect(Object.keys(r2026.tasks)).toHaveLength(19);
    expect(maxPrimaryTotal(r2026)).toBe(32);
    expect(r2026.status).toBe('official');
    expect(Object.keys(r2027.tasks)).toHaveLength(20);
    expect(maxPrimaryTotal(r2027)).toBe(33);
    expect(r2027.status).toBe('project');
    expect([14, 15, 16, 17, 18, 19, 20].map((n) => r2027.tasks[n]!.max)).toEqual([
      2, 3, 2, 2, 3, 4, 4,
    ]);
    expect(currentScoringRules(null)).toBeNull();
    expect(currentScoringRules('unknown')).toBeNull();
  });

  it('scores each kind: exact, by answer (proof part not checkable), а/б/в', () => {
    const r = currentScoringRules('ege-math-profile-2027')!;
    expect(scoreTask(r.tasks[5]!, { correct: true })).toBe(1);
    expect(scoreTask(r.tasks[5]!, { correct: false })).toBe(0);
    expect(scoreTask(r.tasks[5]!, undefined)).toBe(0);
    // №15 (3 points): a correct б) earns 2 — the proof а) is never auto-checked.
    expect(scoreTask(r.tasks[15]!, { correct: true })).toBe(2);
    expect(scoreTask(r.tasks[19]!, { correct: true })).toBe(4);
    // №20: а 1 + б 1 + в 2.
    expect(
      scoreTask(r.tasks[20]!, { correct: false, correctParts: { a: true, b: false, c: false } }),
    ).toBe(1);
    expect(
      scoreTask(r.tasks[20]!, { correct: false, correctParts: { a: true, b: true, c: false } }),
    ).toBe(2);
    expect(
      scoreTask(r.tasks[20]!, { correct: true, correctParts: { a: true, b: true, c: true } }),
    ).toBe(4);
    expect(
      scoreTask(r.tasks[20]!, { correct: false, correctParts: { a: false, b: false, c: true } }),
    ).toBe(2);
  });
});

describe('variant snapshot and score', () => {
  it('a variant without №17 offers 31 of 33 points and says which number is missing', () => {
    const snap = buildScoringSnapshot(
      'ege-math-profile-2027',
      planned2027(ALL_2027.filter((n) => n !== 17)),
    )!;
    expect(snap.unavailableTaskNumbers).toEqual([17]);
    expect(snap.examMaxTotal).toBe(33);
    const score = scoreVariantAttempt(snap, new Map());
    expect(score.maxAvailable).toBe(31);
    expect(score.primary).toBe(0);
    expect(score.partOne).toEqual({ awarded: 0, max: 13 });
    expect(score.partTwo).toEqual({ awarded: 0, max: 18 });
    expect(score.tasks.every((t) => t.status === 'unanswered' && t.awarded === 0)).toBe(true);
  });

  it('adds up first answers once each; empty and wrong tasks score 0', () => {
    const snap = buildScoringSnapshot('ege-math-profile-2027', planned2027(ALL_2027))!;
    const answers = new Map<string, FirstAnswer>([
      ['t1', { correct: true }],
      ['t2', { correct: false }],
      ['t14', { correct: true }],
      ['t15', { correct: true }],
      ['t20', { correct: false, correctParts: { a: true, b: true, c: false } }],
    ]);
    const score = scoreVariantAttempt(snap, answers);
    expect(score.primary).toBe(1 + 0 + 2 + 2 + 2);
    expect(score.partOne.awarded).toBe(1);
    expect(score.partTwo.awarded).toBe(6);
    const byNumber = new Map(score.tasks.map((t) => [t.taskNumber, t]));
    expect(byNumber.get(2)!.status).toBe('zero');
    expect(byNumber.get(3)!.status).toBe('unanswered');
    expect(byNumber.get(15)).toMatchObject({
      awarded: 2,
      max: 3,
      status: 'partial',
      estimated: true,
    });
    expect(byNumber.get(20)).toMatchObject({ awarded: 2, max: 4, status: 'partial' });
    expect(byNumber.get(1)).toMatchObject({ estimated: false, status: 'full' });
    // The same task listed twice in a plan is still one task.
    expect(score.tasks.filter((t) => t.taskId === 't1')).toHaveLength(1);
  });

  it('no format → no snapshot (a source without exam rules is not scored)', () => {
    expect(buildScoringSnapshot(null, planned2027(ALL_2027))).toBeNull();
  });
});

describe('primary → test score conversion', () => {
  it('has no registered scale yet, so 2027 says the conversion is unavailable — never a proportion', () => {
    expect(EXAM_SCALES).toHaveLength(0);
    const snap = buildScoringSnapshot('ege-math-profile-2027', planned2027(ALL_2027))!;
    expect(snap.scaleId).toBeNull();
    const conversion = scoreVariantAttempt(snap, new Map([['t1', { correct: true }]])).conversion;
    expect(conversion.available).toBe(false);
    if (!conversion.available) expect(conversion.reason).toMatch(/ЕГЭ-2027 ещё не опубликована/);
  });

  const fixture: ExamScale = {
    id: 'fixture-2027@approx',
    format: 'ege-math-profile-2027',
    examYear: 2027,
    status: 'approximate',
    source: 'тестовая шкала',
    updatedAt: '2027-07-01',
    testByPrimary: Array.from({ length: 34 }, (_, p) => Math.min(100, p * 4)),
  };

  it('uses the scale frozen into the attempt; a scale added later never re-scores old attempts', () => {
    const before = buildScoringSnapshot('ege-math-profile-2027', planned2027(ALL_2027))!;
    // An attempt that started with the fixture scale in force:
    const withScale = { ...before, scaleId: fixture.id };
    const ok = scoreVariantAttempt(withScale, new Map([['t19', { correct: true }]]), [fixture]);
    expect(ok.conversion).toMatchObject({ available: true, testScore: 16, status: 'approximate' });
    // The older attempt (no scale at its start) stays unconverted.
    expect(scoreVariantAttempt(before, new Map(), [fixture]).conversion.available).toBe(false);
  });

  it('clamps out-of-range primary points to the table', () => {
    expect(convertPrimaryToTest(99, fixture.id, fixture.format, [fixture])).toMatchObject({
      testScore: 100,
    });
    expect(convertPrimaryToTest(-3, fixture.id, fixture.format, [fixture])).toMatchObject({
      testScore: 0,
    });
  });
});
