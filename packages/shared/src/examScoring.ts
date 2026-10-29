/**
 * Primary scores of a full exam variant, and their conversion to the
 * 0–100 test score (docs/SCORING.md). Pure data and functions — no I/O.
 *
 * Three separate things, never mixed:
 * 1. **Rules** (`EXAM_SCORING_RULES`): per exam format and task number,
 *    the maximum primary score and how this app can award it. Versioned:
 *    a variant attempt copies the rules it starts with
 *    (`buildScoringSnapshot`), so a later correction never rewrites an
 *    attempt already taken.
 * 2. **Scales** (`EXAM_SCALES`): primary → test score tables, each with
 *    its year, source, date and status. Kept apart from the rules: a
 *    scale can be added or replaced (approximate → official) without
 *    touching scoring. None is registered while no table can be
 *    confirmed — then the result says so instead of inventing one.
 * 3. **Scoring** (`scoreVariantAttempt`): first answers of an attempt +
 *    its snapshot → points per task and totals.
 *
 * What the app can and cannot check: Part 1 answers are checked
 * exactly. Part 2 is graded by experts on the written solution; here
 * only the final answer is checked, so Part 2 points are an estimate
 * «по ответу» — awarded the way the official criteria grade a correct
 * answer whose justification cannot be seen (e.g. a correct б) without
 * the proof of а = 2 of 3), and always labelled as such.
 */

export type ExamFormatId = 'ege-math-profile-2026' | 'ege-math-profile-2027';

/**
 * How one task's points are awarded:
 * - `exact`: Part 1 — `max` points when the answer is right, else 0.
 * - `answer`: Part 2 graded by its checked final answer only —
 *   `pointsIfCorrect` (≤ `max`) when right, else 0. An estimate.
 * - `abc`: a/б/в multi-part task (number theory): each correct part
 *   earns its weight (`partPoints`, by part id), as the official
 *   criteria count «results»; the sum never exceeds `max`. An estimate.
 */
export type TaskScoringKind = 'exact' | 'answer' | 'abc';

export interface TaskScoringRule {
  readonly max: number;
  readonly kind: TaskScoringKind;
  /** `answer`: points for a correct final answer. */
  readonly pointsIfCorrect?: number;
  /** `abc`: points per correct part, by multi-part id ('a', 'b', 'c'). */
  readonly partPoints?: Readonly<Record<string, number>>;
  /** Shown next to an estimated score. */
  readonly note?: string;
}

export type RulesStatus = 'official' | 'project';

export interface ExamScoringRules {
  /** Versioned id — never reused for different content. */
  readonly id: string;
  readonly format: ExamFormatId;
  readonly subjectId: string;
  readonly examYear: number;
  readonly title: string;
  /** `official`: a published FIPI specification; `project`: a draft
   * (проект КИМ) that may still change. */
  readonly status: RulesStatus;
  readonly source: string;
  /** ISO date the rules were last checked against the source. */
  readonly checkedAt: string;
  /** Tasks 1..partOneLast have a short answer (Part 1). */
  readonly partOneLast: number;
  readonly tasks: Readonly<Record<number, TaskScoringRule>>;
}

const PROOF_NOTE =
  'Проверен только ответ пункта б): доказательство пункта а) не проверяется, поэтому за верный ответ — не больше 2 баллов из 3 (наше правило по образцу критериев ЕГЭ 2026).';
const ANSWER_NOTE = 'Оценка по ответу: решение не проверяется, эксперт может поставить меньше.';
const ABC_NOTE =
  'По ответам пунктов: а) — 1 балл, б) — 1 балл, в) — 2 балла. Это наше упрощение: официальные критерии оценивают обоснование, и эксперт может поставить меньше.';

function partOne(count: number): Record<number, TaskScoringRule> {
  const out: Record<number, TaskScoringRule> = {};
  for (let n = 1; n <= count; n++) out[n] = { max: 1, kind: 'exact' };
  return out;
}

