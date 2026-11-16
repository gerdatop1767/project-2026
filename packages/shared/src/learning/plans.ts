import type { ProblemType } from './diagnosis.js';

/**
 * Personal 7- and 30-day plans (docs/learning/PERSONAL-PLANS.md § Планы).
 * Pure: the API stores what these functions return and feeds them the
 * student's real attempts; nothing here reads the database.
 *
 * A day asks for a number of tasks of ONE skill at a difficulty. A day is
 * done only when that many tasks of the skill were actually answered on
 * that date (not when a page was opened); theory steps are listed, but the
 * percentage counts only answered tasks. Skipped and missed days are never
 * counted as done.
 */
export type PlanKind = 'week' | 'month';

export const PLAN_LENGTH: Readonly<Record<PlanKind, number>> = { week: 7, month: 30 };
/** At most this many tasks a day — the plan must not overload the student. */
export const MAX_TASKS_PER_DAY = 8;
export const MIN_TASKS_PER_DAY = 3;
/** Moves allowed per plan: a plan cannot be postponed forever. */
export const MAX_MOVES: Readonly<Record<PlanKind, number>> = { week: 3, month: 8 };

export type PlanActivity =
  | 'theory_basic'
  | 'practice'
  | 'mistakes_review'
  | 'algorithm_review'
  | 'no_hints'
  | 'control'
  | 'progress_check'
  | 'rest';

export interface PlanFocus {
  readonly skillKey: string;
  readonly subjectId: string;
  readonly title: string;
  readonly examNumber: number | null;
  readonly problem: ProblemType;
  /** Mastery when the plan starts (0..100). */
  readonly mastery: number;
  /** Accuracy of the last 30 days when the plan starts, null without attempts. */
  readonly accuracy: number | null;
  readonly attempts: number;
  /** Published auto-checked tasks of the skill — the plan never asks for more than exist. */
  readonly availableTasks: number;
}

export interface PlanDayDraft {
  readonly dayIndex: number;
  /** Local calendar date YYYY-MM-DD. */
  readonly date: string;
  readonly skillKey: string | null;
  readonly activity: PlanActivity;
  readonly targetTasks: number;
  /** Authored difficulty 1..3 the training of the day aims at. */
  readonly difficulty: 1 | 2 | 3;
}

export const ACTIVITY_TITLES: Readonly<Record<PlanActivity, string>> = {
  theory_basic: 'Теория и базовые задания',
  practice: 'Тренировка',
  mistakes_review: 'Разбор ошибок и новые задания',
  algorithm_review: 'Повторение алгоритма',
  no_hints: 'Тренировка без подсказок',
  control: 'Контрольная подборка',
  progress_check: 'Проверка прогресса',
  rest: 'День отдыха',
};

export const ACTIVITY_STEPS: Readonly<Record<PlanActivity, readonly string[]>> = {
  theory_basic: ['Прочитай теорию номера в учебном центре.', 'Реши базовые задания.'],
  practice: ['Реши задания среднего уровня.'],
  mistakes_review: [
    'Открой «Мои ошибки» по этому номеру и разбери их.',
    'Реши новые задания этого номера.',
  ],
  algorithm_review: ['Повтори алгоритм решения из теории номера.', 'Реши новые задания.'],
  no_hints: ['Реши задания, не открывая подсказки и разбор до ответа.'],
  control: ['Контрольная подборка: реши задания без подсказок.'],
  progress_check: [
    'Реши проверочную подборку.',
    'Сравни результат с тем, что было до начала плана.',
  ],
  rest: ['Отдых. Можно повторить теорию, если хочется.'],
};

/** The 7-day template; counts are scaled by `dailyTasks`. */
const WEEK_TEMPLATE: readonly { activity: PlanActivity; share: number; difficulty: 1 | 2 | 3 }[] = [
  { activity: 'theory_basic', share: 0.6, difficulty: 1 },
  { activity: 'practice', share: 1, difficulty: 2 },
  { activity: 'mistakes_review', share: 0.6, difficulty: 2 },
  { activity: 'algorithm_review', share: 1, difficulty: 2 },
  { activity: 'no_hints', share: 1, difficulty: 2 },
  { activity: 'control', share: 1, difficulty: 3 },
  { activity: 'progress_check', share: 1, difficulty: 2 },
];

function clampTasks(n: number): number {
  return Math.max(MIN_TASKS_PER_DAY, Math.min(MAX_TASKS_PER_DAY, Math.round(n)));
}

