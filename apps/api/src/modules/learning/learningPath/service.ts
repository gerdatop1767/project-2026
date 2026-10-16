import type { Database } from '@zybrilka/db';
import {
  calculateDifficultyFit,
  calculateErrorRelevance,
  calculateExamImportance,
  calculateRecency,
  calculateSimilarityBonus,
  calculateSkillCoverageNeed,
  calculateTargetGap,
  calculateTargetRelevance,
  calculateTaskNumberNeed,
  calculateTaskSimilarity,
  combineRecommendationSignals,
  compareLearningPathCandidates,
  getComparableDifficulty,
  resolveStepIdealDifficulty,
  type LearningPathResponseOrNull,
  type LearningPathStep,
  type RecommendationBreakdown,
  type RecommendationSignal,
  type RelevantErrorAnswerType,
  type TaskSimilarityInput,
} from '@zybrilka/shared';
import * as learningProfileRepo from '../../learningProfile/repo.js';
import * as tasksRepo from '../../tasks/repo.js';
import { toPublicTask } from '../../tasks/service.js';
import * as errorStatsRepo from '../errorSignatures/repo.js';
import * as recommendationRepo from '../recommendation/repo.js';
import { resolveSubjectId } from '../recommendation/service.js';
import { getTaskMetadataForSimilarity } from '../taskSimilarity/repo.js';
import { toSimilarityInput } from '../taskSimilarity/service.js';
import * as repo from './repo.js';

export interface GetLearningPathContext {
  readonly subjectId?: string;
  /** Already validated at the route layer (1..10). */
  readonly limit: number;
  /** Additive, optional (Phase 9 reuse): task ids to hard-exclude from
   * the servable pool before scoring, on top of the existing
   * already-correctly-attempted exclusion. Used by the learning-session
   * engine so a session never re-serves a task it already showed, even
   * in the "everything else is solved" fallback case. Omitted (or
   * empty) leaves Phase 8's own behavior completely unchanged. */
  readonly excludeTaskIds?: readonly string[];
  /** Additive, optional (Smart Training's 🔄 "Только нерешённые"):
   * hard-excludes any task the user has EVER attempted (correct or
   * not), not just the already-correctly-solved exclusion above.
   * Omitted (or false) leaves the existing behavior unchanged — every
   * scoring formula below is identical either way, this only narrows
   * the candidate pool before scoring starts. */
  readonly unseenOnly?: boolean;
  /** Additive, optional (Smart Training's 🎲 "Случайное"): at each
   * step, picks randomly among the top-scoring tier of candidates
   * instead of always the strict top-1. Touches nothing about how
   * candidates are scored — only which already-scored candidate is
   * taken at the end of each step. Omitted (or false) leaves the
   * existing strict top-1 selection unchanged. */
  readonly randomizeTopTier?: boolean;
}

/** How many of the top-scored candidates `randomizeTopTier` picks
 * randomly among, at each step — small enough that "random" still
 * means "one of the genuinely best options", never an arbitrary pick
 * from the whole remaining pool. */
const RANDOMIZE_TOP_TIER_SIZE = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** How many of the user's most recently correctly-solved tasks feed
 * `similarityBonus`'s reference pool, alongside open mistakes and
 * previously selected steps — bounded so one very active user can't
 * make every candidate's similarity check scan an unbounded history. */
const RECENT_SOLVED_REFERENCE_LIMIT = 5;

const STEP_SIGNAL_LABELS: Record<RecommendationSignal, string> = {
  skillNeed: 'укрепляем навык с низкой освоенностью',
  taskNumberNeed: 'закрепляем номер задания, где вы часто ошибаетесь',
  errorRelevance: 'повторяем тип ошибки, который вы часто допускаете',
  difficultyFit: 'сложность соответствует вашему текущему уровню',
  targetRelevance: 'приближает к целевому баллу',
  recency: 'эта тема давно не практиковалась',
  examImportance: 'часто встречается в реальном ЕГЭ',
  similarityBonus: 'похожа на уже решённую или выбранную задачу — проверяем перенос навыка',
};