export const EXAM_SCORING_RULES: readonly ExamScoringRules[] = [
  {
    id: 'ege-math-profile-2026@v1',
    format: 'ege-math-profile-2026',
    subjectId: 'math',
    examYear: 2026,
    title: 'ЕГЭ 2026, математика профильного уровня',
    status: 'official',
    source:
      'Спецификация КИМ ЕГЭ 2026 по математике профильного уровня (ФИПИ): 19 заданий, максимум 32 первичных балла — задания 1–12 по 1 баллу, 13 — 2, 14 — 3, 15 — 2, 16 — 2, 17 — 3, 18 — 4, 19 — 4.',
    checkedAt: '2026-10-29',
    partOneLast: 12,
    tasks: {
      ...partOne(12),
      13: { max: 2, kind: 'answer', pointsIfCorrect: 2, note: ANSWER_NOTE },
      14: { max: 3, kind: 'answer', pointsIfCorrect: 2, note: PROOF_NOTE },
      15: { max: 2, kind: 'answer', pointsIfCorrect: 2, note: ANSWER_NOTE },
      16: { max: 2, kind: 'answer', pointsIfCorrect: 2, note: ANSWER_NOTE },
      17: { max: 3, kind: 'answer', pointsIfCorrect: 2, note: PROOF_NOTE },
      18: { max: 4, kind: 'answer', pointsIfCorrect: 4, note: ANSWER_NOTE },
      19: { max: 4, kind: 'abc', partPoints: { a: 1, b: 1, c: 2 }, note: ABC_NOTE },
    },
  },
  {
    id: 'ege-math-profile-2027@project-2026-08',
    format: 'ege-math-profile-2027',
    subjectId: 'math',
    examYear: 2027,
    title: 'ЕГЭ 2027, математика профильного уровня (проект)',
    status: 'project',
    source:
      'Проект КИМ ЕГЭ 2027 по математике профильного уровня (ФИПИ, август 2026), по данным двух независимых обзоров проекта (ctege.info, postupashkin.ru): 20 заданий, максимум 33 первичных балла — задания 1–13 по 1 баллу, 14 — 2, 15 — 3, 16 — 2, 17 — 2, 18 — 3, 19 — 4, 20 — 4. Документ ФИПИ из среды разработки недоступен — сверить при публикации окончательной версии.',
    checkedAt: '2026-10-29',
    partOneLast: 13,
    tasks: {
      ...partOne(13),
      14: { max: 2, kind: 'answer', pointsIfCorrect: 2, note: ANSWER_NOTE },
      15: { max: 3, kind: 'answer', pointsIfCorrect: 2, note: PROOF_NOTE },
      16: { max: 2, kind: 'answer', pointsIfCorrect: 2, note: ANSWER_NOTE },
      17: { max: 2, kind: 'answer', pointsIfCorrect: 2, note: ANSWER_NOTE },
      18: { max: 3, kind: 'answer', pointsIfCorrect: 2, note: PROOF_NOTE },
      19: { max: 4, kind: 'answer', pointsIfCorrect: 4, note: ANSWER_NOTE },
      20: { max: 4, kind: 'abc', partPoints: { a: 1, b: 1, c: 2 }, note: ABC_NOTE },
    },
  },
];

/** The rules a new attempt of this format uses (the latest version). */
export function currentScoringRules(format: string | null): ExamScoringRules | null {
  if (!format) return null;
  const all = EXAM_SCORING_RULES.filter((r) => r.format === format);
  return all.length > 0 ? all[all.length - 1]! : null;
}

export function maxPrimaryTotal(rules: ExamScoringRules): number {
  return Object.values(rules.tasks).reduce((sum, t) => sum + t.max, 0);
}

// ------------------------------------------------------------------ scales

export type ScaleStatus = 'official' | 'approximate';

export interface ExamScale {
  readonly id: string;
  readonly format: ExamFormatId;
  readonly examYear: number;
  readonly status: ScaleStatus;
  readonly source: string;
  readonly updatedAt: string;
  /** `testByPrimary[p]` = test score for `p` primary points, p = 0..max. */
  readonly testByPrimary: readonly number[];
}

