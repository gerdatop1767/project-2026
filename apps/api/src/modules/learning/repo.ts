import type { Database } from '@zybrilka/db';
import { schema } from '@zybrilka/db';
import type { SkillAttemptRecord, SkillMasteryResult } from '@zybrilka/shared';
import { and, eq } from 'drizzle-orm';

export async function getSkillIdsForTask(db: Database, taskId: string): Promise<string[]> {
  const rows = await db
    .select({ skillId: schema.taskSkills.skillId })
    .from(schema.taskSkills)
    .where(eq(schema.taskSkills.taskId, taskId));
  return rows.map((r) => r.skillId);
}

/** Every attempt the user has made on any task linked to this skill —
 * the full history `calculateSkillMastery` needs, in any order (it
 * sorts internally). Source of truth is `attempts`, joined through
 * `task_skills`; no separate skill-specific attempt log. */
export async function getAttemptRecordsForUserSkill(
  db: Database,
  userId: string,
  skillId: string,
): Promise<SkillAttemptRecord[]> {
  const rows = await db
    .select({
      isCorrect: schema.attempts.isCorrect,
      createdAt: schema.attempts.createdAt,
      taskId: schema.attempts.taskId,
      difficulty: schema.tasks.difficulty,
    })
    .from(schema.attempts)
    .innerJoin(schema.taskSkills, eq(schema.taskSkills.taskId, schema.attempts.taskId))
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.attempts.taskId))
    .where(and(eq(schema.attempts.userId, userId), eq(schema.taskSkills.skillId, skillId)));
  return rows;
}

/** Every distinct skillId the user has ever attempted (via any linked
 * task) — the full set `rebuildUserSkillStatistics` needs to recompute,
 * not just the skills that already have a `user_skill_statistics` row. */
export async function getAttemptedSkillIdsForUser(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ skillId: schema.taskSkills.skillId })
    .from(schema.attempts)
    .innerJoin(schema.taskSkills, eq(schema.taskSkills.taskId, schema.attempts.taskId))
    .where(eq(schema.attempts.userId, userId));
  return rows.map((r) => r.skillId);
}

/** Idempotent: always a full overwrite from a freshly computed
 * `SkillMasteryResult`, never an incremental += — so calling this
 * twice with the same `result` leaves the row identical, and calling
 * it after a full recompute always matches a rebuild. */
export async function upsertUserSkillStatistics(
  db: Database,
  userId: string,
  skillId: string,
  result: SkillMasteryResult,
): Promise<void> {
  await db
    .insert(schema.userSkillStatistics)
    .values({
      userId,
      skillId,
      attempts: result.attempts,
      correctAttempts: result.correctAttempts,
      incorrectAttempts: result.incorrectAttempts,
      mastery: result.mastery,
      confidence: result.confidence,
      lastAttemptAt: result.lastAttemptAt,
    })
    .onConflictDoUpdate({
      target: [schema.userSkillStatistics.userId, schema.userSkillStatistics.skillId],
      set: {
        attempts: result.attempts,
        correctAttempts: result.correctAttempts,
        incorrectAttempts: result.incorrectAttempts,
        mastery: result.mastery,
        confidence: result.confidence,
        lastAttemptAt: result.lastAttemptAt,
        updatedAt: new Date(),
      },
    });
}

export interface SkillStatisticsRow {
  readonly subjectId: string;
  readonly skillId: string;
  readonly skillSlug: string;
  readonly skillName: string;
  readonly mastery: number;
  readonly confidence: number;
  readonly attempts: number;
  readonly correctAttempts: number;
  readonly incorrectAttempts: number;
  readonly lastAttemptAt: Date | null;
}

export async function getUserSkillStatistics(
  db: Database,
  userId: string,
): Promise<SkillStatisticsRow[]> {
  return db
    .select({
      subjectId: schema.skills.subjectId,
      skillId: schema.skills.id,
      skillSlug: schema.skills.slug,
      skillName: schema.skills.name,
      mastery: schema.userSkillStatistics.mastery,
      confidence: schema.userSkillStatistics.confidence,
      attempts: schema.userSkillStatistics.attempts,
      correctAttempts: schema.userSkillStatistics.correctAttempts,
      incorrectAttempts: schema.userSkillStatistics.incorrectAttempts,
      lastAttemptAt: schema.userSkillStatistics.lastAttemptAt,
    })
    .from(schema.userSkillStatistics)
    .innerJoin(schema.skills, eq(schema.userSkillStatistics.skillId, schema.skills.id))
    .where(eq(schema.userSkillStatistics.userId, userId));
}

export async function getUserSkillStatisticsForSkill(
  db: Database,
  userId: string,
  skillId: string,
): Promise<SkillStatisticsRow | undefined> {
  const [row] = await db
    .select({
      subjectId: schema.skills.subjectId,
      skillId: schema.skills.id,
      skillSlug: schema.skills.slug,
      skillName: schema.skills.name,
      mastery: schema.userSkillStatistics.mastery,
      confidence: schema.userSkillStatistics.confidence,
      attempts: schema.userSkillStatistics.attempts,
      correctAttempts: schema.userSkillStatistics.correctAttempts,
      incorrectAttempts: schema.userSkillStatistics.incorrectAttempts,
      lastAttemptAt: schema.userSkillStatistics.lastAttemptAt,
    })
    .from(schema.userSkillStatistics)
    .innerJoin(schema.skills, eq(schema.userSkillStatistics.skillId, schema.skills.id))
    .where(
      and(
        eq(schema.userSkillStatistics.userId, userId),
        eq(schema.userSkillStatistics.skillId, skillId),
      ),
    );
  return row;
}

/** Used only by tests to assert a rebuild starts from a clean slate. */
export async function deleteUserSkillStatistics(db: Database, userId: string): Promise<void> {
  await db.delete(schema.userSkillStatistics).where(eq(schema.userSkillStatistics.userId, userId));
}
