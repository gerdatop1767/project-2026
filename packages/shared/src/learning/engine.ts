import type { TargetScore } from '../learningProfile.js';
import type { SkillLevel, SkillTrend } from './mastery.js';

/**
 * Learning Engine — the one student model every learning feature reads
 * (docs/learning/LEARNING-ENGINE-ARCHITECTURE.md). Statistics, recommendations
 * and smart training all take a `StudentModel` built by
 * `apps/api/src/modules/learning/engine/model.ts` from the same attempts with
 * the same mastery formula; nothing here reads the database.
 */

export interface SkillState {
  readonly key: string;
  readonly subjectId: string;
  readonly title: string;
  /** № in the current edition, null = topic of the old numbering only. */
  readonly examNumber: number | null;
  readonly part: 1 | 2 | null;
  readonly mastery: number;
  readonly confidence: number;
  readonly level: SkillLevel;
  readonly attempts: number;
  readonly correct: number;
  readonly incorrect: number;
  readonly lastAttemptAt: string | null;
  /** Whole days since the last attempt, null without attempts. */
  readonly daysSince: number | null;
  readonly trend: SkillTrend | null;
  /** Tasks answered wrong 2+ times. */
  readonly repeatedErrorTasks: number;
  /** Tasks answered wrong and later right. */
  readonly recoveredTasks: number;
  /** The last 7 attempts: how many, how many wrong. */
  readonly recent: { readonly attempts: number; readonly wrong: number };
  /** Open «Мои ошибки» in this skill. */
  readonly openMistakes: number;
  /** Open mistakes whose explanation was opened and that were still answered wrong again. */
  readonly stuckAfterExplanation: number;
  /** Average of the student's own difficulty ratings here, null without ratings. */
  readonly myAverageRating: number | null;
  /** Tasks solved correctly but rated 8+ by the student («решаю, но тяжело»). */
  readonly hardButCorrect: number;
  /** Published, auto-checked tasks available for training. */
  readonly availableTasks: number;
}

export interface SubjectState {
  readonly subjectId: string;
  /** Chosen in the profile (onboarding). */
  readonly selected: boolean;
  readonly targetScore: TargetScore;
  readonly skills: readonly SkillState[];
  readonly totals: {
    readonly attempts: number;
    readonly correct: number;
    readonly solvedTasks: number;
    readonly accuracy: number | null;
  };
}

export interface StudentModel {
  readonly subjects: readonly SubjectState[];
  readonly hasProfile: boolean;
}

// ---------------------------------------------------------------- recommendations

export type RecommendationKind =
  'repeated_errors' | 'weak' | 'declining' | 'hard_for_me' | 'low_data' | 'stale' | 'unexplored';

export interface SkillRecommendation {
  readonly subjectId: string;
  readonly skillKey: string;
  readonly examNumber: number | null;
  readonly title: string;
  readonly kind: RecommendationKind;
  /** 0..100, for ordering only. */
  readonly priority: number;
  /** Why, with the student's own numbers. */
  readonly reason: string;
  /** What practicing it gives. */
  readonly benefit: string;
  /** How many tasks to start with. */
  readonly suggestedTasks: number;
}

export interface RecommendOptions {
  readonly now: Date;
  /** Skills practiced in the last 20 h without errors (anti-repeat). */
  readonly recentlyPracticedClean?: ReadonlySet<string>;
  readonly limit?: number;
}

const HIGH_TARGET: ReadonlySet<TargetScore> = new Set(['80_plus', '90_plus', '95_plus', '100']);
const LOW_TARGET: ReadonlySet<TargetScore> = new Set(['60_plus', '70_plus']);

/** Skills a student can train on automatically (auto-checked tasks exist). */
export function isTrainableSkill(s: SkillState): boolean {
  return s.availableTasks > 0 && s.key !== 'russian.27-essay';
}

/**
 * The target score decides how much the extended-answer part matters: a
 * student aiming at 60–70 in math gets most of it from part 1, a student
 * aiming at 80+ cannot without part 2. Russian is all part 1 except the essay.
 */
