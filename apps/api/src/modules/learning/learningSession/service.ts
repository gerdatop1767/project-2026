import type { Database } from '@zybrilka/db';
import {
  detectErrorSignatures,
  parseMultiPartSpec,
  parseMultiPartUserAnswer,
  type MultiPartSpec,
  type VariantAttemptDetail,
  type VariantAttemptGroup,
  type VariantAttemptTask,
  type VariantTaskOutcome,
  type LearningSessionResponse,
  type LearningSessionSummary,
  type VariantProgressItem,
  type VariantProgressResponse,
} from '@zybrilka/shared';
import { getLearningPath } from '../learningPath/service.js';
import { resolveSubjectId } from '../recommendation/service.js';
import { buildDetectionInput } from '../errorSignatures/service.js';
import { getVariantDetail } from '../../variants/service.js';
import * as tasksRepo from '../../tasks/repo.js';
import { toPublicTask } from '../../tasks/service.js';
import * as repo from './repo.js';

export interface StartLearningSessionContext {
  readonly subjectId?: string;
  /** Already validated at the route layer (1..10). */
  readonly total: number;
  /** Smart Training's 🔄/🎲 — persisted on the session (see the DB
   * schema's doc comment) so every `next` step applies the same
   * filter/selection the session was started with. */
  readonly unseenOnly?: boolean;
  readonly randomizeTopTier?: boolean;
}

/**
 * ZUBRILKA LEARNING INTELLIGENCE, Phase 9 — the learning-session
 * engine. A session is pure bookkeeping over the EXISTING deterministic
 * stack: it never computes its own score, never caches a
 * recommendation across steps, and never writes to `attempts`,
 * `mistakes`, `user_skill_statistics`, `task_statistics`, or
 * `user_error_statistics` — the real attempt-submission transaction
 * (`modules/tasks/service.ts#submitAttempt`) remains the ONLY writer
 * of learning state. Every step (start and `next` alike) asks Phase 8's
 * `getLearningPath` for exactly ONE fresh-scored task
 * (`limit: 1`), excluding whatever this session has already served —
 * so if the user just got something wrong (or right), the very next
 * call sees the already-updated mastery/error/difficulty numbers,
 * because it re-reads them from scratch every time.
 */
export async function startLearningSession(
  db: Database,
  userId: string,
  context: StartLearningSessionContext,
): Promise<LearningSessionResponse> {
  const subjectId = await resolveSubjectId(db, userId, { subjectId: context.subjectId });
  if (!subjectId) return null;

  const path = await getLearningPath(db, userId, {
    subjectId,
    limit: 1,
    unseenOnly: context.unseenOnly,
    randomizeTopTier: context.randomizeTopTier,
  });
  if (!path || path.steps.length === 0) return null;

  const firstStep = path.steps[0]!;
  const session = await repo.createSession(db, {
    userId,
    subjectId,
    total: context.total,
    firstTaskId: firstStep.task.id,
    unseenOnly: context.unseenOnly,
    randomizeTopTier: context.randomizeTopTier,
  });

  return {
    sessionId: session.id,
    subject: subjectId,
    status: 'active',
    position: 1,
    total: session.total,
    task: firstStep.task,
    recommendation: {
      score: firstStep.score,
      reason: firstStep.reason,
      breakdown: firstStep.breakdown,
    },
  };
}

/**
 * Training's "Вариант" mode — starts a VARIANT session over ONE real,
 * published exam variant's own real task order (never a recommendation:
 * `plannedTaskIds` is the variant's own `position` order, fixed for the
 * session's lifetime). Reuses every bit of Phase 9's bookkeeping
 * (consumedTaskIds/status/started-/completedAt, `next`/snapshot/
 * completion) — the only thing that differs is where the next task
 * comes from (see `advanceLearningSession` below), never a parallel
 * entity or a second completion screen.
 */
export async function startVariantSession(
  db: Database,
  userId: string,
  variantId: string,
): Promise<LearningSessionResponse> {
  const detail = await getVariantDetail(db, variantId);
  if (!detail || detail.tasks.length === 0) return null;

  const orderedTasks = [...detail.tasks].sort((a, b) => a.position - b.position);
  const plannedTaskIds = orderedTasks.map((t) => t.task.id);
  const firstTask = orderedTasks[0]!.task;

  const session = await repo.createSession(db, {
    userId,
    subjectId: detail.collection.subjectId,
    total: plannedTaskIds.length,
    firstTaskId: firstTask.id,
    variantId,
    plannedTaskIds,
  });

  return {
    sessionId: session.id,
    subject: session.subjectId,
    status: 'active',
    position: 1,
    total: session.total,
    task: firstTask,
    variant: {
      variantId,
      variantNumber: detail.variant.variantNumber,
      variantTitle: detail.variant.title,
    },
  };
}

