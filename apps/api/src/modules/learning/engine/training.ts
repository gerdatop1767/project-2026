import type { Database } from '@zybrilka/db';
import {
  examSkillInfo,
  planTraining,
  recommendSkills,
  targetDifficultyFor,
  type SkillRecommendation,
  type SkillState,
  type TrainingMix,
  type TrainingPickInfo,
  type TrainingPlan,
  type TrainingSkillProgress,
  type TrainingSlot,
} from '@zybrilka/shared';
import { buildStudentModel, recentlyPracticedClean } from './model.js';
import { pickTasksForSkill, type PickedTask } from './picker.js';

/**
 * Smart Training on the Learning Engine (docs/learning/ALGORITHMS.md § 4).
 * The plan (slots: bucket + skill) is fixed when the training starts; the
 * task of each slot is picked only when the slot is reached, from the
 * student's state at that moment — so a mistake made in task 2 already
 * changes what task 5 looks like, and difficulty rises within a training
 * as answers come in right.
 */

export interface PlannedStart {
  readonly plan: TrainingPlan;
  readonly taskId: string;
  readonly pick: TrainingPickInfo;
}

function reasonFor(slot: TrainingSlot, skill: SkillState, picked: PickedTask): string {
  const n = skill.examNumber ? `№${skill.examNumber}` : 'Тема';
  const name = `${n} · ${skill.title}`;
  if (picked.why === 'mistake') return `Работа над ошибками: ${name} — задание из «Мои ошибки».`;
  if (picked.why === 'retry') return `Ещё попытка: ${name} — это задание раньше не получилось.`;
  switch (slot.bucket) {
    case 'weak':
      return skill.level === 'none'
        ? `Знакомство: ${name} — ты ещё не решал этот номер.`
        : skill.level === 'low_data'
          ? `Проверим уровень: ${name} — пока мало попыток.`
          : `Слабое место: ${name} (освоение ${skill.mastery}%).`;
    case 'mistakes':
      return `Работа над ошибками: ${name}.`;
    case 'stale':
      return `Повторение: ${name} — давно не практиковал.`;
    case 'strong':
      return `Поддержание: ${name} — задание посложнее.`;
  }
}

/** Picks the task for slot `index`, falling back to the other skills of the plan. */
export async function pickForSlot(
  db: Database,
  userId: string,
  input: {
    subjectId: string;
    plan: TrainingPlan;
    index: number;
    consumed: readonly string[];
    unseenOnly?: boolean;
  },
): Promise<{ taskId: string; pick: TrainingPickInfo } | null> {
  const model = await buildStudentModel(db, userId, new Date(), { allSubjects: true });
  const subject = model.subjects.find((s) => s.subjectId === input.subjectId);
  if (!subject) return null;
  const skillOf = new Map(subject.skills.map((s) => [s.key, s]));
  const slot = input.plan.slots[input.index];
  if (!slot) return null;
  // The slot's own skill first, then every other skill of the plan.
  const order = [slot, ...input.plan.slots.filter((s) => s.skillKey !== slot.skillKey)];
  const tried = new Set<string>();
  for (const s of order) {
    if (tried.has(s.skillKey)) continue;
    tried.add(s.skillKey);
    const skill = skillOf.get(s.skillKey);
    if (!skill) continue;
    const [picked] = await pickTasksForSkill(db, userId, {
      skillKey: s.skillKey,
      count: 1,
      bucket: slot.bucket,
      targetDifficulty: input.plan.difficulty ?? targetDifficultyFor(skill.mastery, skill.level),
      excludeTaskIds: input.consumed,
      unseenOnly: input.unseenOnly,
    });
    if (picked) {
      return {
        taskId: picked.taskId,
        pick: {
          bucket: slot.bucket,
          skillKey: skill.key,
          examNumber: skill.examNumber,
          title: skill.title,
          reason: reasonFor(slot, skill, picked),
        },
      };
    }
  }
  return null;
}

export async function startPlannedTraining(
  db: Database,
  userId: string,
  input: {
    subjectId: string;
    total: number;
    focusSkill?: string;
    mix?: TrainingMix;
    unseenOnly?: boolean;
    difficulty?: 1 | 2 | 3;
  },
): Promise<PlannedStart | null> {
  const model = await buildStudentModel(db, userId, new Date(), { allSubjects: true });
  const subject = model.subjects.find((s) => s.subjectId === input.subjectId);
  if (!subject) return null;
  const plan = planTraining(subject, input.total, {
    mix: input.mix,
    focusSkill: input.focusSkill,
    difficulty: input.focusSkill ? input.difficulty : undefined,
  });
  if (plan.slots.length === 0) return null;
  const first = await pickForSlot(db, userId, {
    subjectId: input.subjectId,
    plan,
    index: 0,
    consumed: [],
    unseenOnly: input.unseenOnly,
  });
  if (!first) return null;
  return { plan, taskId: first.taskId, pick: first.pick };
}

/** «Что улучшилось» and «что дальше» after a training. */
export async function trainingOutcome(
  db: Database,
  userId: string,
  input: {
    subjectId: string;
    plan: TrainingPlan;
    answers: readonly { taskSkillKeys: readonly string[]; isCorrect: boolean }[];
  },
): Promise<{ skills: TrainingSkillProgress[]; next: SkillRecommendation[] }> {
  const now = new Date();
  const [model, clean] = await Promise.all([
    buildStudentModel(db, userId, now, { allSubjects: true }),
    recentlyPracticedClean(db, userId, now),
  ]);
  const subject = model.subjects.find((s) => s.subjectId === input.subjectId);
  const skillOf = new Map((subject?.skills ?? []).map((s) => [s.key, s]));
  const perSkill = new Map<string, { attempts: number; correct: number }>();
  for (const a of input.answers) {
    for (const key of a.taskSkillKeys) {
      const s = perSkill.get(key) ?? { attempts: 0, correct: 0 };
      perSkill.set(key, { attempts: s.attempts + 1, correct: s.correct + (a.isCorrect ? 1 : 0) });
    }
  }
  const skills = [...perSkill.entries()]
    .map(([key, s]) => {
      const info = examSkillInfo(key);
      return {
        skillKey: key,
        examNumber: info?.examNumber ?? null,
        title: info?.title ?? key,
        before: input.plan.masteryAtStart[key] ?? 0,
        after: skillOf.get(key)?.mastery ?? 0,
        attempts: s.attempts,
        correct: s.correct,
      };
    })
    .sort((a, b) => (a.examNumber ?? 99) - (b.examNumber ?? 99));
  const scoped = {
    ...model,
    subjects: model.subjects.filter((s) => s.subjectId === input.subjectId),
  };
  // «Что дальше» covers this subject even when it is not in the profile.
  const next = recommendSkills(
    { ...scoped, hasProfile: false },
    { now, recentlyPracticedClean: clean, limit: 3 },
  );
  return { skills, next };
}
