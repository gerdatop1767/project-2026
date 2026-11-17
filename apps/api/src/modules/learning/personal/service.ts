import type { Database } from '@zybrilka/db';
import { localDateOf, userTimezone } from '@zybrilka/db';
import {
  accuracySeries,
  adviceForSkill,
  currentScoringRules,
  diagnoseSkill,
  testScoreGain,
  displayMastery,
  dynamicsOf,
  examSkillInfo,
  type AdviceResponse,
  type Diagnosis,
  type PersonalRecommendation,
  type PersonalRecommendationsResponse,
  type ProblemSummary,
  type SkillProgressResponse,
  type SkillProgressSummary,
  type SkillState,
} from '@zybrilka/shared';
import { buildStudentModel } from '../engine/model.js';
import { getRecommendations } from '../engine/service.js';
import { loadSkillAttempts, type SkillAttemptFacts } from './data.js';
import { activePlanSummaries, planFocusView } from './plans.js';

export function problemSummary(skillKey: string, d: Diagnosis): ProblemSummary {
  if (d.attempts === 0) {
    // Not «needs diagnostics» — there is nothing to diagnose yet.
    return {
      type: d.type,
      title: 'Ещё не решал',
      summary: 'Ты ещё не решал задания этого номера — начни с трёх заданий.',
      evidence: ['По этому номеру ещё нет ответов.'],
    };
  }
  const advice = adviceForSkill(skillKey, d.type, d.detail ?? null);
  return {
    type: d.type,
    title: advice.title,
    summary: d.evidence[0] ?? advice.whatIsWrong,
    evidence: d.evidence,
    focus: advice.focus?.label ?? null,
  };
}

function priorityLevel(p: number): 'high' | 'medium' | 'low' {
  return p >= 70 ? 'high' : p >= 45 ? 'medium' : 'low';
}

/**
 * The exam format a subject's plan is counted by: the format of ЕГЭ-2027.
 * Math: the final 2027 specification keeps the 2026 format (19 tasks,
 * 32 points). Russian: the 2027 specification (27 tasks, 50 points).
 */
const PLAN_FORMAT: Readonly<Record<string, string>> = {
  math: 'ege-math-profile-2026',
  russian: 'ege-russian-2027',
};

const ESSAY_GAIN_NOTE =
  'Без сочинения (№27, до 22 первичных баллов): его оценивают эксперты, приложение его не проверяет.';

/** Primary points a number gives at most; null for a number with no known
 * rule, or one only experts grade (the essay — the app cannot measure it). */
function maxPrimaryPoints(subjectId: string, examNumber: number | null): number | null {
  const format = PLAN_FORMAT[subjectId];
  if (!format || examNumber === null) return null;
  const rule = currentScoringRules(format)?.tasks[examNumber];
  return rule && rule.kind !== 'expert' ? rule.max : null;
}

/**
 * The plan's ЕГЭ gain in TEST points (`testScoreGain`, docs/SCORING.md):
 * the estimated primary level now (every number's max × mastery) and
 * after the recommended numbers are mastered, each counted once. Both
 * are estimates, rounded HERE, once, to whole primary points; the «after»
 * level is rounded as a whole, so it never passes the exam's maximum.
 */
function planTestGain(
  subjectId: string | null,
  masteryOf: (examNumber: number) => number,
  recommendedNumbers: readonly (number | null)[],
): PersonalRecommendationsResponse['summary']['potentialTestPoints'] {
  const format = subjectId ? PLAN_FORMAT[subjectId] : undefined;
  const rules = format ? currentScoringRules(format) : null;
  if (!format || !rules) {
    return {
      available: false,
      reason:
        'Для этого предмета нет правил первичных баллов — прирост в баллах ЕГЭ не рассчитывается.',
    };
  }
  let current = 0;
  for (const [n, rule] of Object.entries(rules.tasks)) {
    if (rule.kind === 'expert') continue;
    current += rule.max * (masteryOf(Number(n)) / 100);
  }
  let potential = 0;
  for (const n of new Set(recommendedNumbers)) {
    if (n === null) continue;
    const max = maxPrimaryPoints(subjectId!, n);
    if (max !== null) potential += max * (1 - masteryOf(n) / 100);
  }
  const fromPrimary = Math.round(current);
  const toPrimary = Math.round(current + potential);
  const gain = testScoreGain(format, fromPrimary, toPrimary - fromPrimary);
  return gain.available
    ? {
        available: true,
        points: gain.gain,
        from: gain.from,
        to: gain.to,
        approximate: gain.status !== 'official',
        label: gain.label,
        ...(Object.values(rules.tasks).some((r) => r.kind === 'expert')
          ? { note: ESSAY_GAIN_NOTE }
          : {}),
      }
    : { available: false, reason: gain.reason };
}