/** Tasks a full day asks for: fewer for a weak skill, never past what exists. */
export function dailyTasksFor(focus: PlanFocus, kind: PlanKind): number {
  const base = focus.mastery < 40 ? 4 : focus.mastery < 70 ? 5 : 6;
  // A week asks at most ~80 % of the skill's tasks over the whole plan, so
  // the same tasks are not served again and again.
  const perDayCap = Math.floor((focus.availableTasks * 0.8) / (kind === 'week' ? 6 : 12));
  return clampTasks(Math.min(base, Math.max(MIN_TASKS_PER_DAY, perDayCap)));
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function startDifficulty(f: PlanFocus): 1 | 2 | 3 {
  if (f.problem === 'hard_tasks') return 2;
  return f.mastery < 40 ? 1 : 2;
}

/**
 * Builds the days. Week: one focus number (the most urgent). Month: up to
 * three numbers in turn, one rest day a week, a control week at the end.
 */
export function buildPlan(input: {
  readonly kind: PlanKind;
  readonly focus: readonly PlanFocus[];
  readonly startDate: string;
}): PlanDayDraft[] {
  const usable = input.focus.filter((f) => f.availableTasks > 0);
  if (usable.length === 0) return [];
  if (input.kind === 'week') {
    const f = usable[0]!;
    const daily = dailyTasksFor(f, 'week');
    const start = startDifficulty(f);
    return WEEK_TEMPLATE.map((t, i) => ({
      dayIndex: i,
      date: addDays(input.startDate, i),
      skillKey: f.skillKey,
      activity: t.activity,
      targetTasks: clampTasks(daily * t.share),
      difficulty: (t.activity === 'control'
        ? Math.max(start, 2)
        : Math.max(start, Math.min(t.difficulty, start + 1))) as 1 | 2 | 3,
    }));
  }
  const focus = usable.slice(0, 3);
  const days: PlanDayDraft[] = [];
  for (let i = 0; i < PLAN_LENGTH.month; i++) {
    const week = Math.floor(i / 7);
    const inWeek = i % 7;
    const date = addDays(input.startDate, i);
    if (inWeek === 6 && i < 28) {
      days.push({
        dayIndex: i,
        date,
        skillKey: null,
        activity: 'rest',
        targetTasks: 0,
        difficulty: 1,
      });
      continue;
    }
    if (i >= 28) {
      // Last two days: progress check of every focus number in turn.
      const f = focus[(i - 28) % focus.length]!;
      days.push({
        dayIndex: i,
        date,
        skillKey: f.skillKey,
        activity: i === 29 ? 'progress_check' : 'control',
        targetTasks: clampTasks(dailyTasksFor(f, 'month')),
        difficulty: 2,
      });
      continue;
    }
    const f = focus[(week * 6 + inWeek) % focus.length]!;
    const start = startDifficulty(f);
    const activity: PlanActivity =
      week === 0 && inWeek < focus.length
        ? 'theory_basic'
        : inWeek === 5
          ? 'mistakes_review'
          : week === 3
            ? 'no_hints'
            : 'practice';
    const difficulty = Math.min(3, start + (week >= 2 ? 1 : 0)) as 1 | 2 | 3;
    days.push({
      dayIndex: i,
      date,
      skillKey: f.skillKey,
      activity,
      targetTasks: clampTasks(dailyTasksFor(f, 'month') * (activity === 'theory_basic' ? 0.6 : 1)),
      difficulty: activity === 'theory_basic' ? 1 : difficulty,
    });
  }
  return days;
}

// ------------------------------------------------------------- progress

export type PlanDayStatus = 'done' | 'partial' | 'pending' | 'missed' | 'skipped' | 'rest';

export interface PlanDayState extends PlanDayDraft {
  /** Stored user choice: skipped. Moving shifts the dates instead. */
  readonly skipped: boolean;
}

export interface DayActual {
  readonly attempts: number;
  readonly correct: number;
}

export function dayStatus(day: PlanDayState, actual: DayActual, today: string): PlanDayStatus {
  if (day.activity === 'rest') return 'rest';
  if (day.skipped) return 'skipped';
  if (actual.attempts >= day.targetTasks) return 'done';
  if (day.date < today) return actual.attempts > 0 ? 'partial' : 'missed';
  return actual.attempts > 0 ? 'partial' : 'pending';
}

export interface PlanProgress {
  /** Done days / all non-rest days, 0..100. */
  readonly percent: number;
  readonly daysDone: number;
  readonly daysTotal: number;
  readonly daysSkipped: number;
  readonly daysMissed: number;
  /** Answered tasks counted towards targets (never over a day's target). */
  readonly tasksDone: number;
  readonly tasksTotal: number;
  readonly tasksLeft: number;
  /** All days are past or done. */
  readonly finished: boolean;
}

export function planProgress(
  days: readonly PlanDayState[],
  actuals: ReadonlyMap<number, DayActual>,
  today: string,
): PlanProgress {
  const work = days.filter((d) => d.activity !== 'rest');
  let daysDone = 0;
  let daysSkipped = 0;
  let daysMissed = 0;
  let tasksDone = 0;
  let tasksTotal = 0;
  for (const d of work) {
    const a = actuals.get(d.dayIndex) ?? { attempts: 0, correct: 0 };
    const status = dayStatus(d, a, today);
    if (status === 'done') daysDone++;
    if (status === 'skipped') daysSkipped++;
    if (status === 'missed') daysMissed++;
    tasksTotal += d.targetTasks;
    if (!d.skipped) tasksDone += Math.min(a.attempts, d.targetTasks);
  }
  const last = days[days.length - 1];
  return {
    percent: work.length ? Math.round((daysDone / work.length) * 100) : 0,
    daysDone,
    daysTotal: work.length,
    daysSkipped,
    daysMissed,
    tasksDone,
    tasksTotal,
    tasksLeft: tasksTotal - tasksDone,
    finished: last
      ? last.date < today ||
        work.every((d) => d.skipped || (actuals.get(d.dayIndex)?.attempts ?? 0) >= d.targetTasks)
      : true,
  };
}

/**
 * «Перенести»: the day and every later day move one day later. Returns null
 * when the day cannot move (already past, done, rest, or out of moves).
 */
export function moveDay(
  days: readonly PlanDayState[],
  dayIndex: number,
  today: string,
  movesUsed: number,
  kind: PlanKind,
): PlanDayState[] | null {
  const day = days.find((d) => d.dayIndex === dayIndex);
  if (!day || day.activity === 'rest' || day.skipped || day.date < today) return null;
  if (movesUsed >= MAX_MOVES[kind]) return null;
  return days.map((d) => (d.dayIndex >= dayIndex ? { ...d, date: addDays(d.date, 1) } : d));
}

/**
 * After a day is finished, the rest of the plan follows the result: a day
 * at 80 %+ makes the next days of that skill a level harder, a day below
 * 50 % keeps them a level easier with fewer tasks. Only future, untouched
 * days change; targets stay within the daily limits.
 */
export function recalculatePlan(
  days: readonly PlanDayState[],
  actuals: ReadonlyMap<number, DayActual>,
  today: string,
): PlanDayState[] {
  const lastFinished = [...days]
    .filter((d) => d.activity !== 'rest' && !d.skipped && d.skillKey)
    .filter((d) => (actuals.get(d.dayIndex)?.attempts ?? 0) >= d.targetTasks)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!lastFinished) return [...days];
  const a = actuals.get(lastFinished.dayIndex)!;
  const acc = a.attempts ? a.correct / a.attempts : 0;
  const shift = acc >= 0.8 ? 1 : acc < 0.5 ? -1 : 0;
  if (shift === 0) return [...days];
  return days.map((d) => {
    if (d.date <= today || d.skillKey !== lastFinished.skillKey || d.activity === 'rest') return d;
    if (d.skipped || (actuals.get(d.dayIndex)?.attempts ?? 0) > 0) return d;
    if (d.activity === 'control' || d.activity === 'progress_check') return d;
    return {
      ...d,
      difficulty: Math.max(1, Math.min(3, d.difficulty + shift)) as 1 | 2 | 3,
      targetTasks: clampTasks(d.targetTasks + (shift < 0 ? -1 : 0)),
    };
  });
}

export interface PlanBaseline {
  readonly skillKey: string;
  readonly mastery: number;
  readonly accuracy: number | null;
  readonly attempts: number;
}

/** Before/after for one number: honest about too little new data. */
export function compareWithBaseline(
  baseline: PlanBaseline,
  now: { mastery: number; accuracyInPlan: number | null; attemptsInPlan: number },
): { masteryDelta: number; accuracyDelta: number | null; enoughData: boolean } {
  return {
    masteryDelta: now.mastery - baseline.mastery,
    accuracyDelta:
      baseline.accuracy !== null && now.accuracyInPlan !== null
        ? now.accuracyInPlan - baseline.accuracy
        : null,
    enoughData: now.attemptsInPlan >= 5,
  };
}