function targetFactor(s: SkillState, target: TargetScore): number {
  if (s.subjectId !== 'math' || s.part === null) return 1;
  if (s.part === 2) return HIGH_TARGET.has(target) ? 1.15 : LOW_TARGET.has(target) ? 0.7 : 1;
  return LOW_TARGET.has(target) ? 1.1 : 1;
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function benefitOf(s: SkillState): string {
  if (s.subjectId === 'math' && s.part === 2) {
    return 'Задание второй части: даёт больше первичных баллов, чем задания с кратким ответом.';
  }
  if (s.subjectId === 'math')
    return 'Задание первой части: верный ответ — гарантированный первичный балл.';
  return 'Каждое верно решённое задание этого типа на экзамене — первичные баллы без потерь.';
}

/** One recommendation per skill: its most urgent reason, or none. */
function recommendSkill(s: SkillState): Omit<SkillRecommendation, 'priority'> & { base: number } {
  const n = s.recent.attempts;
  const common = {
    subjectId: s.subjectId,
    skillKey: s.key,
    examNumber: s.examNumber,
    title: s.title,
    benefit: benefitOf(s),
  };
  if (s.repeatedErrorTasks > 0 || s.stuckAfterExplanation > 0) {
    const k = Math.max(s.repeatedErrorTasks, s.stuckAfterExplanation);
    return {
      ...common,
      kind: 'repeated_errors',
      base: 0.9 + 0.025 * Math.min(k, 4),
      suggestedTasks: 3,
      reason:
        s.stuckAfterExplanation > 0
          ? `Ошибки повторяются даже после разбора: ${s.stuckAfterExplanation} ${plural(s.stuckAfterExplanation, 'задание', 'задания', 'заданий')}. Начни с трёх заданий этого типа.`
          : `Ошибки повторяются: ${k} ${plural(k, 'задание решено', 'задания решены', 'заданий решены')} неверно больше одного раза. Начни с трёх заданий этого типа.`,
    };
  }
  if (s.level === 'weak') {
    return {
      ...common,
      kind: 'weak',
      base: 0.6 + 0.3 * ((100 - s.mastery) / 100) + (n ? 0.1 * (s.recent.wrong / n) : 0),
      suggestedTasks: 5,
      reason: `За последние ${n} ${plural(n, 'попытку', 'попытки', 'попыток')} — ${s.recent.wrong} ${plural(s.recent.wrong, 'ошибка', 'ошибки', 'ошибок')}. Освоение ${s.mastery}%.`,
    };
  }
  if (s.trend === 'down') {
    return {
      ...common,
      kind: 'declining',
      base: 0.6,
      suggestedTasks: 4,
      reason: `Результаты ухудшаются: последние 5 попыток хуже предыдущих. Освоение ${s.mastery}%.`,
    };
  }
  if (s.hardButCorrect >= 2) {
    return {
      ...common,
      kind: 'hard_for_me',
      base: 0.45,
      suggestedTasks: 3,
      reason: `Решаешь верно, но ${s.hardButCorrect} ${plural(s.hardButCorrect, 'задание оценил', 'задания оценил', 'заданий оценил')} как сложные. Закрепи, чтобы решать увереннее.`,
    };
  }
  if (s.level === 'low_data') {
    return {
      ...common,
      kind: 'low_data',
      base: 0.42,
      suggestedTasks: 3,
      reason: `Пока ${s.attempts} ${plural(s.attempts, 'попытка', 'попытки', 'попыток')} — мало, чтобы оценить уровень. Ещё три задания покажут, как ты его знаешь.`,
    };
  }
  if ((s.level === 'strong' || s.level === 'developing') && (s.daysSince ?? 0) >= 14) {
    return {
      ...common,
      kind: 'stale',
      base: 0.35 + (Math.min(s.daysSince!, 60) / 60) * 0.2,
      suggestedTasks: 3,
      reason: `Ты ${s.level === 'strong' ? 'хорошо решаешь' : 'неплохо решаешь'} этот номер (${s.mastery}%), но не практиковал его ${s.daysSince} ${plural(s.daysSince!, 'день', 'дня', 'дней')}. Повтори, чтобы не забыть.`,
    };
  }
  if (s.level === 'none') {
    return {
      ...common,
      kind: 'unexplored',
      base: 0.3,
      suggestedTasks: 3,
      reason: 'Ты ещё не решал задания этого номера.',
    };
  }
  return { ...common, kind: 'stale', base: 0, suggestedTasks: 0, reason: '' };
}

/**
 * Concrete recommendations: subject, № ЕГЭ, topic, reason with the student's
 * own numbers, benefit, how many tasks. Only selected subjects (or every
 * subject in the model when the student has not chosen any); a skill
 * practiced cleanly in the last 20 hours is pushed down so the same advice
 * does not repeat right after it was followed. Deterministic.
 */
export function recommendSkills(
  model: StudentModel,
  options: RecommendOptions,
): SkillRecommendation[] {
  const subjects = model.subjects.filter((s) => s.selected || !model.hasProfile);
  const out: SkillRecommendation[] = [];
  for (const subject of subjects) {
    for (const skill of subject.skills) {
      if (!isTrainableSkill(skill) || skill.examNumber === null) continue;
      const r = recommendSkill(skill);
      if (r.base <= 0) continue;
      let p = r.base * targetFactor(skill, subject.targetScore);
      if (options.recentlyPracticedClean?.has(skill.key) && r.kind !== 'repeated_errors') p *= 0.4;
      out.push({
        subjectId: r.subjectId,
        skillKey: r.skillKey,
        examNumber: r.examNumber,
        title: r.title,
        kind: r.kind,
        reason: r.reason,
        benefit: r.benefit,
        suggestedTasks: r.suggestedTasks,
        priority: Math.round(Math.min(1, p) * 100),
      });
    }
  }
  const sorted = out.sort(
    (a, b) =>
      b.priority - a.priority ||
      a.subjectId.localeCompare(b.subjectId) ||
      (a.examNumber ?? 99) - (b.examNumber ?? 99),
  );
  // Several subjects: each gets a fair share before one fills the list.
  const limit = options.limit ?? 6;
  const quota = Math.ceil(limit / Math.max(1, subjects.length)) + 1;
  const picked: SkillRecommendation[] = [];
  const skipped: SkillRecommendation[] = [];
  const perSubject = new Map<string, number>();
  for (const r of sorted) {
    if (picked.length >= limit) break;
    const n = perSubject.get(r.subjectId) ?? 0;
    if (subjects.length > 1 && n >= quota) {
      skipped.push(r);
      continue;
    }
    perSubject.set(r.subjectId, n + 1);
    picked.push(r);
  }
  for (const r of skipped) {
    if (picked.length >= limit) break;
    picked.push(r);
  }
  return picked.sort(
    (a, b) =>
      b.priority - a.priority ||
      a.subjectId.localeCompare(b.subjectId) ||
      (a.examNumber ?? 99) - (b.examNumber ?? 99),
  );
}

// ---------------------------------------------------------------- smart training

export type TrainingBucket = 'weak' | 'mistakes' | 'stale' | 'strong';

export interface TrainingMix {
  readonly weak: number;
  readonly mistakes: number;
  readonly stale: number;
  readonly strong: number;
}

/** The starting mix (docs/learning/ALGORITHMS.md § 4); callers may pass another. */
export const DEFAULT_TRAINING_MIX: TrainingMix = {
  weak: 0.5,
  mistakes: 0.25,
  stale: 0.15,
  strong: 0.1,
};

const BUCKET_ORDER: readonly TrainingBucket[] = ['weak', 'mistakes', 'stale', 'strong'];

export interface TrainingSlot {
  readonly bucket: TrainingBucket;
  readonly skillKey: string;
}

export interface TrainingPlan {
  readonly slots: readonly TrainingSlot[];
  /** Mastery of every skill in the subject when the training started. */
  readonly masteryAtStart: Readonly<Record<string, number>>;
  /** Slot counts per bucket after redistribution. */
  readonly counts: Readonly<Record<TrainingBucket, number>>;
}

/** Largest-remainder split of `total` by the mix shares. */
export function splitByMix(total: number, mix: TrainingMix): Record<TrainingBucket, number> {
  const sum = BUCKET_ORDER.reduce((s, b) => s + Math.max(0, mix[b]), 0) || 1;
  const raw = BUCKET_ORDER.map((b) => (total * Math.max(0, mix[b])) / sum);
  const counts = raw.map(Math.floor);
  let left = total - counts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => [r - Math.floor(r), i] as const)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    counts[i]! += 1;
    left -= 1;
  }
  return Object.fromEntries(BUCKET_ORDER.map((b, i) => [b, counts[i]!])) as Record<
    TrainingBucket,
    number
  >;
}

