import {
  planTraining,
  isTrainableSkill,
  type SkillState,
  type SubjectState,
  type TrainingBucket,
  type TrainingMix,
  type TrainingPlan,
  type TrainingSlot,
} from './engine.js';

/**
 * «Умная тренировка» с настройкой (docs/learning/SMART-TRAINING.md): the
 * student picks the subject, the kind of training, topics, how many tasks
 * and the difficulty. Every mode is a different plan on the Learning
 * Engine — which skills, and which buckets (weak / mistakes / stale /
 * strong) the picker scores tasks for — never a filter over a random list.
 */
export const smartTrainingModes = ['subject', 'topics', 'problems', 'stats', 'mixed'] as const;
export type SmartTrainingMode = (typeof smartTrainingModes)[number];

export const smartDifficulties = ['easy', 'medium', 'hard', 'mixed'] as const;
export type SmartDifficulty = (typeof smartDifficulties)[number];

/** Authored difficulty 1..3 the picker aims at; `mixed` = from the student's mastery. */
export const SMART_DIFFICULTY_LEVEL: Record<SmartDifficulty, 1 | 2 | 3 | undefined> = {
  easy: 1,
  medium: 2,
  hard: 3,
  mixed: undefined,
};

export const SMART_TRAINING_MIN = 3;
export const SMART_TRAINING_MAX = 50;

/** «По моей статистике»: mostly weak skills and mistakes, some review. */
export const STATS_MIX: TrainingMix = { weak: 0.45, mistakes: 0.35, stale: 0.2, strong: 0 };
/** «Смешанная»: new and weak, mistakes, review and harder tasks in learned topics. */
export const MIXED_MIX: TrainingMix = { weak: 0.35, mistakes: 0.25, stale: 0.25, strong: 0.15 };
/** «Проблемные темы»: only the problem topics, weak tasks and their mistakes. */
export const PROBLEMS_MIX: TrainingMix = { weak: 0.6, mistakes: 0.4, stale: 0, strong: 0 };