/** `null` means "no such session, or it does not belong to this user"
 * — both map to the same outer 404, never distinguishing between them,
 * so a session id can't be used to probe whether it exists for someone
 * else (same privacy posture as every other `/me/*` endpoint). */
export async function advanceLearningSession(
  db: Database,
  userId: string,
  sessionId: string,
): Promise<LearningSessionResponse> {
  const session = await repo.getSessionById(db, sessionId);
  if (!session || session.userId !== userId) return null;

  if (session.status === 'completed') {
    // Idempotent: asking for "next" again on a finished session just
    // re-returns its summary, never an error.
    return buildCompletedResponse(db, session);
  }

  // A variant's tasks can all be opened before the last one is reached —
  // it ends after its last planned task instead (below).
  if (!session.plannedTaskIds && session.consumedTaskIds.length >= session.total) {
    const completed = await repo.markCompleted(db, session.id);
    return buildCompletedResponse(db, completed);
  }

  // VARIANT session — the next task is the variant's own fixed real
  // order, never a fresh `getLearningPath` scoring: the one after the
  // current task in the plan. Tasks may be opened in any order (see
  // `openVariantTask`), so "next" follows the plan from where the student
  // is, not from how many tasks were served; after the last one the
  // variant is finished.
  if (session.plannedTaskIds) {
    const nextTaskId = nextPlannedTask(session);
    if (!nextTaskId) {
      const completed = await repo.markCompleted(db, session.id);
      return buildCompletedResponse(db, completed);
    }
    const row = await tasksRepo.getTaskById(db, nextTaskId);
    if (!row) {
      // The task was pulled back to draft/removed mid-session — an
      // honest early completion rather than crashing or serving a gap.
      const completed = await repo.markCompleted(db, session.id);
      return buildCompletedResponse(db, completed);
    }
    const updated = await repo.focusVariantTask(db, session.id, userId, nextTaskId);
    if (!updated) return null;
    return activeVariantResponse(db, updated, row);
  }

  const path = await getLearningPath(db, userId, {
    subjectId: session.subjectId,
    limit: 1,
    excludeTaskIds: session.consumedTaskIds,
    unseenOnly: session.unseenOnly,
    randomizeTopTier: session.randomizeTopTier,
  });

  if (!path || path.steps.length === 0) {
    // No valid candidate remains in the subject — an honest early
    // completion, not an error (Phase 9's "no-candidate completion" rule).
    const completed = await repo.markCompleted(db, session.id);
    return buildCompletedResponse(db, completed);
  }

  const step = path.steps[0]!;
  const updated = await repo.appendConsumedTask(db, session.id, step.task.id);

  return {
    sessionId: updated.id,
    subject: updated.subjectId,
    status: 'active',
    position: updated.consumedTaskIds.length,
    total: updated.total,
    task: step.task,
    recommendation: { score: step.score, reason: step.reason, breakdown: step.breakdown },
  };
}

/**
 * ZUBRILKA LEARNING INTELLIGENCE, Phase 10 — read-only session
 * recovery (page refresh / direct link to `/learning/session/:id`).
 * Unlike `advanceLearningSession`, this NEVER consumes a new task slot
 * and NEVER re-runs scoring — it just reports the CURRENT state: the
 * last task this session already served (or, once completed, the same
 * real summary `advanceLearningSession` would return). This is the
 * smallest safe backend addition for frontend refresh-safety: without
 * it, a page reload on an active session would have no way to recover
 * "which task was I on" without either inventing client-only state
 * (which could desync from the server) or wrongly calling `/next`
 * (which WOULD consume another task slot just because the user
 * reloaded, violating Phase 9's "next only after a real submission"
 * rule). `recommendation` is intentionally omitted here (see the DTO) —
 * recovering it would require re-scoring, which this endpoint must
 * never do.
 */