/** Skills that can fill each bucket, most useful first. */
function bucketCandidates(subject: SubjectState): Record<TrainingBucket, string[]> {
  const skills = subject.skills.filter(isTrainableSkill);
  const byNeed = [...skills].sort(
    (a, b) => a.mastery - b.mastery || (a.examNumber ?? 99) - (b.examNumber ?? 99),
  );
  const weak = byNeed.filter(
    (s) =>
      s.level === 'weak' || s.trend === 'down' || s.level === 'low_data' || s.hardButCorrect >= 2,
  );
  const mistakes = [...skills]
    .filter((s) => s.openMistakes > 0 || s.repeatedErrorTasks > 0)
    .sort(
      (a, b) => b.openMistakes + b.repeatedErrorTasks - (a.openMistakes + a.repeatedErrorTasks),
    );
  const stale = [...skills]
    .filter((s) => (s.level === 'developing' || s.level === 'strong') && (s.daysSince ?? 0) >= 7)
    .sort((a, b) => (b.daysSince ?? 0) - (a.daysSince ?? 0));
  const strong = [...skills]
    .filter((s) => s.level === 'strong')
    .sort((a, b) => b.mastery - a.mastery);
  // A new student has no weak skills yet: unexplored numbers are where to start.
  const unexplored = byNeed.filter((s) => s.level === 'none' && s.examNumber !== null);
  return {
    weak: [...weak, ...unexplored].map((s) => s.key),
    mistakes: mistakes.map((s) => s.key),
    stale: stale.map((s) => s.key),
    strong: strong.map((s) => s.key),
  };
}