export interface ProblemInfo {
  /** Higher = a bigger problem. */
  readonly score: number;
  /** Why, for the student («точность 38%», «3 ошибки не исправлены»…). */
  readonly reasons: readonly string[];
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * Is this topic a problem, and how big: from the student's own answers only
 * (error rate, the last 7 answers, open and repeated mistakes, a falling
 * trend, mistakes after reading the explanation, how long ago). A topic with
 * fewer than 3 answers and no open mistake is not judged — too little data.
 */
export function problemInfo(s: SkillState): ProblemInfo | null {
  if (!isTrainableSkill(s)) return null;
  if (s.attempts < 3 && s.openMistakes === 0) return null;
  const errorRate = s.attempts > 0 ? s.incorrect / s.attempts : 0;
  const recentRate = s.recent.attempts > 0 ? s.recent.wrong / s.recent.attempts : 0;
  const isProblem =
    s.level === 'weak' ||
    s.openMistakes > 0 ||
    s.repeatedErrorTasks > 0 ||
    s.trend === 'down' ||
    (s.recent.attempts >= 3 && recentRate >= 0.5);
  if (!isProblem) return null;
  const reasons: string[] = [];
  if (s.attempts >= 3) reasons.push(`точность ${pct(1 - errorRate)}`);
  if (s.recent.attempts >= 3 && s.recent.wrong > 0) {
    reasons.push(`в последних ${s.recent.attempts} ответах ошибок: ${s.recent.wrong}`);
  }
  if (s.openMistakes > 0) reasons.push(`не исправлено ошибок: ${s.openMistakes}`);
  if (s.repeatedErrorTasks > 0) reasons.push(`повторные ошибки: ${s.repeatedErrorTasks}`);
  if (s.trend === 'down') reasons.push('результат снижается');
  if (s.stuckAfterExplanation > 0) reasons.push('ошибки после разбора');
  const score =
    (100 - s.mastery) * 0.5 +
    errorRate * 30 +
    recentRate * 20 +
    Math.min(s.openMistakes, 10) * 5 +
    Math.min(s.repeatedErrorTasks, 10) * 4 +
    (s.trend === 'down' ? 10 : 0) +
    Math.min(s.stuckAfterExplanation, 5) * 5 +
    Math.min(s.daysSince ?? 0, 30) / 3;
  return { score: Math.round(score * 10) / 10, reasons };
}

/** The student's problem topics in a subject, the biggest first. */
export function problemSkills(subject: SubjectState, limit = 8): SkillState[] {
  return subject.skills
    .map((s) => ({ s, p: problemInfo(s) }))
    .filter((x): x is { s: SkillState; p: ProblemInfo } => x.p !== null)
    .sort((a, b) => b.p.score - a.p.score || (a.s.examNumber ?? 99) - (b.s.examNumber ?? 99))
    .slice(0, limit)
    .map((x) => x.s);
}

/** The bucket a task of this skill is scored for, by the student's state in it. */
function bucketOf(s: SkillState): TrainingBucket {
  if (s.openMistakes > 0 || s.repeatedErrorTasks > 0) return 'mistakes';
  if (s.level === 'strong') return (s.daysSince ?? 0) >= 7 ? 'stale' : 'strong';
  if (s.level === 'developing' && (s.daysSince ?? 0) >= 7) return 'stale';
  return 'weak';
}

/**
 * «Весь предмет»: tasks from as many different topics as the training has
 * slots — spread evenly over every numbered topic of the subject, not
 * driven by weak spots; each slot's tasks are still scored for the
 * student's state in that topic (a mistake first, a new task over a solved one).
 */
function spreadPlan(subject: SubjectState, total: number): TrainingSlot[] {
  const skills = subject.skills
    .filter((s) => isTrainableSkill(s) && s.examNumber !== null)
    .sort((a, b) => (a.examNumber ?? 99) - (b.examNumber ?? 99) || a.key.localeCompare(b.key));
  if (skills.length === 0) return [];
  const slots: TrainingSlot[] = [];
  // Evenly spaced through the list, then round again — every topic once
  // before any topic twice.
  const step = skills.length / Math.min(total, skills.length);
  for (let round = 0; slots.length < total; round++) {
    for (let i = 0; i < Math.min(total, skills.length) && slots.length < total; i++) {
      const s = skills[(Math.floor(i * step) + round) % skills.length]!;
      slots.push({ bucket: bucketOf(s), skillKey: s.key });
    }
  }
  return slots;
}

function countBuckets(slots: readonly TrainingSlot[]): Record<TrainingBucket, number> {
  const counts: Record<TrainingBucket, number> = { weak: 0, mistakes: 0, stale: 0, strong: 0 };
  for (const s of slots) counts[s.bucket] += 1;
  return counts;
}

export interface SmartTrainingOptions {
  readonly mode: SmartTrainingMode;
  /** `topics`: the chosen skill keys of this subject. */
  readonly skillKeys?: readonly string[];
  readonly difficulty?: SmartDifficulty;
}

export type SmartPlanResult =
  | { readonly ok: true; readonly plan: TrainingPlan; readonly skillKeys: readonly string[] }
  | { readonly ok: false; readonly reason: 'no_topics' | 'no_problem_topics' | 'unknown_topic' };

/**
 * The plan for one configured training. The skills it may use are fixed
 * here (`skillKeys` of the result); the session picks every task only from
 * them, so «Проблемные темы» or chosen topics never get a task from elsewhere.
 */
export function smartTrainingPlan(
  subject: SubjectState,
  total: number,
  options: SmartTrainingOptions,
): SmartPlanResult {
  const masteryAtStart = Object.fromEntries(subject.skills.map((s) => [s.key, s.mastery]));
  const difficulty = SMART_DIFFICULTY_LEVEL[options.difficulty ?? 'mixed'];
  const only = (keys: readonly string[]): SubjectState => {
    const set = new Set(keys);
    return { ...subject, skills: subject.skills.filter((s) => set.has(s.key)) };
  };
  const finish = (base: TrainingPlan, keys: readonly string[]): SmartPlanResult => ({
    ok: true,
    plan: { ...base, masteryAtStart, ...(difficulty ? { difficulty } : {}) },
    skillKeys: keys,
  });

  switch (options.mode) {
    case 'subject': {
      const slots = spreadPlan(subject, total);
      if (slots.length === 0) return { ok: false, reason: 'no_topics' };
      return finish({ slots, masteryAtStart, counts: countBuckets(slots) }, [
        ...new Set(slots.map((s) => s.skillKey)),
      ]);
    }
    case 'topics': {
      const keys = [...new Set(options.skillKeys ?? [])];
      if (keys.length === 0) return { ok: false, reason: 'no_topics' };
      const known = new Map(subject.skills.map((s) => [s.key, s]));
      if (keys.some((k) => !known.has(k))) return { ok: false, reason: 'unknown_topic' };
      const trainable = keys.filter((k) => isTrainableSkill(known.get(k)!));
      if (trainable.length === 0) return { ok: false, reason: 'no_topics' };
      return finish(planWithin(only(trainable), total), trainable);
    }
    case 'problems': {
      const keys = problemSkills(subject).map((s) => s.key);
      if (keys.length === 0) return { ok: false, reason: 'no_problem_topics' };
      return finish(planWithin(only(keys), total, PROBLEMS_MIX), keys);
    }
    case 'stats': {
      const plan = planTraining(subject, total, { mix: STATS_MIX });
      if (plan.slots.length === 0) return { ok: false, reason: 'no_topics' };
      return finish(plan, [...new Set(plan.slots.map((s) => s.skillKey))]);
    }
    case 'mixed': {
      const plan = planTraining(subject, total, { mix: MIXED_MIX });
      if (plan.slots.length === 0) return { ok: false, reason: 'no_topics' };
      return finish(plan, [...new Set(plan.slots.map((s) => s.skillKey))]);
    }
  }
}

/**
 * A plan inside a fixed set of skills. `planTraining` hands slots of an
 * empty bucket to «any trainable skill» — here those are only the chosen
 * skills, including ones the student has not started yet.
 */
function planWithin(scope: SubjectState, total: number, mix?: TrainingMix): TrainingPlan {
  const plan = planTraining(scope, total, mix ? { mix } : {});
  if (plan.slots.length >= total) return plan;
  // Chosen topics without a number in the current edition: planTraining's
  // fallback skips them — fill round-robin from the scope itself.
  const pool = scope.skills.filter(isTrainableSkill);
  if (pool.length === 0) return plan;
  const slots = [...plan.slots];
  for (let i = 0; slots.length < total; i++) {
    const s = pool[i % pool.length]!;
    slots.push({ bucket: bucketOf(s), skillKey: s.key });
  }
  return { ...plan, slots, counts: countBuckets(slots) };
}

/** What the set-up screen shows for each topic of the subject. */
export interface SmartSetupSkill {
  readonly key: string;
  readonly examNumber: number | null;
  readonly title: string;
  /** null until the student has answered here. */
  readonly mastery: number | null;
  readonly level: SkillState['level'];
  readonly attempts: number;
  readonly availableTasks: number;
  readonly openMistakes: number;
  readonly problem: ProblemInfo | null;
}

export interface SmartSetupResponse {
  readonly subjectId: string;
  readonly skills: readonly SmartSetupSkill[];
  /** Problem topics, the biggest first (what «Проблемные темы» trains). */
  readonly problemKeys: readonly string[];
  /** Distinct tasks in the whole subject available for training. */
  readonly subjectTasks: number;
}

export function smartSetupSkills(subject: SubjectState): SmartSetupSkill[] {
  return subject.skills
    .filter(isTrainableSkill)
    .sort((a, b) => (a.examNumber ?? 99) - (b.examNumber ?? 99) || a.title.localeCompare(b.title))
    .map((s) => ({
      key: s.key,
      examNumber: s.examNumber,
      title: s.title,
      mastery: s.attempts > 0 ? s.mastery : null,
      level: s.level,
      attempts: s.attempts,
      availableTasks: s.availableTasks,
      openMistakes: s.openMistakes,
      problem: problemInfo(s),
    }));
}