/** Same shape of reasoning as Phase 7's `buildReason` (two highest
 * AVAILABLE signals, deterministically tie-broken), phrased per-step. */
function buildStepReason(
  position: number,
  breakdown: RecommendationBreakdown,
  total: number,
): string {
  const included = (
    Object.entries(breakdown) as [
      RecommendationSignal,
      RecommendationBreakdown[RecommendationSignal],
    ][]
  )
    .filter(([, entry]) => entry.included && entry.score !== null)
    .sort((a, b) => {
      const scoreDiff = (b[1].score ?? 0) - (a[1].score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      const weightDiff = b[1].weight - a[1].weight;
      if (weightDiff !== 0) return weightDiff;
      return a[0].localeCompare(b[0]);
    });

  if (included.length === 0) {
    return `Шаг ${position} (score ${total}): недостаточно данных — задача из общего каталога.`;
  }

  const reasons = included.slice(0, 2).map(([key]) => STEP_SIGNAL_LABELS[key]);
  return `Шаг ${position} (score ${total}): ${reasons.join(', ')}.`;
}

function toRelevantAnswerType(answerType: string): RelevantErrorAnswerType {
  return answerType as RelevantErrorAnswerType;
}

interface CandidateStaticData {
  readonly candidate: recommendationRepo.RecommendationCandidateTask;
  readonly comparableDifficulty: number;
  readonly errorRelevance: number | null;
  readonly taskNumberNeed: number | null;
  readonly targetRelevance: number | null;
  readonly recency: number | null;
  readonly examImportance: number | null;
  readonly similarityInput: TaskSimilarityInput;
}

/**
 * ZUBRILKA LEARNING INTELLIGENCE, Phase 8 — `getLearningPath`.
 * Builds a short deterministic multi-step sequence by running Phase 7's
 * scoring repeatedly over the SAME candidate pool, with three
 * sequence-specific adjustments applied at each position (see
 * `packages/shared/src/learning/learningPath.ts` for the formulas):
 *
 *   - `skillNeed` becomes `skillCoverageNeed`: discourages (but never
 *     bans) re-covering a skill an earlier step already addressed;
 *   - `difficultyFit`'s target difficulty can progress from the
 *     previous step's own difficulty, bounded by measured mastery;
 *   - `similarityBonus`'s reference pool grows by one entry (the task
 *     just selected) after every step, alongside open mistakes and
 *     recently solved tasks — so a later step can be picked FOR being
 *     similar to what was just chosen, not only to an old mistake.
 *
 * `errorRelevance`, `targetRelevance`, `recency`, `examImportance` are
 * unchanged from Phase 7 and computed once per candidate (they don't
 * depend on what's already been selected in this sequence). No DB
 * writes anywhere in this function — a path is pure read + in-memory
 * computation, never persisted.
 */
export async function getLearningPath(
  db: Database,
  userId: string,
  context: GetLearningPathContext,
): Promise<LearningPathResponseOrNull> {
  const subjectId = await resolveSubjectId(db, userId, { subjectId: context.subjectId });
  if (!subjectId) return null;

  const allCandidates = await recommendationRepo.getCandidateTasksForSubject(db, subjectId);
  if (allCandidates.length === 0) return null;

  const correctlyAttempted = new Set(
    await recommendationRepo.getCorrectlyAttemptedTaskIds(db, userId, subjectId),
  );
  const unsolved = allCandidates.filter((c) => !correctlyAttempted.has(c.taskId));
  // Same fallback as Phase 7: never return nothing just because every
  // task in the subject has already been solved once.
  const fallbackPool = unsolved.length > 0 ? unsolved : allCandidates;

  // unseenOnly narrows the pool further to tasks with NO attempt at
  // all (correct or not) — but only when that leaves something to
  // recommend; an exhausted "every task already attempted" subject
  // still falls back to fallbackPool rather than returning nothing,
  // same spirit as the correctly-attempted fallback just above.
  let pool = fallbackPool;
  if (context.unseenOnly) {
    const attempted = new Set(await recommendationRepo.getAttemptedTaskIds(db, userId, subjectId));
    const neverAttempted = fallbackPool.filter((c) => !attempted.has(c.taskId));
    if (neverAttempted.length > 0) pool = neverAttempted;
  }

  // Hard exclusion applied AFTER the above fallbacks — a Phase 9
  // session's already-consumed tasks must never reappear, even when
  // everything else in the subject is also already solved/attempted.
  const excludeTaskIdSet = new Set(context.excludeTaskIds ?? []);
  const candidates =
    excludeTaskIdSet.size > 0 ? pool.filter((c) => !excludeTaskIdSet.has(c.taskId)) : pool;

  const [
    masteryRows,
    errorStats,
    subjectProfile,
    openMistakeTaskIds,
    recentlySolvedTaskIds,
    taskNumberAttempts,
  ] = await Promise.all([
    recommendationRepo.getUserSkillMasteryForSubject(db, userId, subjectId),
    errorStatsRepo.getUserErrorStatistics(db, userId),
    learningProfileRepo
      .getSubjectProfiles(db, userId)
      .then((profiles) => profiles.find((p) => p.subjectId === subjectId)),
    recommendationRepo.getOpenMistakeTaskIdsForUserSubject(db, userId, subjectId),
    repo.getRecentlyCorrectlySolvedTaskIds(db, userId, subjectId, RECENT_SOLVED_REFERENCE_LIMIT),
    recommendationRepo.getUserAttemptRecordsBySubject(db, userId, subjectId),
  ]);

  // Same bulk-then-group pattern as Phase 7's own taskNumberNeed wiring
  // — real "learning from wrong answers" evidence, usable even for
  // candidates with no `task_skills` rows.
  const attemptsByTaskNumber = new Map<number, { isCorrect: boolean; createdAt: Date }[]>();
  for (const attempt of taskNumberAttempts) {
    const list = attemptsByTaskNumber.get(attempt.taskNumber) ?? [];
    list.push({ isCorrect: attempt.isCorrect, createdAt: attempt.createdAt });
    attemptsByTaskNumber.set(attempt.taskNumber, list);
  }

  const masteryBySkill = new Map(masteryRows.map((r) => [r.skillId, r.mastery] as const));
  const lastAttemptBySkill = new Map(masteryRows.map((r) => [r.skillId, r.lastAttemptAt] as const));
  const userSubjectAverageMastery =
    masteryRows.length > 0
      ? masteryRows.reduce((sum, r) => sum + r.mastery, 0) / masteryRows.length
      : null;

  const gap = subjectProfile
    ? calculateTargetGap(subjectProfile.selfReportedScore, subjectProfile.targetScore)
    : null;

  const totalPublishedTasks = allCandidates.length;
  const taskCountBySkill = new Map<string, number>();
  for (const task of allCandidates) {
    for (const skillId of task.skillIds) {
      taskCountBySkill.set(skillId, (taskCountBySkill.get(skillId) ?? 0) + 1);
    }
  }

  // Reference pool for similarityBonus starts as open mistakes + recently
  // solved tasks (both real, already-happened user history); one entry is
  // appended per selected step below — never invented data.
  const referenceTaskIds = Array.from(new Set([...openMistakeTaskIds, ...recentlySolvedTaskIds]));
  const referenceMetadata = (
    await Promise.all(referenceTaskIds.map((taskId) => getTaskMetadataForSimilarity(db, taskId)))
  ).filter((m): m is NonNullable<typeof m> => m !== undefined);
  let referenceInputs: TaskSimilarityInput[] = referenceMetadata.map(toSimilarityInput);

  const now = Date.now();

  const staticByTaskId = new Map<string, CandidateStaticData>(
    candidates.map((candidate) => {
      const comparableDifficulty = getComparableDifficulty({
        authoredDifficulty: candidate.authoredDifficulty as 1 | 2 | 3,
        observedDifficulty: candidate.observedDifficulty,
      }).value;

      const skillFrequencyRatios = candidate.skillIds.map(
        (id) => (taskCountBySkill.get(id) ?? 0) / totalPublishedTasks,
      );
      const daysSinceEachSkillLastAttempted = candidate.skillIds
        .map((id) => lastAttemptBySkill.get(id) ?? null)
        .filter((d): d is Date => d !== null)
        .map((d) => (now - d.getTime()) / MS_PER_DAY);

      const similarityInput: TaskSimilarityInput = {
        taskId: candidate.taskId,
        subjectId,
        taskNumber: candidate.taskNumber,
        topicId: candidate.topicId,
        answerType: candidate.answerType,
        skillIds: candidate.skillIds,
        comparableDifficulty,
      };

      return [
        candidate.taskId,
        {
          candidate,
          comparableDifficulty,
          errorRelevance: calculateErrorRelevance(
            errorStats,
            toRelevantAnswerType(candidate.answerType),
          ),
          taskNumberNeed: calculateTaskNumberNeed(
            attemptsByTaskNumber.get(candidate.taskNumber) ?? [],
          ),
          targetRelevance: calculateTargetRelevance(gap, comparableDifficulty),
          recency: calculateRecency(daysSinceEachSkillLastAttempted),
          examImportance: calculateExamImportance(skillFrequencyRatios),
          similarityInput,
        },
      ];
    }),
  );

  const remainingIds = new Set(candidates.map((c) => c.taskId));
  const coverageCount = new Map<string, number>();
  let previousStepDifficulty: number | null = null;

  interface SelectedStep {
    readonly position: number;
    readonly data: CandidateStaticData;
    readonly total: number;
    readonly breakdown: RecommendationBreakdown;
  }
  const selectedSteps: SelectedStep[] = [];

  for (let position = 1; position <= context.limit && remainingIds.size > 0; position++) {
    const idealDifficulty = resolveStepIdealDifficulty(
      userSubjectAverageMastery,
      previousStepDifficulty,
    );

    const scoredRemaining = Array.from(remainingIds, (taskId) => {
      const data = staticByTaskId.get(taskId)!;

      const skillCoverageNeed = calculateSkillCoverageNeed(
        data.candidate.skillIds,
        masteryBySkill,
        coverageCount,
      );
      const difficultyFit = calculateDifficultyFit(data.comparableDifficulty, idealDifficulty);
      const similarityScores = referenceInputs.map((ref) =>
        calculateTaskSimilarity(data.similarityInput, ref),
      );
      const similarityBonus = calculateSimilarityBonus(similarityScores);

      const { total, breakdown } = combineRecommendationSignals({
        skillNeed: skillCoverageNeed,
        taskNumberNeed: data.taskNumberNeed,
        errorRelevance: data.errorRelevance,
        difficultyFit,
        targetRelevance: data.targetRelevance,
        recency: data.recency,
        examImportance: data.examImportance,
        similarityBonus,
      });

      return { data, total, breakdown, taskId, taskNumber: data.candidate.taskNumber };
    });

    scoredRemaining.sort(compareLearningPathCandidates);
    const chosen = context.randomizeTopTier
      ? scoredRemaining[
          Math.floor(Math.random() * Math.min(RANDOMIZE_TOP_TIER_SIZE, scoredRemaining.length))
        ]!
      : scoredRemaining[0]!;
    selectedSteps.push({
      position,
      data: chosen.data,
      total: chosen.total,
      breakdown: chosen.breakdown,
    });
    remainingIds.delete(chosen.data.candidate.taskId);
    for (const skillId of chosen.data.candidate.skillIds) {
      coverageCount.set(skillId, (coverageCount.get(skillId) ?? 0) + 1);
    }
    referenceInputs = [...referenceInputs, chosen.data.similarityInput];
    previousStepDifficulty = chosen.data.comparableDifficulty;
  }

  const taskRows = await Promise.all(
    selectedSteps.map((step) => tasksRepo.getTaskById(db, step.data.candidate.taskId)),
  );

  const steps: LearningPathStep[] = selectedSteps.map((step, index) => ({
    position: step.position,
    task: toPublicTask(taskRows[index]!),
    score: step.total,
    reason: buildStepReason(step.position, step.breakdown, step.total),
    breakdown: step.breakdown,
  }));

  return { subject: subjectId, steps };
}
