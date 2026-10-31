import type { Database } from '@zybrilka/db';
import { schema } from '@zybrilka/db';
import { and, eq } from 'drizzle-orm';
import { inAllSourcesPool } from '../../tasks/repo.js';

export interface RecommendationCandidateTask {
  readonly taskId: string;
  readonly taskNumber: number;
  readonly topicId: string | null;
  readonly answerType: string;
  readonly authoredDifficulty: number;
  readonly observedDifficulty: number | null;
  readonly skillIds: readonly string[];
}

/** Every published task in a subject, with its linked skills attached
 * — the full candidate pool Phase 7 scores, before any per-user
 * filtering. Mirrors Phase 6's `taskSimilarity/repo.ts` query shape
 * (same join pattern), but scoped to a subject rather than to one
 * excluded task, since the recommendation engine needs the whole pool
 * at once (also for `examImportance`'s catalog-wide skill frequency). */
export async function getCandidateTasksForSubject(
  db: Database,
  subjectId: string,
): Promise<RecommendationCandidateTask[]> {
  const rows = await db
    .select({
      taskId: schema.tasks.id,
      taskNumber: schema.tasks.taskNumber,
      topicId: schema.tasks.topicId,
      answerType: schema.tasks.answerType,
      authoredDifficulty: schema.tasks.difficulty,
      observedDifficulty: schema.taskStatistics.difficulty,
    })
    .from(schema.tasks)
    .leftJoin(schema.taskStatistics, eq(schema.taskStatistics.taskId, schema.tasks.id))
    // Smart training picks from «Все источники» only: an edition with its
    // own numbering (ЕГЭ 2027) is trained by choosing it explicitly.
    .where(
      and(
        eq(schema.tasks.subjectId, subjectId),
        eq(schema.tasks.status, 'published'),
        inAllSourcesPool(db),
      ),
    );

  if (rows.length === 0) return [];

  const linkRows = await db
    .select({ taskId: schema.taskSkills.taskId, skillId: schema.taskSkills.skillId })
    .from(schema.taskSkills)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.taskSkills.taskId))
    .where(
      and(
        eq(schema.tasks.subjectId, subjectId),
        eq(schema.tasks.status, 'published'),
        inAllSourcesPool(db),
      ),
    );

  const skillIdsByTask = new Map<string, string[]>();
  for (const link of linkRows) {
    const list = skillIdsByTask.get(link.taskId) ?? [];
    list.push(link.skillId);
    skillIdsByTask.set(link.taskId, list);
  }

  return rows.map((row) => ({
    ...row,
    skillIds: skillIdsByTask.get(row.taskId) ?? [],
  }));
}

/** Task ids the user has already answered correctly at least once —
 * the hard "don't re-recommend what's already solved" filter. */
export async function getCorrectlyAttemptedTaskIds(
  db: Database,
  userId: string,
  subjectId: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ taskId: schema.attempts.taskId })
    .from(schema.attempts)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.attempts.taskId))
    .where(
      and(
        eq(schema.attempts.userId, userId),
        eq(schema.attempts.isCorrect, true),
        eq(schema.tasks.subjectId, subjectId),
      ),
    );
  return rows.map((r) => r.taskId);
}

/** Task ids the user has ANY attempt on (correct or not) — the broader
 * "unseen" filter Training's 🔄 toggle uses elsewhere in the app
 * (never-attempted, not just never-solved-correctly). */
export async function getAttemptedTaskIds(
  db: Database,
  userId: string,
  subjectId: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ taskId: schema.attempts.taskId })
    .from(schema.attempts)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.attempts.taskId))
    .where(and(eq(schema.attempts.userId, userId), eq(schema.tasks.subjectId, subjectId)));
  return rows.map((r) => r.taskId);
}

/** Used only to exclude subjects with literally no published tasks
 * when auto-resolving a subject (never recommend into an empty pool). */
export async function subjectHasPublishedTasks(db: Database, subjectId: string): Promise<boolean> {
  const [row] = await db
    .select({ taskId: schema.tasks.id })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.subjectId, subjectId),
        eq(schema.tasks.status, 'published'),
        inAllSourcesPool(db),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export interface UserSkillMasteryRow {
  readonly skillId: string;
  /** 0..100 — see Phase 3's `calculateSkillMastery`. */
  readonly mastery: number;
  readonly lastAttemptAt: Date | null;
}

/** One row per skill in this subject the user has `user_skill_statistics`
 * for — skills the user has never attempted simply have no row here
 * (never a fabricated 0-attempt row), matching Phase 3's convention. */
export async function getUserSkillMasteryForSubject(
  db: Database,
  userId: string,
  subjectId: string,
): Promise<UserSkillMasteryRow[]> {
  return db
    .select({
      skillId: schema.userSkillStatistics.skillId,
      mastery: schema.userSkillStatistics.mastery,
      lastAttemptAt: schema.userSkillStatistics.lastAttemptAt,
    })
    .from(schema.userSkillStatistics)
    .innerJoin(schema.skills, eq(schema.skills.id, schema.userSkillStatistics.skillId))
    .where(
      and(eq(schema.userSkillStatistics.userId, userId), eq(schema.skills.subjectId, subjectId)),
    );
}

export interface UserTaskNumberAttemptRow {
  readonly taskNumber: number;
  readonly isCorrect: boolean;
  readonly createdAt: Date;
}

/** Every attempt this user has made on ANY task in this subject,
 * tagged with that task's `taskNumber` — fetched ONCE per request
 * (not per candidate) so callers can group it in memory by taskNumber
 * for `calculateTaskNumberNeed`, the same bulk-then-group pattern
 * `getCandidateTasksForSubject`'s skill links already use. A task
 * number the user has never attempted simply has no rows here — never
 * a fabricated empty-but-present entry. */
export async function getUserAttemptRecordsBySubject(
  db: Database,
  userId: string,
  subjectId: string,
): Promise<UserTaskNumberAttemptRow[]> {
  return db
    .select({
      taskNumber: schema.tasks.taskNumber,
      isCorrect: schema.attempts.isCorrect,
      createdAt: schema.attempts.createdAt,
    })
    .from(schema.attempts)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.attempts.taskId))
    .where(and(eq(schema.attempts.userId, userId), eq(schema.tasks.subjectId, subjectId)));
}

/** Task ids the user currently has an OPEN mistake on, in this subject
 * — the real "weak spot" pool `similarityBonus` relates candidates to. */
export async function getOpenMistakeTaskIdsForUserSubject(
  db: Database,
  userId: string,
  subjectId: string,
): Promise<string[]> {
  const rows = await db
    .select({ taskId: schema.mistakes.taskId })
    .from(schema.mistakes)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.mistakes.taskId))
    .where(
      and(
        eq(schema.mistakes.userId, userId),
        eq(schema.mistakes.status, 'open'),
        eq(schema.tasks.subjectId, subjectId),
      ),
    );
  return rows.map((r) => r.taskId);
}
