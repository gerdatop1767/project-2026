import type { Database } from '@zybrilka/db';
import {
  calculateTaskSimilarity,
  getComparableDifficulty,
  type SimilarTaskEntry,
  type TaskSimilarityInput,
} from '@zybrilka/shared';
import * as repo from './repo.js';

/** Exported for reuse by Phase 7's recommendation engine (`similarityBonus`),
 * which needs the same metadata-to-similarity-input mapping for both
 * candidate tasks and the user's open-mistake tasks. */
export function toSimilarityInput(meta: repo.TaskSimilarityMetadata): TaskSimilarityInput {
  const { value } = getComparableDifficulty({
    authoredDifficulty: meta.authoredDifficulty,
    observedDifficulty: meta.observedDifficulty,
  });
  return {
    taskId: meta.taskId,
    subjectId: meta.subjectId,
    taskNumber: meta.taskNumber,
    topicId: meta.topicId,
    answerType: meta.answerType,
    skillIds: meta.skillIds,
    comparableDifficulty: value,
  };
}

/**
 * Deterministic, on-demand (never precomputed/stored — see Phase 6's
 * instructions: the task catalog is small enough that a stored
 * `similar_task_relations` table would just be a second place for the
 * same calculation to drift out of sync). Candidates are resolved by
 * `taskId` → `subjectId` + the SAME `taskNumber` — a hard SQL filter
 * (see `getCandidateTasksForSimilarity`'s doc comment), not a scoring
 * weight: "Решить похожее" must only ever surface another task of the
 * exact same EGE question number, never a different number that
 * happens to score well on skills/topic. Returns `[]` for an unknown
 * `taskId`, or for a real task that has no OTHER published task of its
 * own number yet — never substituted with a different number.
 */
export async function getSimilarTasks(
  db: Database,
  taskId: string,
  limit: number,
): Promise<SimilarTaskEntry[]> {
  const target = await repo.getTaskMetadataForSimilarity(db, taskId);
  if (!target) return [];

  const candidates = await repo.getCandidateTasksForSimilarity(
    db,
    target.subjectId,
    target.taskNumber,
    taskId,
  );
  const targetInput = toSimilarityInput(target);

  const scored = candidates.map((candidate) => {
    const candidateInput = toSimilarityInput(candidate);
    return {
      taskId: candidate.taskId,
      taskNumber: candidate.taskNumber,
      score: calculateTaskSimilarity(targetInput, candidateInput),
    };
  });

  // Deterministic order: score desc, then taskId asc as a stable
  // tie-break — never an arbitrary DB row order.
  scored.sort((a, b) => b.score - a.score || a.taskId.localeCompare(b.taskId));

  return scored.slice(0, limit);
}
