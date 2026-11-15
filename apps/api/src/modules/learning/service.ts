import { syncTaskSkills, taskHasExamSkill, type Database } from '@zybrilka/db';
import { calculateSkillMastery, type SkillMasteryEntry } from '@zybrilka/shared';
import { lockUserLearningState } from '../xp/service.js';
import * as repo from './repo.js';

/**
 * Recomputes and stores one user's statistics for one skill, always
 * from that skill's FULL attempt history (never an incremental +=) —
 * the same recompute `rebuildUserSkillStatistics` runs per skill, so
 * calling this after every attempt and running a full rebuild always
 * converge to the same numbers.
 */
async function recomputeUserSkillStatistics(
  db: Database,
  userId: string,
  skillId: string,
): Promise<void> {
  const attemptRecords = await repo.getAttemptRecordsForUserSkill(db, userId, skillId);
  const result = calculateSkillMastery(attemptRecords);
  await repo.upsertUserSkillStatistics(db, userId, skillId, result);
}

/**
 * Called right after a new attempt is written (same transaction as the
 * attempt + mistakes update — see `modules/tasks/service.ts`). Looks up
 * the task's skills purely through `task_skills` — never a `taskNumber`
 * check — so any task gains skill-stat updates automatically the
 * moment it has `task_skills` rows, with zero code changes here.
 */
export async function updateSkillStatisticsForTaskAttempt(
  db: Database,
  userId: string,
  taskId: string,
): Promise<void> {
  // A task imported after the last sync is linked right here, from its own
  // metadata (docs/learning/IMPORT-INTEGRATION.md) — no answer is lost.
  if (!(await taskHasExamSkill(db, taskId))) await syncTaskSkills(db, { taskIds: [taskId] });
  const skillIds = await repo.getSkillIdsForTask(db, taskId);
  for (const skillId of skillIds) {
    await recomputeUserSkillStatistics(db, userId, skillId);
  }
}

/**
 * Deterministic, idempotent recompute of every skill the user has ever
 * attempted, straight from `attempts` — safe to run repeatedly (a
 * migration, a formula change, data recovery, every API start). Running it
 * twice in a row with no new attempts in between produces identical rows.
 *
 * Runs in one transaction under the same per-account lock as the answer
 * transaction (`lockUserLearningState`), so an answer recorded while the
 * rebuild runs is never overwritten by a row computed without it. One query
 * for the whole history, one upsert for all skills.
 */
export async function rebuildUserSkillStatistics(
  db: Database,
  userId: string,
): Promise<{ skillsUpdated: number }> {
  return db.transaction(async (tx) => {
    await lockUserLearningState(tx, userId);
    const bySkill = await repo.getAttemptRecordsForUserBySkill(tx, userId);
    const rows = [...bySkill.entries()].map(([skillId, records]) => ({
      skillId,
      result: calculateSkillMastery(records),
    }));
    await repo.upsertUserSkillStatisticsMany(tx, userId, rows);
    return { skillsUpdated: rows.length };
  });
}

export async function getUserMastery(db: Database, userId: string): Promise<SkillMasteryEntry[]> {
  const rows = await repo.getUserSkillStatistics(db, userId);
  return rows.map((row) => ({
    subjectId: row.subjectId,
    skillId: row.skillId,
    skillSlug: row.skillSlug,
    skillName: row.skillName,
    mastery: row.mastery,
    confidence: row.confidence,
    attempts: row.attempts,
    correctAttempts: row.correctAttempts,
    incorrectAttempts: row.incorrectAttempts,
    lastAttemptAt: row.lastAttemptAt ? row.lastAttemptAt.toISOString() : null,
  }));
}
