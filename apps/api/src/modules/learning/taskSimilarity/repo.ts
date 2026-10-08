import type { Database } from '@zybrilka/db';
import { schema } from '@zybrilka/db';
import { and, eq, inArray, ne } from 'drizzle-orm';

export interface TaskSimilarityMetadata {
  readonly taskId: string;
  readonly subjectId: string;
  readonly taskNumber: number;
  readonly topicId: string | null;
  readonly answerType: string;
  readonly authoredDifficulty: 1 | 2 | 3;
  /** From Phase 4's `task_statistics.difficulty` — null if the task has no attempts yet. */
  readonly observedDifficulty: number | null;
  readonly skillIds: readonly string[];
}

/** Shape of the raw Drizzle query result, before skill ids are attached
 * and before `authoredDifficulty` is narrowed to `1 | 2 | 3` — the
 * `tasks.difficulty` column is an unconstrained `integer`, so Drizzle
 * infers plain `number` here; the narrowing cast happens only at the
 * `attachSkillIds` mapping boundary. */
type BaseRow = Omit<TaskSimilarityMetadata, 'skillIds' | 'authoredDifficulty'> & {
  authoredDifficulty: number;
};

const baseColumns = {
  taskId: schema.tasks.id,
  subjectId: schema.tasks.subjectId,
  taskNumber: schema.tasks.taskNumber,
  topicId: schema.tasks.topicId,
  answerType: schema.tasks.answerType,
  authoredDifficulty: schema.tasks.difficulty,
  observedDifficulty: schema.taskStatistics.difficulty,
};

async function attachSkillIds(db: Database, rows: BaseRow[]): Promise<TaskSimilarityMetadata[]> {
  if (rows.length === 0) return [];
  const taskIds = rows.map((r) => r.taskId);
  const links = await db
    .select({ taskId: schema.taskSkills.taskId, skillId: schema.taskSkills.skillId })
    .from(schema.taskSkills)
    .where(inArray(schema.taskSkills.taskId, taskIds));

  const skillIdsByTask = new Map<string, string[]>();
  for (const link of links) {
    const list = skillIdsByTask.get(link.taskId) ?? [];
    list.push(link.skillId);
    skillIdsByTask.set(link.taskId, list);
  }

  return rows.map((row) => ({
    ...row,
    authoredDifficulty: row.authoredDifficulty as 1 | 2 | 3,
    skillIds: skillIdsByTask.get(row.taskId) ?? [],
  }));
}

export async function getTaskMetadataForSimilarity(
  db: Database,
  taskId: string,
): Promise<TaskSimilarityMetadata | undefined> {
  const [row] = await db
    .select(baseColumns)
    .from(schema.tasks)
    .leftJoin(schema.taskStatistics, eq(schema.taskStatistics.taskId, schema.tasks.id))
    .where(eq(schema.tasks.id, taskId));
  if (!row) return undefined;
  const [withSkills] = await attachSkillIds(db, [row]);
  return withSkills;
}

/** Every published task in the same subject AND the same `taskNumber`,
 * excluding the task itself — the candidate pool `getSimilarTasks`
 * scores. "Решить похожее" only ever means "another task that is the
 * same EGE question number" (CLAUDE.md), so `taskNumber` is a hard SQL
 * filter here, in the candidate query itself — never a scoring weight
 * applied after the fact, which could let a different-numbered task
 * with a high skills/topic match outscore same-numbered ones. Subject
 * + status + number filtering all happen here (in SQL), never left to
 * the in-memory scoring step. */
export async function getCandidateTasksForSimilarity(
  db: Database,
  subjectId: string,
  taskNumber: number,
  excludeTaskId: string,
): Promise<TaskSimilarityMetadata[]> {
  const rows = await db
    .select(baseColumns)
    .from(schema.tasks)
    .leftJoin(schema.taskStatistics, eq(schema.taskStatistics.taskId, schema.tasks.id))
    .where(
      and(
        eq(schema.tasks.subjectId, subjectId),
        eq(schema.tasks.taskNumber, taskNumber),
        eq(schema.tasks.status, 'published'),
        ne(schema.tasks.id, excludeTaskId),
      ),
    );
  return attachSkillIds(db, rows);
}
