import { describe, expect, it } from 'vitest';
import type { TargetScore } from '../learningProfile.js';
import { examSkillsForSubject } from './examSkills.js';
import {
  DEFAULT_TRAINING_MIX,
  planTraining,
  recommendSkills,
  splitByMix,
  targetDifficultyFor,
  type SkillState,
  type StudentModel,
  type SubjectState,
} from './engine.js';

function skill(key: string, over: Partial<SkillState> = {}): SkillState {
  const info = [...examSkillsForSubject('math'), ...examSkillsForSubject('russian')].find(
    (s) => s.key === key,
  )!;
  return {
    key,
    subjectId: info.subjectId,
    title: info.title,
    examNumber: info.examNumber,
    part: info.part,
    mastery: 0,
    confidence: 0,
    level: 'none',
    attempts: 0,
    correct: 0,
    incorrect: 0,
    lastAttemptAt: null,
    daysSince: null,
    trend: null,
    repeatedErrorTasks: 0,
    recoveredTasks: 0,
    recent: { attempts: 0, wrong: 0 },
    openMistakes: 0,
    stuckAfterExplanation: 0,
    myAverageRating: null,
    hardButCorrect: 0,
    availableTasks: 30,
    ...over,
  };
}

function subject(
  subjectId: string,
  skills: SkillState[],
  target: TargetScore = 'unknown',
  selected = true,
): SubjectState {
  const all = examSkillsForSubject(subjectId).map(
    (s) => skills.find((x) => x.key === s.key) ?? skill(s.key),
  );
  return {
    subjectId,
    selected,
    targetScore: target,
    skills: all,
    totals: { attempts: 0, correct: 0, solvedTasks: 0, accuracy: null },
  };
}

const now = new Date('2026-11-15T12:00:00Z');
const weak13 = skill('math.equations-advanced', {
  level: 'weak',
  mastery: 35,
  attempts: 7,
  recent: { attempts: 7, wrong: 3 },
  incorrect: 3,
  correct: 4,
});

describe('recommendSkills', () => {
  it('a brand-new student gets «not solved yet» numbers, nothing invented', () => {
    const model: StudentModel = { hasProfile: true, subjects: [subject('math', [])] };
    const recs = recommendSkills(model, { now });
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((r) => r.kind === 'unexplored')).toBe(true);
    expect(recs[0]!.reason).toBe('Ты ещё не решал задания этого номера.');
  });

  it('a weak number comes with the student’s own numbers: «за последние 7 попыток — 3 ошибки»', () => {
    const recs = recommendSkills(
      { hasProfile: true, subjects: [subject('math', [weak13])] },
      { now },
    );
    expect(recs[0]).toMatchObject({
      skillKey: 'math.equations-advanced',
      examNumber: 13,
      kind: 'weak',
    });
    expect(recs[0]!.reason).toContain('За последние 7 попыток — 3 ошибки');
    expect(recs[0]!.benefit).toContain('второй части');
  });

  it('repeated errors outrank a merely weak number', () => {
    const rep9 = skill('russian.09-root-vowels', {
      level: 'developing',
      mastery: 60,
      attempts: 8,
      repeatedErrorTasks: 2,
    });
    const recs = recommendSkills(
      { hasProfile: true, subjects: [subject('math', [weak13]), subject('russian', [rep9])] },
      { now },
    );
    expect(recs[0]).toMatchObject({ skillKey: 'russian.09-root-vowels', kind: 'repeated_errors' });
    expect(recs[0]!.reason).toContain('Начни с трёх заданий');
  });

  it('a strong but long-unpracticed number is suggested for review', () => {
    const s4 = skill('math.probability-basic', {
      level: 'strong',
      mastery: 88,
      attempts: 12,
      daysSince: 21,
    });
    const r = recommendSkills(
      { hasProfile: true, subjects: [subject('math', [s4])] },
      { now },
    ).find((x) => x.skillKey === 'math.probability-basic')!;
    expect(r.kind).toBe('stale');
    expect(r.reason).toContain('не практиковал его 21 день');
  });

  it('only selected subjects; unselected ones are never recommended', () => {
    const model: StudentModel = {
      hasProfile: true,
      subjects: [subject('math', [weak13]), subject('russian', [], 'unknown', false)],
    };
    expect(recommendSkills(model, { now, limit: 50 }).every((r) => r.subjectId === 'math')).toBe(
      true,
    );
  });

  it('the target score shifts priority between part 1 and part 2', () => {
    const p1 = skill('math.vectors', {
      level: 'weak',
      mastery: 40,
      attempts: 6,
      recent: { attempts: 6, wrong: 3 },
    });
    const p2 = skill('math.equations-advanced', {
      level: 'weak',
      mastery: 40,
      attempts: 6,
      recent: { attempts: 6, wrong: 3 },
    });
    const order = (t: TargetScore) =>
      recommendSkills({ hasProfile: true, subjects: [subject('math', [p1, p2], t)] }, { now })
        .filter((r) => r.kind === 'weak')
        .map((r) => r.examNumber);
    expect(order('60_plus')).toEqual([2, 13]);
    expect(order('90_plus')).toEqual([13, 2]);
  });

  it('a skill just practiced without errors is pushed down (no repeating the same advice)', () => {
    const a = skill('math.vectors', {
      level: 'weak',
      mastery: 40,
      attempts: 6,
      recent: { attempts: 6, wrong: 3 },
    });
    const b = skill('math.stereometry', {
      level: 'weak',
      mastery: 42,
      attempts: 6,
      recent: { attempts: 6, wrong: 3 },
    });
    const model = { hasProfile: true, subjects: [subject('math', [a, b])] };
    expect(recommendSkills(model, { now })[0]!.skillKey).toBe('math.vectors');
    expect(
      recommendSkills(model, { now, recentlyPracticedClean: new Set(['math.vectors']) })[0]!
        .skillKey,
    ).toBe('math.stereometry');
  });

  it('the essay (not auto-checked) and topics without tasks are never recommended for training', () => {
    const recs = recommendSkills(
      {
        hasProfile: true,
        subjects: [
          subject('russian', [
            skill('russian.27-essay', { level: 'weak', mastery: 10, attempts: 5 }),
          ]),
        ],
      },
      { now, limit: 50 },
    );
    expect(recs.find((r) => r.skillKey === 'russian.27-essay')).toBeUndefined();
  });
});

