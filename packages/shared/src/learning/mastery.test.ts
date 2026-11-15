import { describe, expect, it } from 'vitest';
import { calculateSkillMastery, skillLevel, type SkillAttemptRecord } from './mastery.js';

const day = 24 * 60 * 60 * 1000;
const t0 = new Date('2026-11-01T10:00:00Z').getTime();

/** Attempts one minute apart (or `gapDays` apart), oldest first. */
function seq(
  pattern: string,
  opts: { gapDays?: number; difficulty?: number; task?: (i: number) => string } = {},
) {
  return [...pattern].map((c, i): SkillAttemptRecord => ({
    isCorrect: c === '1',
    createdAt: new Date(t0 + i * (opts.gapDays ? opts.gapDays * day : 60_000)),
    difficulty: opts.difficulty ?? 2,
    taskId: opts.task ? opts.task(i) : `t${i}`,
  }));
}

describe('calculateSkillMastery v2', () => {
  it('no attempts: nothing known — level «none», no fake numbers', () => {
    const r = calculateSkillMastery([]);
    expect(r).toMatchObject({
      attempts: 0,
      mastery: 0,
      confidence: 0,
      lastAttemptAt: null,
      trend: null,
    });
    expect(skillLevel(r)).toBe('none');
  });

  it('one correct answer does not jump to 100, one wrong answer does not drop to 0', () => {
    const right = calculateSkillMastery(seq('1'));
    const wrong = calculateSkillMastery(seq('0'));
    expect(right.mastery).toBe(60);
    expect(wrong.mastery).toBe(40);
    // …and with so little data no verdict is given.
    expect(skillLevel(right)).toBe('low_data');
    expect(skillLevel(wrong)).toBe('low_data');
    expect(right.confidence).toBeLessThan(25);
  });

  it('a long correct streak approaches 100 but never claims certainty from few answers', () => {
    const three = calculateSkillMastery(seq('111'));
    const ten = calculateSkillMastery(seq('1111111111'));
    expect(three.mastery).toBeGreaterThan(60);
    expect(ten.mastery).toBeGreaterThan(three.mastery);
    expect(ten.mastery).toBeLessThan(100);
    expect(skillLevel(ten)).toBe('strong');
    expect(ten.confidence).toBe(100);
  });

  it('a long wrong streak is weak, but one wrong answer after a strong streak is not a collapse', () => {
    expect(skillLevel(calculateSkillMastery(seq('0000000')))).toBe('weak');
    const strong = calculateSkillMastery(seq('11111111'));
    const oneSlip = calculateSkillMastery(seq('111111110'));
    expect(oneSlip.mastery).toBeLessThan(strong.mastery);
    expect(strong.mastery - oneSlip.mastery).toBeLessThan(20);
  });

  it('recent results weigh more: wrong-then-right beats right-then-wrong', () => {
    const improving = calculateSkillMastery(seq('0000011111'));
    const declining = calculateSkillMastery(seq('1111100000'));
    expect(improving.mastery).toBeGreaterThan(declining.mastery);
    expect(improving.trend).toBe('up');
    expect(declining.trend).toBe('down');
  });

  it('old successes fade: the same answers spread over months count less than last week', () => {
    const oldStreakThenMiss = calculateSkillMastery([
      ...seq('11111', { gapDays: 30 }),
      { isCorrect: false, createdAt: new Date(t0 + 300 * day), difficulty: 2 },
    ]);
    const freshStreakThenMiss = calculateSkillMastery(seq('111110'));
    expect(oldStreakThenMiss.mastery).toBeLessThan(freshStreakThenMiss.mastery);
  });

  it('difficulty: right answers on hard tasks are stronger evidence than on easy ones', () => {
    const hard = calculateSkillMastery(seq('11111', { difficulty: 3 }));
    const easy = calculateSkillMastery(seq('11111', { difficulty: 1 }));
    expect(hard.mastery).toBeGreaterThan(easy.mastery);
    const wrongEasy = calculateSkillMastery(seq('00000', { difficulty: 1 }));
    const wrongHard = calculateSkillMastery(seq('00000', { difficulty: 3 }));
    expect(wrongEasy.mastery).toBeLessThan(wrongHard.mastery);
  });

  it('counts repeated errors on one task and recovery after an error', () => {
    const r = calculateSkillMastery([
      ...seq('00', { task: () => 'A' }),
      ...seq('0', { task: () => 'B' }).map((a) => ({ ...a, createdAt: new Date(t0 + 5 * 60_000) })),
      { isCorrect: true, createdAt: new Date(t0 + 10 * 60_000), taskId: 'A', difficulty: 2 },
    ]);
    expect(r.repeatedErrorTasks).toBe(1);
    expect(r.recoveredTasks).toBe(1);
  });

  it('deterministic and order-independent: the rebuild gives the same row', () => {
    const attempts = seq('1011001110');
    const shuffled = [...attempts].reverse();
    expect(calculateSkillMastery(shuffled)).toEqual(calculateSkillMastery(attempts));
    expect(calculateSkillMastery(attempts)).toEqual(calculateSkillMastery(attempts));
  });

  it('stays within 0..100 and tracks the latest attempt time', () => {
    for (const p of ['0', '1', '0101', '1111111111111111', '0000000000000000']) {
      const r = calculateSkillMastery(seq(p));
      expect(r.mastery).toBeGreaterThanOrEqual(0);
      expect(r.mastery).toBeLessThanOrEqual(100);
      expect(r.lastAttemptAt?.getTime()).toBe(t0 + (p.length - 1) * 60_000);
    }
  });
});
