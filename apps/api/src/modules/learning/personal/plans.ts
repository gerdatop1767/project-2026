import type { Database, LearningPlanRow } from '@zybrilka/db';
import { loadPlanDays, localDateOf, planDayActuals, schema, userTimezone } from '@zybrilka/db';
import {
  ACTIVITY_STEPS,
  ACTIVITY_TITLES,
  MAX_MOVES,
  buildPlan,
  compareWithBaseline,
  dayStatus,
  diagnoseSkill,
  displayMastery,
  examSkillInfo,
  isValidTimezone,
  moveDay,
  planProgress,
  recalculatePlan,
  type DayActual,
  type PlanDayState,
  type PlanDayView,
  type PlanFocus,
  type PlanFocusView,
  type PlanKind,
  type PlanResponse,
  type ProblemType,
  type StudentModel,
} from '@zybrilka/shared';
import { and, desc, eq } from 'drizzle-orm';
import { buildStudentModel } from '../engine/model.js';
import { getRecommendations } from '../engine/service.js';
import { loadSkillAttempts } from './data.js';

const DAY_MS = 86_400_000;

interface Evaluated {
  readonly plan: LearningPlanRow;
  readonly days: readonly PlanDayState[];
  readonly actuals: ReadonlyMap<number, DayActual>;
  readonly today: string;
}

/**
 * Reads a plan with what was really done, applies the after-a-day
 * recalculation to future days (persisted only when something changed) and
 * completes a finished plan once (a conditional update — two readers at once
 * complete it a single time).
 */
async function evaluate(db: Database, plan: LearningPlanRow, now: Date): Promise<Evaluated> {
  const today = localDateOf(now, plan.timezone);
  const stored = await loadPlanDays(db, plan.id);
  const actuals = await planDayActuals(db, plan, stored);
  let days = stored;
  if (plan.status === 'active') {
    const next = recalculatePlan(stored, actuals, today);
    const changed = next.filter((d, i) => {
      const s = stored[i]!;
      return d.difficulty !== s.difficulty || d.targetTasks !== s.targetTasks;
    });
    for (const d of changed) {
      await db
        .update(schema.learningPlanDays)
        .set({ difficulty: d.difficulty, targetTasks: d.targetTasks, updatedAt: new Date() })
        .where(
          and(
            eq(schema.learningPlanDays.planId, plan.id),
            eq(schema.learningPlanDays.dayIndex, d.dayIndex),
          ),
        );
    }
    days = next;
    const progress = planProgress(days, actuals, today);
    if (progress.finished) {
      const [done] = await db
        .update(schema.learningPlans)
        .set({
          status: 'completed',
          completedAt: now,
          updatedAt: now,
          result: { progress, completedOn: today },
        })
        .where(and(eq(schema.learningPlans.id, plan.id), eq(schema.learningPlans.status, 'active')))
        .returning();
      if (done) plan = done;
    }
  }
  return { plan, days, actuals, today };
}

function dayView(e: Evaluated, d: PlanDayState): PlanDayView {
  const a = e.actuals.get(d.dayIndex) ?? { attempts: 0, correct: 0 };
  const status = dayStatus(d, a, e.today);
  const info = d.skillKey ? examSkillInfo(d.skillKey) : null;
  const open =
    e.plan.status === 'active' &&
    d.activity !== 'rest' &&
    d.date >= e.today &&
    (status === 'pending' || status === 'partial');
  return {
    dayIndex: d.dayIndex,
    date: d.date,
    skillKey: d.skillKey,
    skillTitle: info?.title ?? null,
    examNumber: info?.examNumber ?? null,
    activity: d.activity,
    activityTitle: ACTIVITY_TITLES[d.activity],
    steps: ACTIVITY_STEPS[d.activity],
    targetTasks: d.targetTasks,
    difficulty: d.difficulty,
    done: Math.min(a.attempts, d.targetTasks || a.attempts),
    correct: a.correct,
    status,
    canSkip: open,
    canMove: open && e.plan.movesUsed < MAX_MOVES[e.plan.kind],
  };
}

