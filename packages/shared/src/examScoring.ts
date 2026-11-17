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
 *    touching scoring. Only official Rosobrnadzor tables are registered
 *    (ЕГЭ-2026: Russian 0–50, profile math 0–32); a result whose exam has
 *    no fitting table says so instead of inventing one.
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

export type ExamFormatId =
  'ege-math-profile-2026' | 'ege-math-profile-2027' | 'ege-russian-2026' | 'ege-russian-2027';

/**
 * How one task's points are awarded:
 * - `exact`: Part 1 — `max` points when the answer is right, else 0.
 * - `answer`: Part 2 graded by its checked final answer only —
 *   `pointsIfCorrect` (≤ `max`) when right, else 0. An estimate.
 * - `abc`: a/б/в multi-part task (number theory): each correct part
 *   earns its weight (`partPoints`, by part id), as the official
 *   criteria count «results»; the sum never exceeds `max`. An estimate.
 * - `positions`: an answer of several positions (Russian №8, №22) — the
 *   FIPI rule: `max` when every position is right, `max − 1` when one or
 *   two positions are wrong, else 0. Exact, not an estimate.
 * - `expert`: graded only by experts (the essay, Russian №27) — the app
 *   never awards points for it; shown as «не оценивается».
 */
export type TaskScoringKind = 'exact' | 'answer' | 'abc' | 'positions' | 'expert';

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

const POSITIONS_NOTE =
  'По правилу ФИПИ: все позиции верны — 2 балла, ошибка в одной или двух позициях — 1 балл, иначе 0.';
const ESSAY_NOTE =
  'Сочинение проверяют эксперты по критериям К1–К10 (до 22 баллов). Приложение его не оценивает: эти баллы не входят в посчитанный результат.';

const RUSSIAN_SPEC_2026 =
  'Спецификация КИМ ЕГЭ 2026 по русскому языку (ФИПИ, архив ru_11_2026.zip, sha256 8d4d4d19…2c716f), раздел 9: 27 заданий, максимум 50 первичных баллов — задания 1–7, 9–21, 23–26 по 1 баллу, 8 и 22 — по 2 балла (1 балл при ошибке в одной-двух позициях), 27 (сочинение) — 22 балла.';
const RUSSIAN_SPEC_2027 =
  'Спецификация КИМ ЕГЭ 2027 по русскому языку (ФИПИ, архив ru_11_2027.zip от 13.11.2026, sha256 6070bfd7…3e2e68), раздел 9: 27 заданий, максимум 50 первичных баллов — задания 1–7, 9–21, 23–26 по 1 баллу, 8 и 22 — по 2 балла (1 балл при ошибке в одной-двух позициях), 27 (сочинение) — 22 балла. Совпадает с 2026 годом.';

/** ЕГЭ по русскому языку (the 2026 and 2027 specifications are identical here). */
function russianRules(
  examYear: 2026 | 2027,
  format: ExamFormatId,
  source: string,
): ExamScoringRules {
  const tasks: Record<number, TaskScoringRule> = partOne(26);
  tasks[8] = { max: 2, kind: 'positions', note: POSITIONS_NOTE };
  tasks[22] = { max: 2, kind: 'positions', note: POSITIONS_NOTE };
  tasks[27] = { max: 22, kind: 'expert', note: ESSAY_NOTE };
  return {
    id: `${format}@v1`,
    format,
    subjectId: 'russian',
    examYear,
    title: `ЕГЭ ${examYear}, русский язык`,
    status: 'official',
    source,
    checkedAt: '2026-11-17',
    partOneLast: 26,
    tasks,
  };
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
    title: 'Проект КИМ ЕГЭ 2027, математика профильного уровня (старая редакция)',
    status: 'project',
    source:
      'Проект КИМ ЕГЭ 2027 по математике профильного уровня (ФИПИ, август 2026), по двум независимым обзорам проекта (ctege.info, 4ege.ru): 20 заданий, максимум 33 первичных балла — задания 1–13 по 1 баллу, 14 — 2, 15 — 3, 16 — 2, 17 — 2, 18 — 3, 19 — 4, 20 — 4. Проект не принят: в окончательной спецификации ЕГЭ-2027 (ФИПИ, 13.11.2026) 19 заданий и 32 балла, как в 2026. Эти правила считают только сборник Ященко-2027 (старая редакция), составленный по проекту.',
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
  russianRules(2026, 'ege-russian-2026', RUSSIAN_SPEC_2026),
  russianRules(2027, 'ege-russian-2027', RUSSIAN_SPEC_2027),
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
  /** Subject id (as tasks use). */
  readonly subjectId: string;
  /** The exam format the table was published for. */
  readonly format: ExamFormatId;
  /** The exam year the table was approved for. */
  readonly examYear: number;
  readonly status: ScaleStatus;
  /** The document (Rosobrnadzor), with its date and number. */
  readonly source: string;
  readonly updatedAt: string;
  /** `testByPrimary[p]` = test score for `p` primary points, p = 0..max. */
  readonly testByPrimary: readonly number[];
}