/**
 * A training of `total` tasks for one subject: slots per bucket by the mix,
 * filled round-robin from that bucket's skills. A bucket with no skill hands
 * its slots to the next bucket (weak → mistakes → stale → strong → any
 * trainable skill), so a short-of-data student still gets a full training.
 * `focusSkill` (a recommendation's «Начать») makes every slot that skill.
 */
export function planTraining(
  subject: SubjectState,
  total: number,
  options: { mix?: TrainingMix; focusSkill?: string } = {},
): TrainingPlan {
  const masteryAtStart = Object.fromEntries(subject.skills.map((s) => [s.key, s.mastery]));
  if (options.focusSkill) {
    return {
      slots: Array.from({ length: total }, () => ({
        bucket: 'weak' as const,
        skillKey: options.focusSkill!,
      })),
      masteryAtStart,
      counts: { weak: total, mistakes: 0, stale: 0, strong: 0 },
    };
  }
  const wanted = splitByMix(total, options.mix ?? DEFAULT_TRAINING_MIX);
  const candidates = bucketCandidates(subject);
  const anySkill = subject.skills
    .filter((s) => isTrainableSkill(s) && s.examNumber !== null)
    .sort((a, b) => a.mastery - b.mastery || (a.examNumber ?? 99) - (b.examNumber ?? 99))
    .map((s) => s.key);

  const counts: Record<TrainingBucket, number> = { weak: 0, mistakes: 0, stale: 0, strong: 0 };
  let carry = 0;
  for (const b of BUCKET_ORDER) {
    const n = wanted[b] + carry;
    if (candidates[b].length > 0) {
      counts[b] = n;
      carry = 0;
    } else carry = n;
  }
  if (carry > 0) {
    // Nothing in a later bucket either: give the rest to the first bucket that has skills.
    const first = BUCKET_ORDER.find((b) => candidates[b].length > 0);
    if (first) counts[first] += carry;
  }

  const perBucket: Record<TrainingBucket, TrainingSlot[]> = {
    weak: [],
    mistakes: [],
    stale: [],
    strong: [],
  };
  for (const b of BUCKET_ORDER) {
    const pool = candidates[b].length > 0 ? candidates[b] : anySkill;
    for (let i = 0; i < counts[b] && pool.length > 0; i++) {
      perBucket[b].push({ bucket: b, skillKey: pool[i % pool.length]! });
    }
  }
  let slots: TrainingSlot[] = [];
  // Interleave so a training is not «5 weak, then 3 mistakes…».
  for (let i = 0; slots.length < total; i++) {
    let added = false;
    for (const b of BUCKET_ORDER) {
      const s = perBucket[b][i];
      if (s) {
        slots.push(s);
        added = true;
      }
    }
    if (!added) break;
  }
  if (slots.length < total && anySkill.length > 0) {
    // No candidates at all (a brand-new student): weakest/unexplored first.
    for (let i = 0; slots.length < total; i++) {
      slots.push({ bucket: 'weak', skillKey: anySkill[i % anySkill.length]! });
      counts.weak += 1;
    }
  }
  slots = slots.slice(0, total);
  return { slots, masteryAtStart, counts };
}