export async function getLearningSessionSnapshot(
  db: Database,
  userId: string,
  sessionId: string,
): Promise<LearningSessionResponse> {
  const session = await repo.getSessionById(db, sessionId);
  if (!session || session.userId !== userId) return null;

  if (session.status === 'completed') {
    return buildCompletedResponse(db, session);
  }

  const currentTaskId = session.consumedTaskIds[session.consumedTaskIds.length - 1];
  if (!currentTaskId) return null;

  const row = await tasksRepo.getTaskById(db, currentTaskId);
  if (!row) return null;

  if (session.plannedTaskIds) return activeVariantResponse(db, session, row);

  return {
    sessionId: session.id,
    subject: session.subjectId,
    status: 'active',
    position: session.consumedTaskIds.length,
    total: session.total,
    task: toPublicTask(row),
  };
}

/** The planned task after the current (last served) one, or null after
 * the last. */
function nextPlannedTask(session: repo.LearningSessionRow): string | null {
  const planned = session.plannedTaskIds ?? [];
  const current = session.consumedTaskIds[session.consumedTaskIds.length - 1];
  const index = current === undefined ? -1 : planned.indexOf(current);
  return planned[index + 1] ?? null;
}

/** A variant's position is the current task's place in the plan (1-based)
 * — the same number the sequential flow always reported. */
async function activeVariantResponse(
  db: Database,
  session: repo.LearningSessionRow,
  row: NonNullable<Awaited<ReturnType<typeof tasksRepo.getTaskById>>>,
): Promise<LearningSessionResponse> {
  const index = (session.plannedTaskIds ?? []).indexOf(row.task.id);
  return {
    sessionId: session.id,
    subject: session.subjectId,
    status: 'active',
    position: index >= 0 ? index + 1 : session.consumedTaskIds.length,
    total: session.total,
    task: toPublicTask(row),
    variant: await variantInfoFor(db, session),
  };
}

/**
 * A VARIANT session: open any of its planned tasks, in any order (the
 * number panel). Opening only serves the task — nothing is answered or
 * counted by it, and opening it again changes nothing but which task is
 * current. `null`: not this user's active variant session, or a task the
 * variant does not contain (both a 404 outside).
 */
export async function openVariantTask(
  db: Database,
  userId: string,
  sessionId: string,
  taskId: string,
): Promise<LearningSessionResponse> {
  const row = await tasksRepo.getTaskById(db, taskId);
  if (!row) return null;
  const updated = await repo.focusVariantTask(db, sessionId, userId, taskId);
  if (!updated) return null;
  return activeVariantResponse(db, updated, row);
}

/**
 * «Завершить вариант»: finishes a variant session now, whatever order its
 * tasks were solved in and however many are left (they count as not
 * answered). Idempotent: a finished one just returns its summary again.
 */
export async function finishVariantSession(
  db: Database,
  userId: string,
  sessionId: string,
): Promise<LearningSessionResponse> {
  const session = await repo.getSessionById(db, sessionId);
  if (!session || session.userId !== userId || !session.plannedTaskIds) return null;
  if (session.status === 'completed') return buildCompletedResponse(db, session);
  return buildCompletedResponse(db, await repo.markCompleted(db, session.id));
}

async function variantInfoFor(
  db: Database,
  session: repo.LearningSessionRow,
): Promise<{ variantId: string; variantNumber: number; variantTitle: string } | undefined> {
  if (!session.variantId) return undefined;
  const identity = await repo.getVariantIdentity(db, session.variantId);
  if (!identity) return undefined;
  return {
    variantId: session.variantId,
    variantNumber: identity.variantNumber,
    variantTitle: identity.title,
  };
}

async function buildCompletedResponse(
  db: Database,
  session: repo.LearningSessionRow,
): Promise<LearningSessionResponse> {
  const [summary, variant] = await Promise.all([
    computeSessionSummary(db, session),
    variantInfoFor(db, session),
  ]);
  return {
    sessionId: session.id,
    subject: session.subjectId,
    status: 'completed',
    position: session.consumedTaskIds.length,
    total: session.total,
    summary,
    variant,
  };
}

/** Every field here is computed directly from real `attempts`/
 * `mistakes`/`task_skills` rows — see `repo.ts`'s queries. No metric
 * that can't be honestly attributed to this session's own task set and
 * time window is included (per Phase 9's "do not invent metrics" rule). */