/**
 * Registered conversion scales. Deliberately empty: as of 2026-10-29
 * there is no confirmed table for either format — ЕГЭ-2027 has not been
 * held (its scale is set after the exam, for a 33-point maximum), and the
 * ЕГЭ-2026 tables found in public sources disagree from 9 primary points
 * up, with the official Rosobrnadzor document unavailable here. A scale
 * is added here (with its source and status) only once it can be
 * confirmed; old attempts keep the scale id they were taken with.
 */
export const EXAM_SCALES: readonly ExamScale[] = [];

export function currentScale(
  format: string | null,
  scales: readonly ExamScale[] = EXAM_SCALES,
): ExamScale | null {
  if (!format) return null;
  const all = scales.filter((s) => s.format === format);
  return all.length > 0 ? all[all.length - 1]! : null;
}

export type ScaleConversion =
  | {
      readonly available: true;
      readonly testScore: number;
      readonly scaleId: string;
      readonly status: ScaleStatus;
      readonly source: string;
      readonly updatedAt: string;
    }
  | { readonly available: false; readonly reason: string };

/**
 * The test score for `primary` points by the scale `scaleId` — or why
 * there is none. An approximate scale is returned as such: the screen
 * must show «Оценка приблизительная, официальная шкала может отличаться».
 */
export function convertPrimaryToTest(
  primary: number,
  scaleId: string | null,
  format: string | null,
  scales: readonly ExamScale[] = EXAM_SCALES,
): ScaleConversion {
  const scale = scaleId ? scales.find((s) => s.id === scaleId) : null;
  if (!scale) {
    return {
      available: false,
      reason:
        format === 'ege-math-profile-2027'
          ? 'Официальная шкала перевода ЕГЭ-2027 ещё не опубликована — её утверждают после экзамена. Показаны только первичные баллы.'
          : 'Подтверждённой шкалы перевода в тестовые баллы для этого экзамена пока нет. Показаны только первичные баллы.',
    };
  }
  const p = Math.max(0, Math.min(Math.round(primary), scale.testByPrimary.length - 1));
  return {
    available: true,
    testScore: scale.testByPrimary[p]!,
    scaleId: scale.id,
    status: scale.status,
    source: scale.source,
    updatedAt: scale.updatedAt,
  };
}

// --------------------------------------------------------------- snapshot

export interface SnapshotTask {
  readonly taskId: string;
  readonly taskNumber: number;
  readonly rule: TaskScoringRule;
}

/** Copied into a variant attempt when it starts. JSON. */
export interface VariantScoringSnapshot {
  readonly version: 1;
  readonly rulesId: string;
  readonly format: ExamFormatId;
  readonly rulesStatus: RulesStatus;
  /** The exam's full maximum (e.g. 33), whatever this variant offers. */
  readonly examMaxTotal: number;
  readonly partOneLast: number;
  /** Scale in force when the attempt started; null = none confirmed. */
  readonly scaleId: string | null;
  readonly tasks: readonly SnapshotTask[];
  /** Exam task numbers this variant does not offer (e.g. a task still
   * under review) — they cannot earn points in this attempt. */
  readonly unavailableTaskNumbers: readonly number[];
}

export function buildScoringSnapshot(
  format: string | null,
  planned: readonly { taskId: string; taskNumber: number }[],
): VariantScoringSnapshot | null {
  const rules = currentScoringRules(format);
  if (!rules) return null;
  const tasks: SnapshotTask[] = [];
  for (const p of planned) {
    const rule = rules.tasks[p.taskNumber];
    if (rule) tasks.push({ taskId: p.taskId, taskNumber: p.taskNumber, rule });
  }
  const offered = new Set(tasks.map((t) => t.taskNumber));
  return {
    version: 1,
    rulesId: rules.id,
    format: rules.format,
    rulesStatus: rules.status,
    examMaxTotal: maxPrimaryTotal(rules),
    partOneLast: rules.partOneLast,
    scaleId: currentScale(rules.format)?.id ?? null,
    tasks,
    unavailableTaskNumbers: Object.keys(rules.tasks)
      .map(Number)
      .filter((n) => !offered.has(n))
      .sort((a, b) => a - b),
  };
}