/** Target task difficulty (authored 1..3 scale) for a skill: harder only as the student succeeds. */
export function targetDifficultyFor(mastery: number, level: SkillLevel): number {
  if (level === 'none' || level === 'low_data') return 1.5;
  if (mastery < 45) return 1.2;
  if (mastery < 65) return 1.8;
  if (mastery < 80) return 2.3;
  return 2.8;
}

// ---------------------------------------------------------------- API DTOs

export interface LearningOverviewResponse {
  readonly hasProfile: boolean;
  readonly subjects: readonly SubjectState[];
}

export interface RecommendationWithTasks extends SkillRecommendation {
  /** Concrete tasks to start with, in the suggested order. */
  readonly taskIds: readonly string[];
}

export interface LearningRecommendationsResponse {
  readonly recommendations: readonly RecommendationWithTasks[];
}

export interface PeriodStats {
  readonly attempts: number;
  readonly correct: number;
  readonly accuracy: number | null;
  readonly solvedTasks: number;
}

export interface LearningAnalyticsResponse {
  readonly subjectId: string;
  readonly periods: {
    readonly day: PeriodStats;
    readonly week: PeriodStats;
    readonly month: PeriodStats;
    readonly all: PeriodStats;
  };
  /** Measured only from attempts that carried their time. */
  readonly timeSpentMinutes: {
    readonly week: number;
    readonly all: number;
    readonly measuredAttempts: number;
  };
  readonly byNumber: readonly (SkillState & { readonly nextAction: string })[];
  readonly strong: readonly string[];
  readonly weak: readonly string[];
  readonly insufficient: readonly string[];
  readonly declining: readonly string[];
  readonly improving: readonly string[];
  readonly errors: {
    /** Skills by wrong answers, most first. */
    readonly mostWrong: readonly { readonly skillKey: string; readonly wrong: number }[];
    readonly repeated: readonly { readonly skillKey: string; readonly tasks: number }[];
    readonly afterExplanation: readonly { readonly skillKey: string; readonly tasks: number }[];
  };
}

/** What to do next with one number — for the analytics table. */
export function nextActionFor(s: SkillState): string {
  if (s.availableTasks === 0 || s.key === 'russian.27-essay')
    return 'Тренировка недоступна: нет заданий с автопроверкой.';
  if (s.repeatedErrorTasks > 0 || s.stuckAfterExplanation > 0)
    return 'Разобрать ошибки и решить 3 похожих задания.';
  if (s.level === 'none') return 'Начать: решить 3 задания.';
  if (s.level === 'low_data') return 'Решить ещё 3 задания, чтобы оценить уровень.';
  if (s.level === 'weak') return 'Повторить теорию и решить 5 заданий.';
  if (s.trend === 'down') return 'Повторить: результаты ухудшаются.';
  if ((s.daysSince ?? 0) >= 14) return 'Повторить: давно не практиковал.';
  if (s.level === 'developing') return 'Закрепить: решить задания посложнее.';
  return 'Поддерживать: изредка решать задания.';
}