async function computeSessionSummary(
  db: Database,
  session: repo.LearningSessionRow,
): Promise<LearningSessionSummary> {
  const taskIds = session.consumedTaskIds;
  if (taskIds.length === 0) {
    return {
      attempted: 0,
      correct: 0,
      incorrect: 0,
      accuracy: null,
      skillsPracticed: 0,
      mistakesCreated: 0,
    };
  }

  const [{ rows }, mistakesCreated] = await Promise.all([
    repo.getAnswersOfSession(db, session),
    repo.countMistakesCreatedSince(db, session.userId, taskIds, session.startedAt),
  ]);

  const attemptedTaskIds = new Set(rows.map((a) => a.taskId));
  // A variant is an exam: its FIRST answer to a task counts. Smart
  // training counts a task correct once any answer to it was.
  const correctTaskIds = session.variantId
    ? new Set([...firstAnswers(rows).values()].filter((a) => a.isCorrect).map((a) => a.taskId))
    : new Set(rows.filter((a) => a.isCorrect).map((a) => a.taskId));
  const incorrectTaskIds = [...attemptedTaskIds].filter((id) => !correctTaskIds.has(id));

  const attempted = attemptedTaskIds.size;
  const correct = correctTaskIds.size;
  const incorrect = incorrectTaskIds.length;
  const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : null;

  const skillIds = await repo.getSkillIdsForTasks(db, [...attemptedTaskIds]);
  const skillsPracticed = new Set(skillIds).size;

  return { attempted, correct, incorrect, accuracy, skillsPracticed, mistakesCreated };
}

/**
 * Statistics' "Статистика вариантов" — every variant session this user
 * has ever started, ANY status. An abandoned (still `active`) one
 * shows its real partial numbers too (never excluded, never faked as
 * finished) — only the Variant Completion SCREEN cares about `status
 * === 'completed'`; this history list is honest either way.
 */
export async function getVariantProgress(
  db: Database,
  userId: string,
): Promise<VariantProgressResponse> {
  const sessions = await repo.getVariantSessionsForUser(db, userId);
  const items = await Promise.all(sessions.map((session) => toVariantProgressItem(db, session)));
  return { items };
}

async function toVariantProgressItem(
  db: Database,
  session: repo.VariantSessionRow,
): Promise<VariantProgressItem> {
  const summary = await computeSessionSummary(db, session);

  const { rows: attemptRows } = await repo.getAnswersOfSession(db, session);

  // Time of each task's first answer — the one that counts.
  const timedRows = [...firstAnswers(attemptRows).values()].filter(
    (r): r is typeof r & { timeSpentMs: number } => r.timeSpentMs !== null,
  );
  const totalTimeMs =
    timedRows.length === 0 ? null : timedRows.reduce((sum, r) => sum + r.timeSpentMs, 0);

  // Key errors — the exact same deterministic detector the global
  // /me/learning/errors feed and task-number detail use, scoped to
  // this session's own attempts.
  const errorCounts = new Map<string, number>();
  for (const row of attemptRows) {
    for (const sig of detectErrorSignatures(buildDetectionInput(row))) {
      errorCounts.set(sig.code, (errorCounts.get(sig.code) ?? 0) + 1);
    }
  }
  const keyErrors = Array.from(errorCounts.entries())
    .map(([signature, count]) => ({ signature, count }))
    .sort((a, b) => b.count - a.count);

  return {
    sessionId: session.id,
    variantId: session.variantId,
    variantNumber: session.variantNumber,
    variantTitle: session.variantTitle,
    subjectId: session.subjectId,
    status: session.status,
    startedAt: session.startedAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
    plannedCount: session.total,
    solvedCount: summary.attempted,
    correctCount: summary.correct,
    incorrectCount: summary.incorrect,
    accuracyPercent: summary.accuracy,
    totalTimeMs,
    keyErrors,
  };
}

/** Each task's first answer in the session (rows come oldest first). */
function firstAnswers<T extends { taskId: string }>(rows: readonly T[]): Map<string, T> {
  const first = new Map<string, T>();
  for (const row of rows) if (!first.has(row.taskId)) first.set(row.taskId, row);
  return first;
}

/** An answer the way the user typed it; a multi-part one as «а) 3; б) 5». */
function answerForDisplay(
  answerRaw: string,
  answerType: string,
  spec: MultiPartSpec | null,
): string {
  if (answerType !== 'multi_part') return answerRaw;
  const parsed = parseMultiPartUserAnswer(answerRaw);
  if (!parsed) return answerRaw;
  const labelOf = new Map(spec?.parts.map((p) => [p.id, p.label]) ?? []);
  return Object.entries(parsed)
    .map(([id, value]) => `${labelOf.get(id) ?? id} ${value}`)
    .join('; ');
}