/** The exam year students are preparing for (its table is approved only after that exam). */
export const TARGET_EXAM_YEAR = 2027;

/**
 * The Rosobrnadzor document all 2026 tables come from. A copy of the
 * values with the PDF's checksum: docs/sources/ege-2026-scales.json.
 */
export const ROSOBRNADZOR_2026_SCALES_SOURCE =
  'Решения комиссии Рособрнадзора по установлению соответствия между первичными и тестовыми баллами ЕГЭ в 2026 году от 30.03.2026 № 04-1/КИД, от 06.04.2026 № 04-2/КИД, от 10.04.2026 № 04-3/КИД, от 17.04.2026 № 04-6/КИД — таблица № 6';

/**
 * Registered conversion tables — ONLY official Rosobrnadzor tables,
 * copied value by value (a test checks them against
 * docs/sources/ege-2026-scales.json). Entries are never removed or
 * edited: attempts keep the id of the table they were converted by.
 *
 * ЕГЭ-2027 tables are approved only after the 2027 exam; until then a
 * 2027 result is converted by the 2026 table of the same subject and the
 * same primary maximum, labelled «ориентир по шкале ЕГЭ-2026». To switch,
 * add the 2027 entries here (examYear 2027): new attempts pick them up,
 * attempts already taken keep their table.
 */
export const EXAM_SCALES: readonly ExamScale[] = [
  {
    id: 'ege-russian-2026@rosobrnadzor-2026-04',
    subjectId: 'russian',
    format: 'ege-russian-2026',
    examYear: 2026,
    status: 'official',
    source: ROSOBRNADZOR_2026_SCALES_SOURCE,
    updatedAt: '2026-04-17',
    // prettier-ignore
    testByPrimary: [
      0, 3, 5, 8, 10, 12, 15, 17, 20, 22, // 0–9
      24, 27, 29, 32, 34, 36, 37, 39, 40, 42, // 10–19
      43, 45, 46, 48, 49, 51, 52, 54, 55, 57, // 20–29
      58, 60, 61, 63, 64, 66, 67, 69, 70, 72, // 30–39
      73, 75, 78, 81, 83, 86, 89, 91, 94, 97, // 40–49
      100, // 50
    ],
  },
  {
    id: 'ege-math-profile-2026@rosobrnadzor-2026-04',
    subjectId: 'math',
    format: 'ege-math-profile-2026',
    examYear: 2026,
    status: 'official',
    source: ROSOBRNADZOR_2026_SCALES_SOURCE,
    updatedAt: '2026-04-17',
    // prettier-ignore
    testByPrimary: [
      0, 6, 11, 17, 22, 27, 34, 40, 46, 52, // 0–9
      58, 64, 70, 72, 74, 76, 78, 80, 82, 84, // 10–19
      86, 88, 90, 92, 94, 95, 96, 97, 98, 99, // 20–29
      100, 100, 100, // 30–32
    ],
  },
];

/** The primary maximum a table covers (its last primary point). */
export function scaleMaxPrimary(scale: Pick<ExamScale, 'testByPrimary'>): number {
  return scale.testByPrimary.length - 1;
}

/**
 * Problems of a table (empty when it is usable): one value per primary
 * point from 0 to the exam's maximum, whole test points 0..100, never
 * decreasing, 0 → 0 and the maximum → 100, a source named.
 */