describe('planTraining', () => {
  it('splits by the mix (50/25/15/10) with exact totals', () => {
    expect(splitByMix(10, DEFAULT_TRAINING_MIX)).toEqual({
      weak: 5,
      mistakes: 3,
      stale: 1,
      strong: 1,
    });
    for (const total of [1, 3, 7, 10]) {
      const c = splitByMix(total, DEFAULT_TRAINING_MIX);
      expect(c.weak + c.mistakes + c.stale + c.strong).toBe(total);
    }
  });

  it('uses every bucket when the profile has them', () => {
    const subj = subject('math', [
      weak13,
      skill('math.vectors', { level: 'developing', mastery: 60, attempts: 8, openMistakes: 2 }),
      skill('math.stereometry', { level: 'developing', mastery: 70, attempts: 9, daysSince: 10 }),
      skill('math.probability-basic', { level: 'strong', mastery: 90, attempts: 12, daysSince: 1 }),
    ]);
    const plan = planTraining(subj, 10);
    expect(plan.slots).toHaveLength(10);
    expect(plan.counts).toEqual({ weak: 5, mistakes: 3, stale: 1, strong: 1 });
    expect(
      plan.slots.filter((s) => s.bucket === 'mistakes').every((s) => s.skillKey === 'math.vectors'),
    ).toBe(true);
    expect(plan.slots.find((s) => s.bucket === 'strong')!.skillKey).toBe('math.probability-basic');
    // interleaved, not grouped
    expect(plan.slots.slice(0, 4).map((s) => s.bucket)).toEqual([
      'weak',
      'mistakes',
      'stale',
      'strong',
    ]);
  });

  it('missing buckets hand their slots on — a full training even with little data', () => {
    const plan = planTraining(subject('math', [weak13]), 10);
    expect(plan.slots).toHaveLength(10);
    expect(plan.counts.weak).toBe(10);
    const fresh = planTraining(subject('russian', []), 6);
    expect(fresh.slots).toHaveLength(6);
    expect(new Set(fresh.slots.map((s) => s.skillKey)).size).toBeGreaterThan(1);
  });

  it('a recommendation’s «Начать» focuses every slot on its skill', () => {
    const plan = planTraining(subject('math', [weak13]), 5, { focusSkill: 'math.vectors' });
    expect(plan.slots.every((s) => s.skillKey === 'math.vectors')).toBe(true);
  });

  it('difficulty rises only with steady success', () => {
    expect(targetDifficultyFor(0, 'none')).toBe(1.5);
    expect(targetDifficultyFor(30, 'weak')).toBeLessThan(targetDifficultyFor(60, 'developing'));
    expect(targetDifficultyFor(60, 'developing')).toBeLessThan(targetDifficultyFor(90, 'strong'));
  });
});
