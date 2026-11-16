import { describe, expect, it } from 'vitest';
import { adviceCoverage, adviceFor } from './adviceBase.js';
import {
  diagnoseSkill,
  isNearMiss,
  isPartialDigitAnswer,
  type DiagnosisAttempt,
} from './diagnosis.js';
import {
  buildPlan,
  dailyTasksFor,
  dayStatus,
  MAX_TASKS_PER_DAY,
  moveDay,
  planProgress,
  recalculatePlan,
  type PlanDayState,
  type PlanFocus,
} from './plans.js';
import { accuracySeries, displayMastery, dynamicsOf } from './skillProgress.js';
import { calculateSkillMastery, skillLevel } from './mastery.js';

const T0 = new Date('2026-10-01T10:00:00Z').getTime();
const DAY = 86_400_000;
let seq = 0;
function at(
  dayOffset: number,
  ok: boolean,
  extra: Partial<DiagnosisAttempt> = {},
): DiagnosisAttempt {
  seq++;
  return {
    taskId: extra.taskId ?? `t${seq}`,
    isCorrect: ok,
    createdAt: new Date(T0 + dayOffset * DAY + seq * 1000),
    difficulty: 2,
    ...extra,
  };
}

describe('diagnosis: the cause of errors, only with enough evidence', () => {
  it('too little data → no cause, a diagnostic training instead', () => {
    const d = diagnoseSkill({
      subjectId: 'math',
      attempts: [at(0, false), at(1, false), at(2, true)],
    });
    expect(d.type).toBe('insufficient_data');
    expect(adviceFor('math', 13, d.type).title).toBe('Нужна диагностика');
  });

  it('mostly right → no problem', () => {
    const d = diagnoseSkill({
      subjectId: 'math',
      attempts: [at(0, true), at(1, true), at(2, true), at(3, true), at(4, false)],
    });
    expect(d.type).toBe('none');
  });

  it('wrong answers a slip away from the right ones → computational', () => {
    const d = diagnoseSkill({
      subjectId: 'math',
      attempts: [
        at(0, true),
        at(1, false, { nearMiss: true }),
        at(2, true),
        at(3, false, { nearMiss: true }),
        at(4, false),
      ],
    });
    expect(d.type).toBe('computational');
    expect(d.evidence[0]).toMatch(/почти совпадают/);
    // Russian has no numeric slips.
    expect(
      diagnoseSkill({
        subjectId: 'russian',
        attempts: [
          at(0, true),
          at(1, false, { nearMiss: true }),
          at(2, true),
          at(3, false, { nearMiss: true }),
        ],
      }).type,
    ).not.toBe('computational');
  });

  it('partial «номера» answers → the condition is not fully applied', () => {
    const d = diagnoseSkill({
      subjectId: 'russian',
      attempts: [
        at(0, true),
        at(1, false, { partial: true }),
        at(2, true),
        at(3, false, { partial: true }),
      ],
    });
    expect(d.type).toBe('condition');
  });

  it('wrong again after the solution was opened → the rule/formula is not applied', () => {
    const d = diagnoseSkill({
      subjectId: 'math',
      attempts: [
        at(0, false, { taskId: 'a' }),
        at(1, false, { taskId: 'a', afterExplanation: true }),
        at(2, false, { taskId: 'b', afterExplanation: true }),
        at(3, true),
      ],
    });
    expect(d.type).toBe('formula_misuse');
  });

  it('one subtype fine, its sibling not → confuses similar methods', () => {
    const d = diagnoseSkill({
      subjectId: 'russian',
      attempts: [
        at(0, true, { subtype: 'one-n' }),
        at(1, true, { subtype: 'one-n' }),
        at(2, true, { subtype: 'one-n' }),
        at(3, false, { subtype: 'double-n' }),
        at(4, false, { subtype: 'double-n' }),
        at(5, false, { subtype: 'double-n' }),
      ],
    });
    expect(d.type).toBe('confuses_methods');
    expect(adviceFor('russian', 15, d.type).generic).toBe(false);
  });

  it('easy tasks fine, hard ones not → hard tasks', () => {
    const d = diagnoseSkill({
      subjectId: 'math',
      attempts: [
        at(0, true, { difficulty: 1 }),
        at(1, true, { difficulty: 2 }),
        at(2, true, { difficulty: 1 }),
        at(3, false, { difficulty: 3 }),
        at(4, false, { difficulty: 3 }),
        at(5, false, { difficulty: 3 }),
      ],
    });
    expect(d.type).toBe('hard_tasks');
  });

  it('good before a long break, much worse after → forgetting', () => {
    const d = diagnoseSkill({
      subjectId: 'math',
      attempts: [
        at(0, true),
        at(1, true),
        at(2, true),
        at(3, true),
        at(30, false),
        at(31, false),
        at(32, true),
      ],
    });
    expect(d.type).toBe('forgetting');
    expect(d.evidence[0]).toMatch(/До перерыва/);
  });

  it('mostly right, slips fixed next try without the solution → careless', () => {
    const d = diagnoseSkill({
      subjectId: 'math',
      attempts: [
        at(0, true),
        at(1, true),
        at(2, false, { taskId: 'x' }),
        at(2.01, true, { taskId: 'x' }),
        at(3, true),
        at(4, false, { taskId: 'y' }),
        at(4.01, true, { taskId: 'y' }),
        at(5, true),
      ],
    });
    expect(d.type).toBe('careless');
  });

  it('low everywhere on different tasks → the rule (ru) or the algorithm (math)', () => {
    const many = [
      at(0, false),
      at(1, false),
      at(2, true),
      at(3, false),
      at(4, false),
      at(5, false),
    ];
    expect(diagnoseSkill({ subjectId: 'russian', attempts: many }).type).toBe('theory_gap');
    expect(diagnoseSkill({ subjectId: 'math', attempts: many }).type).toBe('algorithm_gap');
  });

  it('errors without any pattern → unclear (diagnostics), never a made-up cause', () => {
    const d = diagnoseSkill({
      subjectId: 'math',
      attempts: [at(0, true), at(1, false), at(2, true), at(3, false), at(4, true), at(5, true)],
    });
    expect(d.type).toBe('unclear');
  });

  it('answer facts', () => {
    expect(isNearMiss('-12', '12')).toBe(true);
    expect(isNearMiss('1,5', '15')).toBe(true);
    expect(isNearMiss('101', '100')).toBe(true);
    expect(isNearMiss('7', '100')).toBe(false);
    expect(isNearMiss('abc', '1')).toBe(false);
    expect(isPartialDigitAnswer('13', '135')).toBe(true);
    expect(isPartialDigitAnswer('531', '135')).toBe(false);
    expect(isPartialDigitAnswer('24', '135')).toBe(false);
  });
});