export function validateScale(scale: ExamScale, maxPrimary?: number): string[] {
  const t = scale.testByPrimary;
  const problems: string[] = [];
  if (maxPrimary !== undefined && t.length !== maxPrimary + 1) {
    problems.push(`ожидалось ${maxPrimary + 1} значений (0..${maxPrimary}), а их ${t.length}`);
  }
  if (t[0] !== 0) problems.push('0 первичных баллов должно давать 0 тестовых');
  if (t[t.length - 1] !== 100) problems.push('максимум первичных баллов должен давать 100');
  t.forEach((v, i) => {
    if (!Number.isInteger(v) || v < 0 || v > 100)
      problems.push(`значение ${v} для ${i} — не 0..100`);
    if (i > 0 && v < t[i - 1]!) problems.push(`шкала убывает между ${i - 1} и ${i}`);
  });
  if (!/\S/.test(scale.source)) problems.push('не указан источник');
  return problems;
}

export interface ScaleChoice {
  readonly scale: ExamScale;
  /** `same-format`: the table of this very format; `reference-year`: the
   * latest table of the same subject and the same primary maximum from an
   * earlier year — a guide, not the official conversion of this exam. */
  readonly basis: 'same-format' | 'reference-year';
}

/** The table a result of this exam format is converted by today, or null. */
export function scaleForFormat(
  format: string | null,
  scales: readonly ExamScale[] = EXAM_SCALES,
): ScaleChoice | null {
  if (!format) return null;
  const own = scales.filter((s) => s.format === format).sort((a, b) => a.examYear - b.examYear);
  if (own.length > 0) return { scale: own[own.length - 1]!, basis: 'same-format' };
  const rules = currentScoringRules(format);
  if (!rules) return null;
  const max = maxPrimaryTotal(rules);
  const earlier = scales
    .filter(
      (s) =>
        s.subjectId === rules.subjectId &&
        s.examYear < rules.examYear &&
        scaleMaxPrimary(s) === max,
    )
    .sort((a, b) => a.examYear - b.examYear);
  return earlier.length > 0
    ? { scale: earlier[earlier.length - 1]!, basis: 'reference-year' }
    : null;
}

/** The table a new attempt of the format is converted by, or null. */
export function currentScale(
  format: string | null,
  scales: readonly ExamScale[] = EXAM_SCALES,
): ExamScale | null {
  return scaleForFormat(format, scales)?.scale ?? null;
}

/**
 * What the screen writes next to a converted score: «Тестовый балл ·
 * ориентир по шкале ЕГЭ-2026» while the table is of an earlier year than
 * the exam being prepared for (never presented as the official ЕГЭ-2027
 * result), «Тестовый балл · по шкале ЕГЭ-2027» with that year's table.
 */
export function scaleLabel(scale: Pick<ExamScale, 'examYear' | 'status'>): string {
  if (scale.status === 'approximate')
    return `Тестовый балл · приблизительно, по шкале ЕГЭ-${scale.examYear}`;
  return scale.examYear < TARGET_EXAM_YEAR
    ? `Тестовый балл · ориентир по шкале ЕГЭ-${scale.examYear}`
    : `Тестовый балл · по шкале ЕГЭ-${scale.examYear}`;
}

/** «ориентир по шкале ЕГЭ-2026» — a `scaleLabel` without «Тестовый балл ·». */
export function scaleShortLabel(label: string): string {
  return label.replace(/^Тестовый балл · /, '');
}

export type ScaleConversion =
  | {
      readonly available: true;
      readonly testScore: number;
      readonly scaleId: string;
      readonly status: ScaleStatus;
      readonly source: string;
      readonly updatedAt: string;
      readonly examYear: number;
      /** «Тестовый балл · ориентир по шкале ЕГЭ-2026». Always shown with the score. */
      readonly label: string;
    }
  | { readonly available: false; readonly reason: string };

export const NO_SCALE_REASON =
  'Официальная шкала перевода в тестовые баллы для этого экзамена не подключена — показаны только первичные баллы.';

const FROZEN_SCALE_MISSING =
  'Шкала, по которой считалась эта попытка, не найдена — тестовый балл не показывается, чтобы не пересчитать результат по другой шкале.';

/** Why a table cannot convert results of an exam with another maximum. */
export function maxMismatchReason(examMax: number, scale: ExamScale): string {
  return `В этом формате экзамена максимум ${examMax} первичных баллов, а шкала ЕГЭ-${scale.examYear} рассчитана на ${scaleMaxPrimary(scale)}. Растягивать шкалу нельзя, поэтому тестовый балл не считается — показаны только первичные баллы.`;
}

/**
 * Why a primary score cannot be converted, or null when it can. A real
 * primary score is always a whole number from 0 to the maximum (every
 * rule awards whole points; a variant never offers more than its exam's
 * maximum) — anything else is a bug upstream: reported, never rounded or
 * clamped into a plausible-looking test score.
 */