// ---------------------------------------------------------------- scoring

/** The attempt's FIRST answer to a task — the one that counts. */
export interface FirstAnswer {
  readonly correct: boolean;
  /** For an `abc` task: which parts were right (by part id). */
  readonly correctParts?: Readonly<Record<string, boolean>>;
}

export type TaskScoreStatus = 'full' | 'partial' | 'zero' | 'unanswered';

export interface TaskScore {
  readonly taskId: string;
  readonly taskNumber: number;
  readonly max: number;
  readonly awarded: number;
  readonly status: TaskScoreStatus;
  /** Part 2: awarded by the checked answer only. */
  readonly estimated: boolean;
  readonly note: string | null;
}

export interface VariantScore {
  readonly rulesId: string;
  readonly rulesStatus: RulesStatus;
  readonly format: ExamFormatId;
  readonly primary: number;
  /** Sum of the maxima of the tasks this variant offers. */
  readonly maxAvailable: number;
  readonly examMaxTotal: number;
  readonly partOne: { readonly awarded: number; readonly max: number };
  readonly partTwo: { readonly awarded: number; readonly max: number };
  readonly unavailableTaskNumbers: readonly number[];
  readonly tasks: readonly TaskScore[];
  readonly conversion: ScaleConversion;
}

export function scoreTask(rule: TaskScoringRule, answer: FirstAnswer | undefined): number {
  if (!answer) return 0;
  switch (rule.kind) {
    case 'exact':
      return answer.correct ? rule.max : 0;
    case 'answer':
      return answer.correct ? Math.min(rule.max, rule.pointsIfCorrect ?? rule.max) : 0;
    case 'abc': {
      const parts = answer.correctParts ?? {};
      const sum = Object.entries(rule.partPoints ?? {}).reduce(
        (acc, [id, pts]) => acc + (parts[id] ? pts : 0),
        0,
      );
      return Math.min(rule.max, sum);
    }
  }
}

/**
 * Scores one attempt from its snapshot and first answers (by task id).
 * An unanswered task scores 0 and is reported as such; nothing is
 * double counted (one first answer per task).
 */
export function scoreVariantAttempt(
  snapshot: VariantScoringSnapshot,
  firstAnswers: ReadonlyMap<string, FirstAnswer>,
  scales: readonly ExamScale[] = EXAM_SCALES,
): VariantScore {
  const tasks: TaskScore[] = snapshot.tasks.map(({ taskId, taskNumber, rule }) => {
    const answer = firstAnswers.get(taskId);
    const awarded = scoreTask(rule, answer);
    return {
      taskId,
      taskNumber,
      max: rule.max,
      awarded,
      status: !answer
        ? 'unanswered'
        : awarded === rule.max
          ? 'full'
          : awarded > 0
            ? 'partial'
            : 'zero',
      estimated: rule.kind !== 'exact',
      note: rule.note ?? null,
    };
  });
  const sum = (list: readonly TaskScore[], key: 'awarded' | 'max') =>
    list.reduce((acc, t) => acc + t[key], 0);
  const one = tasks.filter((t) => t.taskNumber <= snapshot.partOneLast);
  const two = tasks.filter((t) => t.taskNumber > snapshot.partOneLast);
  const primary = sum(tasks, 'awarded');
  return {
    rulesId: snapshot.rulesId,
    rulesStatus: snapshot.rulesStatus,
    format: snapshot.format,
    primary,
    maxAvailable: sum(tasks, 'max'),
    examMaxTotal: snapshot.examMaxTotal,
    partOne: { awarded: sum(one, 'awarded'), max: sum(one, 'max') },
    partTwo: { awarded: sum(two, 'awarded'), max: sum(two, 'max') },
    unavailableTaskNumbers: snapshot.unavailableTaskNumbers,
    tasks,
    conversion: convertPrimaryToTest(primary, snapshot.scaleId, snapshot.format, scales),
  };
}