describe('advice base', () => {
  it('every concrete cause has a concrete advice with steps, practice and a control check', () => {
    for (const subject of ['math', 'russian']) {
      for (const p of [
        'theory_gap',
        'algorithm_gap',
        'formula_misuse',
        'computational',
        'condition',
        'confuses_methods',
        'careless',
        'hard_tasks',
        'forgetting',
      ] as const) {
        const a = adviceFor(subject, 9, p);
        expect(a.steps.length).toBeGreaterThan(0);
        expect(a.review.length).toBeGreaterThan(0);
        expect(a.practice.tasks).toBeGreaterThan(0);
        expect(a.control.tasks).toBeGreaterThan(0);
        expect(a.steps.join(' ')).not.toMatch(/больше практикуйся/i);
      }
    }
  });
  it('a specific entry wins; otherwise the subject entry, marked generic (a gap of the base)', () => {
    expect(adviceFor('math', 14, 'confuses_methods')).toMatchObject({
      generic: false,
      id: 'math:14:confuses_methods',
    });
    expect(adviceFor('math', 6, 'confuses_methods').generic).toBe(true);
    expect(adviceFor('history', 3, 'careless').title).toBe('Нужна диагностика');
    expect(adviceCoverage().specific).toContain('russian:15:confuses_methods');
  });
});

const focus = (extra: Partial<PlanFocus> = {}): PlanFocus => ({
  skillKey: 'math.equations-advanced',
  subjectId: 'math',
  title: 'Уравнения',
  examNumber: 13,
  problem: 'algorithm_gap',
  mastery: 35,
  accuracy: 40,
  attempts: 10,
  availableTasks: 35,
  ...extra,
});
const state = (days: ReturnType<typeof buildPlan>): PlanDayState[] =>
  days.map((d) => ({ ...d, skipped: false }));