export function invalidPrimaryReason(primary: number, maxPrimary: number): string | null {
  return Number.isInteger(primary) && primary >= 0 && primary <= maxPrimary
    ? null
    : `Первичный балл ${primary} некорректен: ожидается целое число от 0 до ${maxPrimary}. Тестовый балл не считается.`;
}

/**
 * The table for a result: the one frozen into the attempt (`scaleId`) —
 * never silently swapped when it is missing — or the format's table now
 * (`scaleForFormat`), or why there is none. A table whose maximum
 * differs from the exam's (`examMax`; e.g. 33 for the Yashchenko-2027
 * project format vs 32 in the 2026 table) is refused: no stretching.
 */
export function resolveScale(
  scaleId: string | null,
  format: string | null,
  scales: readonly ExamScale[] = EXAM_SCALES,
  examMax?: number,
): { readonly scale: ExamScale } | { readonly reason: string } {
  const rules = currentScoringRules(format);
  const max = examMax ?? (rules ? maxPrimaryTotal(rules) : undefined);
  if (scaleId && !scales.some((s) => s.id === scaleId)) return { reason: FROZEN_SCALE_MISSING };
  const scale =
    (scaleId ? scales.find((s) => s.id === scaleId) : undefined) ??
    scaleForFormat(format, scales)?.scale;
  if (scale) {
    if (max !== undefined && scaleMaxPrimary(scale) !== max)
      return { reason: maxMismatchReason(max, scale) };
    return { scale };
  }
  if (rules && max !== undefined) {
    const sameSubject = scales
      .filter((s) => s.subjectId === rules.subjectId && s.examYear <= rules.examYear)
      .sort((a, b) => a.examYear - b.examYear);
    const latest = sameSubject[sameSubject.length - 1];
    if (latest) return { reason: maxMismatchReason(max, latest) };
  }
  return { reason: NO_SCALE_REASON };
}

/**
 * The test score for `primary` points: exactly the table's value — no
 * rounding, clamping or interpolation. An invalid primary score
 * (`invalidPrimaryReason`) gives `available: false` with the reason.
 */
export function convertPrimaryToTest(
  primary: number,
  scaleId: string | null,
  format: string | null,
  scales: readonly ExamScale[] = EXAM_SCALES,
  examMax?: number,
): ScaleConversion {
  const resolved = resolveScale(scaleId, format, scales, examMax);
  if ('reason' in resolved) return { available: false, reason: resolved.reason };
  const { scale } = resolved;
  const invalid = invalidPrimaryReason(primary, scaleMaxPrimary(scale));
  if (invalid) return { available: false, reason: invalid };
  return {
    available: true,
    testScore: scale.testByPrimary[primary]!,
    scaleId: scale.id,
    status: scale.status,
    source: scale.source,
    updatedAt: scale.updatedAt,
    examYear: scale.examYear,
    label: scaleLabel(scale),
  };
}

export type TestScoreGain =
  | {
      readonly available: true;
      readonly gain: number;
      /** Test scores before and after, by the same table. */
      readonly from: number;
      readonly to: number;
      readonly status: ScaleStatus;
      readonly scaleId: string;
      readonly examYear: number;
      readonly label: string;
    }
  | { readonly available: false; readonly reason: string };

/**
 * How many test points `gain` more primary points would add to a result
 * of `current` primary points: both converted by the same table, the
 * difference taken. Both must be whole, valid primary scores. The only
 * way a screen may show «+N баллов».
 */