function summaryOf(skill: SkillState, facts: readonly SkillAttemptFacts[]): SkillProgressSummary {
  const solved = new Set(facts.filter((f) => f.isCorrect).map((f) => f.taskId)).size;
  return {
    mastery: displayMastery(skill.level, skill.mastery),
    level: skill.level,
    confidence: skill.confidence,
    attempts: skill.attempts,
    solvedTasks: solved,
    accuracy: skill.attempts ? Math.round((skill.correct / skill.attempts) * 100) : null,
    incorrect: skill.incorrect,
    repeatedErrorTasks: skill.repeatedErrorTasks,
    trend: skill.trend,
  };
}

/**
 * «Твой персональный план»: the engine's recommendations, each with the
 * diagnosed cause and the student's progress, plus the header numbers.
 */
export async function getPersonalRecommendations(
  db: Database,
  userId: string,
  options: { subjectId?: string; limit?: number; now?: Date } = {},
): Promise<PersonalRecommendationsResponse> {
  const now = options.now ?? new Date();
  const [{ recommendations }, model] = await Promise.all([
    getRecommendations(db, userId, { subjectId: options.subjectId, limit: options.limit, now }),
    buildStudentModel(db, userId, now),
  ]);
  const facts = await loadSkillAttempts(
    db,
    userId,
    recommendations.map((r) => r.skillKey),
  );
  const skillOf = new Map(model.subjects.flatMap((s) => s.skills.map((k) => [k.key, k] as const)));
  const items: PersonalRecommendation[] = recommendations.map((r) => {
    const skill = skillOf.get(r.skillKey);
    const list = facts.get(r.skillKey) ?? [];
    const d = diagnoseSkill({ subjectId: r.subjectId, attempts: list });
    return {
      subjectId: r.subjectId,
      skillKey: r.skillKey,
      examNumber: r.examNumber,
      title: r.title,
      kind: r.kind,
      priority: r.priority,
      priorityLevel: priorityLevel(r.priority),
      reason: r.reason,
      problem: problemSummary(r.skillKey, d),
      progress: {
        mastery: skill ? displayMastery(skill.level, skill.mastery) : null,
        level: skill?.level ?? 'none',
        attempts: skill?.attempts ?? 0,
        accuracy: d.accuracy,
      },
      suggestedTasks: r.suggestedTasks,
      taskIds: r.taskIds,
    };
  });

  const potentialParts = items
    .filter((i) => i.priorityLevel !== 'low')
    .map((i) => {
      const max = maxPrimaryPoints(i.subjectId, i.examNumber);
      const mastery = skillOf.get(i.skillKey)?.mastery ?? 0;
      return max === null ? null : max * (1 - mastery / 100);
    })
    .filter((x): x is number => x !== null);
  const subjectOf = options.subjectId ?? items[0]?.subjectId ?? null;
  const masteryOf = (examNumber: number) =>
    model.subjects
      .find((s) => s.subjectId === subjectOf)
      ?.skills.find((k) => k.examNumber === examNumber)?.mastery ?? 0;
  const potentialTestPoints = planTestGain(
    subjectOf,
    masteryOf,
    items
      .filter((i) => i.priorityLevel !== 'low' && i.subjectId === subjectOf)
      .map((i) => i.examNumber),
  );
  const plans = await activePlanSummaries(db, userId, now);
  const plan = options.subjectId
    ? (plans.find((p) => p.subjectId === options.subjectId) ?? null)
    : (plans[0] ?? null);
  return {
    summary: {
      priorityTopics: items.filter((i) => i.priorityLevel !== 'low').length,
      potentialPrimaryPoints: potentialParts.length
        ? Math.max(1, Math.round(potentialParts.reduce((a, b) => a + b, 0)))
        : null,
      potentialTestPoints,
      etaDays: plan ? plan.daysLeft : items.length ? 7 : null,
      etaBasis: plan ? 'active_plan' : items.length ? 'week_plan' : null,
      activePlan: plan
        ? {
            id: plan.id,
            subjectId: plan.subjectId,
            kind: plan.kind,
            percent: plan.percent,
            today: plan.today,
          }
        : null,
    },
    recommendations: items,
  };
}