describe('plans', () => {
  it('a week: 7 days of the focus number following the template, within daily limits', () => {
    const days = buildPlan({ kind: 'week', focus: [focus()], startDate: '2026-11-16' });
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.activity)).toEqual([
      'theory_basic',
      'practice',
      'mistakes_review',
      'algorithm_review',
      'no_hints',
      'control',
      'progress_check',
    ]);
    expect(days[0]!.date).toBe('2026-11-16');
    expect(days[6]!.date).toBe('2026-11-22');
    expect(days.every((d) => d.targetTasks >= 3 && d.targetTasks <= MAX_TASKS_PER_DAY)).toBe(true);
    expect(days[0]!.difficulty).toBe(1);
  });

  it('a month: 30 days, up to 3 numbers in turn, a rest day each week, a check at the end', () => {
    const days = buildPlan({
      kind: 'month',
      focus: [
        focus(),
        focus({ skillKey: 'math.vectors', examNumber: 2 }),
        focus({ skillKey: 'math.planimetry', examNumber: 1 }),
      ],
      startDate: '2026-11-16',
    });
    expect(days).toHaveLength(30);
    expect(days.filter((d) => d.activity === 'rest')).toHaveLength(4);
    expect(new Set(days.map((d) => d.skillKey).filter(Boolean)).size).toBe(3);
    expect(days[29]!.activity).toBe('progress_check');
  });

  it('never asks for more than the skill has; nothing without tasks', () => {
    expect(dailyTasksFor(focus({ availableTasks: 6 }), 'week')).toBe(3);
    expect(
      buildPlan({ kind: 'week', focus: [focus({ availableTasks: 0 })], startDate: '2026-11-16' }),
    ).toEqual([]);
  });

  it('progress counts real answered tasks; skipped and missed days are not done', () => {
    const days = state(buildPlan({ kind: 'week', focus: [focus()], startDate: '2026-11-16' }));
    days[1] = { ...days[1]!, skipped: true };
    const actuals = new Map([
      [0, { attempts: days[0]!.targetTasks, correct: 2 }],
      [2, { attempts: 1, correct: 1 }],
    ]);
    const p = planProgress(days, actuals, '2026-11-19');
    expect(p.daysDone).toBe(1);
    expect(p.daysSkipped).toBe(1);
    expect(p.percent).toBe(Math.round(100 / 7));
    expect(p.tasksDone).toBe(days[0]!.targetTasks + 1);
    expect(dayStatus(days[2]!, { attempts: 1, correct: 1 }, '2026-11-19')).toBe('partial');
    expect(dayStatus(days[3]!, { attempts: 0, correct: 0 }, '2026-11-19')).toBe('pending');
    expect(dayStatus(days[2]!, { attempts: 0, correct: 0 }, '2026-11-19')).toBe('missed');
  });

  it('moving a day shifts it and the rest; past days and too many moves are refused', () => {
    const days = state(buildPlan({ kind: 'week', focus: [focus()], startDate: '2026-11-16' }));
    const moved = moveDay(days, 2, '2026-11-17', 0, 'week')!;
    expect(moved[2]!.date).toBe('2026-11-19');
    expect(moved[6]!.date).toBe('2026-11-23');
    expect(moved[1]!.date).toBe('2026-11-17');
    expect(moveDay(days, 0, '2026-11-17', 0, 'week')).toBeNull();
    expect(moveDay(days, 3, '2026-11-17', 3, 'week')).toBeNull();
  });

  it('recalculates the rest after a finished day: harder after 80 %+, easier after <50 %', () => {
    const days = state(
      buildPlan({ kind: 'week', focus: [focus({ mastery: 60 })], startDate: '2026-11-16' }),
    );
    const good = recalculatePlan(
      days,
      new Map([[0, { attempts: days[0]!.targetTasks, correct: days[0]!.targetTasks }]]),
      '2026-11-16',
    );
    expect(good[1]!.difficulty).toBe(Math.min(3, days[1]!.difficulty + 1));
    const bad = recalculatePlan(
      days,
      new Map([[0, { attempts: days[0]!.targetTasks, correct: 0 }]]),
      '2026-11-16',
    );
    expect(bad[1]!.difficulty).toBe(Math.max(1, days[1]!.difficulty - 1));
    expect(bad[5]).toEqual(days[5]); // the control day is not softened
  });
});

describe('progress by number', () => {
  it('one correct answer is never 100 % mastery', () => {
    const m = calculateSkillMastery([{ isCorrect: true, createdAt: new Date(T0) }]);
    expect(m.mastery).toBeLessThan(100);
    expect(displayMastery(skillLevel(m), m.mastery)).toBeNull();
    const many = calculateSkillMastery(
      Array.from({ length: 6 }, (_, i) => ({ isCorrect: true, createdAt: new Date(T0 + i * DAY) })),
    );
    expect(displayMastery(skillLevel(many), many.mastery)).toBe(many.mastery);
  });

  it('chart and 7/30-day dynamics from the attempts', () => {
    const attempts = [
      { date: '2026-11-01', isCorrect: false },
      { date: '2026-11-02', isCorrect: false },
      { date: '2026-11-03', isCorrect: true },
      { date: '2026-11-12', isCorrect: true },
      { date: '2026-11-13', isCorrect: true },
      { date: '2026-11-14', isCorrect: true },
      { date: '2026-11-15', isCorrect: false },
    ];
    const s = accuracySeries(attempts, '2026-11-15', 30);
    expect(s).toHaveLength(30);
    expect(s.at(-1)).toMatchObject({ date: '2026-11-15', attempts: 1, correct: 0, rolling7: 75 });
    const d = dynamicsOf(attempts, '2026-11-15');
    expect(d.last7).toEqual({ attempts: 4, accuracy: 75 });
    expect(d.prev7).toEqual({ attempts: 2, accuracy: 50 }); // 02–08 Nov
    expect(d.delta7).toBeNull();
  });
});