export function testScoreGain(
  format: string | null,
  current: number,
  gain: number,
  scales: readonly ExamScale[] = EXAM_SCALES,
): TestScoreGain {
  const from = convertPrimaryToTest(current, null, format, scales);
  const to = convertPrimaryToTest(current + gain, null, format, scales);
  if (!from.available) return { available: false, reason: from.reason };
  if (!to.available) return { available: false, reason: to.reason };
  return {
    available: true,
    gain: Math.max(0, to.testScore - from.testScore),
    from: from.testScore,
    to: to.testScore,
    status: to.status,
    scaleId: to.scaleId,
    examYear: to.examYear,
    label: to.label,
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
  /** Table in force when the attempt started; null = none fits. */
  readonly scaleId: string | null;
  /** Its exam year (2026 for the guide table), kept with the attempt so
   * its result keeps its meaning whatever is added later. Absent in
   * attempts started before tables were registered. */
  readonly scaleYear?: number | null;
  readonly tasks: readonly SnapshotTask[];
  /** Exam task numbers this variant does not offer (e.g. a task still
   * under review) — they cannot earn points in this attempt. */
  readonly unavailableTaskNumbers: readonly number[];
}

/**
 * Attempts started before any table was registered carry `scaleId: null`
 * and no `scaleYear`. They are converted by tables of this year at the
 * latest — never by a table added later — so their meaning stays fixed.
 */
export const LEGACY_SCALE_MAX_YEAR = 2026;

/** An attempt started before tables were registered (no frozen table). */
export function isLegacySnapshot(
  snapshot: Pick<VariantScoringSnapshot, 'scaleId' | 'scaleYear'>,
): boolean {
  return snapshot.scaleId === null && snapshot.scaleYear === undefined;
}

/** The table a new attempt of the format is converted by, frozen into it. */
export function frozenScale(
  format: string | null,
  examMax: number,
  scales: readonly ExamScale[] = EXAM_SCALES,
): { scaleId: string | null; scaleYear: number | null } {
  const resolved = resolveScale(null, format, scales, examMax);
  return 'scale' in resolved
    ? { scaleId: resolved.scale.id, scaleYear: resolved.scale.examYear }
    : { scaleId: null, scaleYear: null };
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
    ...frozenScale(rules.format, maxPrimaryTotal(rules)),
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

/** `not_graded`: graded only by experts (the essay) — never scored here. */
export type TaskScoreStatus = 'full' | 'partial' | 'zero' | 'unanswered' | 'not_graded';

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
  /** Points of tasks only experts grade (the essay): part of the maximum,
   * never part of `primary`. 0 when there are none. */
  readonly notGradedMax: number;
  readonly tasks: readonly TaskScore[];
  readonly conversion: ScaleConversion;
}

export function scoreTask(rule: TaskScoringRule, answer: FirstAnswer | undefined): number {
  if (!answer) return 0;
  switch (rule.kind) {
    case 'expert':
      return 0;
    case 'positions': {
      if (answer.correct) return rule.max;
      const parts = answer.correctParts;
      if (!parts) return 0;
      const total = Object.keys(parts).length;
      const wrong = Object.values(parts).filter((ok) => !ok).length;
      if (wrong === 0 && total > 0) return rule.max;
      return wrong <= 2 && wrong < total ? Math.max(0, rule.max - 1) : 0;
    }
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
      status:
        rule.kind === 'expert'
          ? 'not_graded'
          : !answer
            ? 'unanswered'
            : awarded === rule.max
              ? 'full'
              : awarded > 0
                ? 'partial'
                : 'zero',
      estimated: rule.kind === 'answer' || rule.kind === 'abc',
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
    notGradedMax: tasks.filter((t) => t.status === 'not_graded').reduce((a, t) => a + t.max, 0),
    tasks,
    conversion: attemptConversion(snapshot, primary, scales),
  };
}

const NO_SCALE_AT_START =
  'Когда попытка началась, подходящей шкалы перевода не было — результат не пересчитывается по шкале, добавленной позже. Показаны только первичные баллы.';

/**
 * The attempt's test score, by the table frozen into it:
 * - a frozen table → that table (or the reason it is missing);
 * - frozen «none» (`scaleId: null`, `scaleYear: null`) → stays without a
 *   test score even if a table is added later;
 * - an attempt from before tables existed (no `scaleYear`) → the tables
 *   of `LEGACY_SCALE_MAX_YEAR` at the latest.
 */
function attemptConversion(
  snapshot: VariantScoringSnapshot,
  primary: number,
  scales: readonly ExamScale[],
): ScaleConversion {
  const legacy = isLegacySnapshot(snapshot);
  const usable = legacy ? scales.filter((sc) => sc.examYear <= LEGACY_SCALE_MAX_YEAR) : scales;
  if (!legacy && snapshot.scaleId === null) {
    const now = resolveScale(null, snapshot.format, usable, snapshot.examMaxTotal);
    return { available: false, reason: 'reason' in now ? now.reason : NO_SCALE_AT_START };
  }
  return convertPrimaryToTest(
    primary,
    snapshot.scaleId,
    snapshot.format,
    usable,
    snapshot.examMaxTotal,
  );
}