function focusViews(e: Evaluated, model: StudentModel): PlanFocusView[] {
  const skills = new Map(model.subjects.flatMap((s) => s.skills.map((k) => [k.key, k] as const)));
  return e.plan.focus.map((f) => {
    let attempts = 0;
    let correct = 0;
    for (const d of e.days) {
      if (d.skillKey !== f.skillKey) continue;
      const a = e.actuals.get(d.dayIndex);
      if (!a) continue;
      attempts += a.attempts;
      correct += a.correct;
    }
    const skill = skills.get(f.skillKey);
    const accuracyInPlan = attempts ? Math.round((correct / attempts) * 100) : null;
    const cmp = compareWithBaseline(
      { skillKey: f.skillKey, mastery: f.mastery, accuracy: f.accuracy, attempts: f.attempts },
      { mastery: skill?.mastery ?? f.mastery, accuracyInPlan, attemptsInPlan: attempts },
    );
    return {
      skillKey: f.skillKey,
      title: f.title,
      examNumber: f.examNumber,
      problem: f.problem as ProblemType,
      before: { mastery: f.mastery, accuracy: f.accuracy },
      now: {
        mastery: skill ? displayMastery(skill.level, skill.mastery) : null,
        accuracyInPlan,
        attemptsInPlan: attempts,
      },
      masteryDelta: cmp.enoughData ? cmp.masteryDelta : null,
      accuracyDelta: cmp.enoughData ? cmp.accuracyDelta : null,
      enoughData: cmp.enoughData,
    };
  });
}

function toResponse(e: Evaluated, model: StudentModel): PlanResponse {
  const progress = planProgress(e.days, e.actuals, e.today);
  return {
    id: e.plan.id,
    subjectId: e.plan.subjectId,
    kind: e.plan.kind,
    status: e.plan.status,
    startDate: e.days[0]?.date ?? e.plan.startDate,
    endDate: e.days[e.days.length - 1]?.date ?? e.plan.startDate,
    today: e.today,
    movesLeft: Math.max(0, MAX_MOVES[e.plan.kind] - e.plan.movesUsed),
    progress,
    focus: focusViews(e, model),
    days: e.days.map((d) => dayView(e, d)),
  };
}

/** A plan of this student — another student's plan id reads as not found. */
async function ownPlan(db: Database, userId: string, planId: string) {
  const [plan] = await db
    .select()
    .from(schema.learningPlans)
    .where(and(eq(schema.learningPlans.id, planId), eq(schema.learningPlans.userId, userId)));
  return plan ?? null;
}

export async function getPlan(
  db: Database,
  userId: string,
  planId: string,
  now: Date = new Date(),
): Promise<PlanResponse | null> {
  const plan = await ownPlan(db, userId, planId);
  if (!plan) return null;
  const [e, model] = await Promise.all([
    evaluate(db, plan, now),
    buildStudentModel(db, userId, now, { allSubjects: true }),
  ]);
  return toResponse(e, model);
}

/** The active plan of a subject, or the most recent finished one. */
export async function getCurrentPlan(
  db: Database,
  userId: string,
  subjectId: string,
  now: Date = new Date(),
): Promise<PlanResponse | null> {
  const [plan] = await db
    .select()
    .from(schema.learningPlans)
    .where(
      and(eq(schema.learningPlans.userId, userId), eq(schema.learningPlans.subjectId, subjectId)),
    )
    .orderBy(desc(schema.learningPlans.createdAt))
    .limit(1);
  if (!plan || plan.status === 'cancelled') return null;
  return getPlan(db, userId, plan.id, now);
}

export interface ActivePlanSummary {
  readonly id: string;
  readonly subjectId: string;
  readonly kind: PlanKind;
  readonly percent: number;
  readonly daysLeft: number;
  readonly today: PlanDayView | null;
  readonly days: readonly PlanDayView[];
  readonly focus: LearningPlanRow['focus'];
  readonly evaluated: Evaluated;
}