async function skillContext(db: Database, userId: string, skillKey: string, now: Date) {
  const info = examSkillInfo(skillKey);
  if (!info) return null;
  const model = await buildStudentModel(db, userId, now, { allSubjects: true });
  const skill = model.subjects
    .find((s) => s.subjectId === info.subjectId)
    ?.skills.find((k) => k.key === skillKey);
  if (!skill) return null;
  const facts = (await loadSkillAttempts(db, userId, [skillKey])).get(skillKey) ?? [];
  const diagnosis = diagnoseSkill({ subjectId: info.subjectId, attempts: facts });
  return { info, skill, facts, diagnosis };
}

/** «Подробнее»: the problem, the advice, the theory link and the stats. */
export async function getAdvice(
  db: Database,
  userId: string,
  skillKey: string,
  now: Date = new Date(),
): Promise<AdviceResponse | null> {
  const ctx = await skillContext(db, userId, skillKey, now);
  if (!ctx) return null;
  const { info, skill, facts, diagnosis } = ctx;
  const advice = adviceForSkill(skillKey, diagnosis.type, diagnosis.detail ?? null);
  return {
    skillKey,
    subjectId: info.subjectId,
    examNumber: info.examNumber,
    title: info.title,
    problem: problemSummary(skillKey, diagnosis),
    alsoProblems: diagnosis.also,
    advice,
    // Every math and Russian skill has a theory page: by number, or — for a
    // math topic no current number names — by topic.
    theory:
      advice.linksTheory && (info.examNumber !== null || info.subjectId === 'math')
        ? {
            subjectId: info.subjectId,
            taskNumber: info.examNumber,
            topic: info.examNumber === null ? skillKey : null,
            sections: advice.theorySections ?? [],
          }
        : null,
    stats: summaryOf(skill, facts),
    availableTasks: skill.availableTasks,
  };
}

/** Progress of one EGE number: stats, chart, dynamics, plan, history. */
export async function getSkillProgress(
  db: Database,
  userId: string,
  skillKey: string,
  now: Date = new Date(),
): Promise<SkillProgressResponse | null> {
  const ctx = await skillContext(db, userId, skillKey, now);
  if (!ctx) return null;
  const { info, skill, facts, diagnosis } = ctx;
  const tz = await userTimezone(db, userId);
  const today = localDateOf(now, tz);
  const dated = facts.map((f) => ({ isCorrect: f.isCorrect, date: localDateOf(f.createdAt, tz) }));
  const byDate = new Map<string, { attempts: number; correct: number }>();
  for (const d of dated) {
    const s = byDate.get(d.date) ?? { attempts: 0, correct: 0 };
    byDate.set(d.date, { attempts: s.attempts + 1, correct: s.correct + (d.isCorrect ? 1 : 0) });
  }
  const plans = await activePlanSummaries(db, userId, now);
  const plan = plans.find((p) => p.focus.some((f) => f.skillKey === skillKey)) ?? null;
  const focus = plan ? await planFocusView(db, plan, skillKey, now) : null;
  const planDays = plan?.days.filter((d) => d.skillKey === skillKey && d.activity !== 'rest') ?? [];
  return {
    skillKey,
    subjectId: info.subjectId,
    examNumber: info.examNumber,
    title: info.title,
    stats: summaryOf(skill, facts),
    problem: problemSummary(skillKey, diagnosis),
    dynamics: dynamicsOf(dated, today),
    series: accuracySeries(dated, today, 30),
    history: [...byDate.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 20)
      .map(([date, s]) => ({ date, ...s })),
    goal: {
      // The next level as shown: «developing» from 55 %, «strong» from 75 %.
      targetMastery: skill.level === 'strong' ? 90 : skill.level === 'developing' ? 75 : 55,
      planId: plan?.id ?? null,
    },
    plan: focus,
    planProgress: plan
      ? {
          done: planDays.filter((d) => d.status === 'done').length,
          total: planDays.length,
        }
      : null,
  };
}