function correctForDisplay(task: repo.PlannedTaskRow, spec: MultiPartSpec | null): string {
  if (task.correctAnswerDisplay) return task.correctAnswerDisplay;
  if (task.answerType === 'multi_part' && spec) {
    return spec.parts.map((p) => `${p.label} ${p.correctAnswer}`).join('; ');
  }
  return task.correctAnswer;
}

function groupBy(
  tasks: readonly VariantAttemptTask[],
  keyOf: (t: VariantAttemptTask) => string | null,
): VariantAttemptGroup[] {
  const groups = new Map<string, { correct: number; total: number }>();
  for (const task of tasks) {
    const key = keyOf(task);
    if (key === null) continue;
    const g = groups.get(key) ?? { correct: 0, total: 0 };
    g.total += 1;
    if (task.outcome === 'correct') g.correct += 1;
    groups.set(key, g);
  }
  return [...groups.entries()].map(([key, g]) => ({ key, ...g }));
}

/**
 * GET /progress/variants/:sessionId — the full result of ONE attempt of a
 * variant. `null` unless it is this user's own variant session: someone
 * else's attempt is indistinguishable from a missing one.
 */
export async function getVariantAttemptDetail(
  db: Database,
  userId: string,
  sessionId: string,
): Promise<VariantAttemptDetail | null> {
  const session = await repo.getSessionById(db, sessionId);
  if (!session || session.userId !== userId || !session.variantId || !session.plannedTaskIds) {
    return null;
  }
  const [identity, planned, answers] = await Promise.all([
    repo.getVariantIdentity(db, session.variantId),
    repo.getPlannedTasks(db, session.plannedTaskIds),
    repo.getAnswersOfSession(db, session),
  ]);
  if (!identity) return null;
  const taskOf = new Map(planned.map((t) => [t.taskId, t]));
  const first = firstAnswers(answers.rows);
  const answerCount = new Map<string, number>();
  for (const row of answers.rows)
    answerCount.set(row.taskId, (answerCount.get(row.taskId) ?? 0) + 1);
  const served = new Set(session.consumedTaskIds);

  const tasks: VariantAttemptTask[] = [];
  session.plannedTaskIds.forEach((taskId, index) => {
    const task = taskOf.get(taskId);
    if (!task) return; // removed from the catalogue since
    const spec = task.answerType === 'multi_part' ? parseMultiPartSpec(task.correctAnswer) : null;
    const answer = first.get(taskId);
    tasks.push({
      position: index + 1,
      taskId,
      taskNumber: task.taskNumber,
      topic: task.topic,
      outcome: answer
        ? answer.isCorrect
          ? 'correct'
          : 'incorrect'
        : served.has(taskId)
          ? 'skipped'
          : 'not_reached',
      userAnswer: answer ? answerForDisplay(answer.answerRaw, task.answerType, spec) : null,
      correctAnswer: correctForDisplay(task, spec),
      explanationMd: task.explanationMd,
      answers: answerCount.get(taskId) ?? 0,
      timeSpentMs: answer?.timeSpentMs ?? null,
    });
  });

  const count = (outcome: VariantTaskOutcome) => tasks.filter((t) => t.outcome === outcome).length;
  const correctCount = count('correct');
  const incorrectCount = count('incorrect');
  const answered = correctCount + incorrectCount;
  const timed = tasks.filter((t) => t.timeSpentMs !== null);
  return {
    sessionId: session.id,
    variantId: session.variantId,
    variantNumber: identity.variantNumber,
    variantTitle: identity.title,
    subjectId: session.subjectId,
    status: session.status,
    startedAt: session.startedAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
    attribution: answers.attribution,
    plannedCount: session.plannedTaskIds.length,
    correctCount,
    incorrectCount,
    skippedCount: count('skipped'),
    notReachedCount: count('not_reached'),
    accuracyPercent: answered > 0 ? Math.round((correctCount / answered) * 100) : null,
    totalTimeMs: timed.length > 0 ? timed.reduce((sum, t) => sum + t.timeSpentMs!, 0) : null,
    timedCount: timed.length,
    byTaskNumber: groupBy(tasks, (t) => String(t.taskNumber)),
    byTopic: groupBy(tasks, (t) => t.topic),
    tasks,
    toRepeat: tasks
      .filter((t) => t.outcome === 'incorrect' || t.outcome === 'skipped')
      .map((t) => ({ taskId: t.taskId, taskNumber: t.taskNumber, topic: t.topic })),
  };
}