export async function activePlanSummaries(
  db: Database,
  userId: string,
  now: Date,
): Promise<ActivePlanSummary[]> {
  const plans = await db
    .select()
    .from(schema.learningPlans)
    .where(and(eq(schema.learningPlans.userId, userId), eq(schema.learningPlans.status, 'active')))
    .orderBy(desc(schema.learningPlans.createdAt));
  const out: ActivePlanSummary[] = [];
  for (const p of plans) {
    const e = await evaluate(db, p, now);
    if (e.plan.status !== 'active') continue;
    const views = e.days.map((d) => dayView(e, d));
    const end = e.days[e.days.length - 1]?.date ?? e.today;
    out.push({
      id: p.id,
      subjectId: p.subjectId,
      kind: p.kind,
      percent: planProgress(e.days, e.actuals, e.today).percent,
      daysLeft: Math.max(
        0,
        Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${e.today}T00:00:00Z`)) / DAY_MS) +
          1,
      ),
      today: views.find((d) => d.date === e.today && d.activity !== 'rest') ?? null,
      days: views,
      focus: p.focus,
      evaluated: e,
    });
  }
  return out;
}

export async function planFocusView(
  db: Database,
  summary: ActivePlanSummary,
  skillKey: string,
  now: Date,
): Promise<PlanFocusView | null> {
  const model = await buildStudentModel(
    db,
    (summary.evaluated.plan as LearningPlanRow).userId,
    now,
    {
      allSubjects: true,
    },
  );
  return focusViews(summary.evaluated, model).find((f) => f.skillKey === skillKey) ?? null;
}

export type CreatePlanResult =
  | { ok: true; plan: PlanResponse }
  | { ok: false; error: 'plan_exists' | 'no_focus' | 'unknown_subject' };

/**
 * A new plan from the student's own data: the week targets the most urgent
 * number, the month up to three. Focus numbers come from the same
 * recommendations the student sees; each keeps its starting point.
 */
export async function createPlan(
  db: Database,
  userId: string,
  input: { subjectId: string; kind: PlanKind; replace?: boolean; timezone?: string },
  now: Date = new Date(),
): Promise<CreatePlanResult> {
  const model = await buildStudentModel(db, userId, now, { allSubjects: true });
  const subject = model.subjects.find((s) => s.subjectId === input.subjectId);
  if (!subject) return { ok: false, error: 'unknown_subject' };
  const { recommendations } = await getRecommendations(db, userId, {
    subjectId: input.subjectId,
    limit: input.kind === 'week' ? 3 : 6,
    now,
  });
  const chosen = recommendations.slice(0, input.kind === 'week' ? 1 : 3);
  if (chosen.length === 0) return { ok: false, error: 'no_focus' };
  const facts = await loadSkillAttempts(
    db,
    userId,
    chosen.map((c) => c.skillKey),
  );
  const skills = new Map(subject.skills.map((k) => [k.key, k] as const));
  const since = now.getTime() - 30 * DAY_MS;
  const focus: PlanFocus[] = chosen.map((c) => {
    const skill = skills.get(c.skillKey)!;
    const list = facts.get(c.skillKey) ?? [];
    const recent = list.filter((f) => f.createdAt.getTime() >= since);
    return {
      skillKey: c.skillKey,
      subjectId: c.subjectId,
      title: c.title,
      examNumber: c.examNumber,
      problem: diagnoseSkill({ subjectId: c.subjectId, attempts: list }).type,
      mastery: skill.mastery,
      accuracy: recent.length
        ? Math.round((recent.filter((f) => f.isCorrect).length / recent.length) * 100)
        : null,
      attempts: skill.attempts,
      availableTasks: skill.availableTasks,
    };
  });
  const timezone =
    input.timezone && isValidTimezone(input.timezone)
      ? input.timezone
      : await userTimezone(db, userId);
  const startDate = localDateOf(now, timezone);
  const days = buildPlan({ kind: input.kind, focus, startDate });
  if (days.length === 0) return { ok: false, error: 'no_focus' };

  try {
    const planId = await db.transaction(async (tx) => {
      if (input.replace) {
        await tx
          .update(schema.learningPlans)
          .set({ status: 'cancelled', updatedAt: now })
          .where(
            and(
              eq(schema.learningPlans.userId, userId),
              eq(schema.learningPlans.subjectId, input.subjectId),
              eq(schema.learningPlans.status, 'active'),
            ),
          );
      }
      const [plan] = await tx
        .insert(schema.learningPlans)
        .values({
          userId,
          subjectId: input.subjectId,
          kind: input.kind,
          startDate,
          timezone,
          focus,
        })
        .returning({ id: schema.learningPlans.id });
      await tx.insert(schema.learningPlanDays).values(
        days.map((d) => ({
          planId: plan!.id,
          dayIndex: d.dayIndex,
          date: d.date,
          skillKey: d.skillKey,
          activity: d.activity,
          targetTasks: d.targetTasks,
          difficulty: d.difficulty,
        })),
      );
      return plan!.id;
    });
    const plan = await getPlan(db, userId, planId, now);
    return { ok: true, plan: plan! };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: 'plan_exists' };
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  let e: unknown = error;
  for (let i = 0; i < 4 && e; i++) {
    if ((e as { code?: string }).code === '23505') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

export type DayActionResult =
  { ok: true; plan: PlanResponse } | { ok: false; error: 'not_found' | 'not_allowed' };

export async function skipPlanDay(
  db: Database,
  userId: string,
  planId: string,
  dayIndex: number,
  now: Date = new Date(),
): Promise<DayActionResult> {
  const plan = await ownPlan(db, userId, planId);
  if (!plan) return { ok: false, error: 'not_found' };
  const e = await evaluate(db, plan, now);
  const day = e.days.find((d) => d.dayIndex === dayIndex);
  if (!day) return { ok: false, error: 'not_found' };
  if (!dayView(e, day).canSkip) return { ok: false, error: 'not_allowed' };
  await db
    .update(schema.learningPlanDays)
    .set({ skipped: true, updatedAt: now })
    .where(
      and(
        eq(schema.learningPlanDays.planId, planId),
        eq(schema.learningPlanDays.dayIndex, dayIndex),
      ),
    );
  return { ok: true, plan: (await getPlan(db, userId, planId, now))! };
}

export async function movePlanDay(
  db: Database,
  userId: string,
  planId: string,
  dayIndex: number,
  now: Date = new Date(),
): Promise<DayActionResult> {
  const plan = await ownPlan(db, userId, planId);
  if (!plan) return { ok: false, error: 'not_found' };
  const e = await evaluate(db, plan, now);
  const day = e.days.find((d) => d.dayIndex === dayIndex);
  if (!day) return { ok: false, error: 'not_found' };
  if (!dayView(e, day).canMove) return { ok: false, error: 'not_allowed' };
  const moved = moveDay(e.days, dayIndex, e.today, plan.movesUsed, plan.kind);
  if (!moved) return { ok: false, error: 'not_allowed' };
  await db.transaction(async (tx) => {
    // Optimistic guard: the move counts only if nobody moved in between.
    const [claimed] = await tx
      .update(schema.learningPlans)
      .set({ movesUsed: plan.movesUsed + 1, updatedAt: now })
      .where(
        and(
          eq(schema.learningPlans.id, planId),
          eq(schema.learningPlans.movesUsed, plan.movesUsed),
          eq(schema.learningPlans.status, 'active'),
        ),
      )
      .returning({ id: schema.learningPlans.id });
    if (!claimed) return;
    for (const d of moved) {
      if (d.dayIndex < dayIndex) continue;
      await tx
        .update(schema.learningPlanDays)
        .set({ date: d.date, updatedAt: now })
        .where(
          and(
            eq(schema.learningPlanDays.planId, planId),
            eq(schema.learningPlanDays.dayIndex, d.dayIndex),
          ),
        );
    }
  });
  return { ok: true, plan: (await getPlan(db, userId, planId, now))! };
}

export async function cancelPlan(
  db: Database,
  userId: string,
  planId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const rows = await db
    .update(schema.learningPlans)
    .set({ status: 'cancelled', updatedAt: now })
    .where(
      and(
        eq(schema.learningPlans.id, planId),
        eq(schema.learningPlans.userId, userId),
        eq(schema.learningPlans.status, 'active'),
      ),
    )
    .returning({ id: schema.learningPlans.id });
  return rows.length > 0;
}
