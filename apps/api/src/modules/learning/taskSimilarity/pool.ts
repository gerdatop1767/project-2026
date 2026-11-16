import type { Database } from '@zybrilka/db';
import { schema } from '@zybrilka/db';
import {
  canonicalSubtopic,
  getComparableDifficulty,
  isExamSkillSlug,
  taskFeatures,
  type SimilarCandidate,
  type TaskFeatures,
} from '@zybrilka/shared';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { outsideSourcesOf, sourceScope } from '../../tasks/repo.js';

/**
 * Text features per task version: classification reads the condition once,
 * then every «Решать похожие» for any task of that skill reuses it. Keyed
 * by id + `updated_at`, so an edited task is re-read; bounded so a large
 * catalog cannot grow it without limit.
 */
const FEATURE_CACHE_LIMIT = 5000;
const featureCache = new Map<string, { version: number; features: TaskFeatures }>();

export function featuresOf(row: {
  id: string;
  subjectId: string;
  conditionMd: string;
  updatedAt: Date;
}): TaskFeatures {
  const version = row.updatedAt.getTime();
  const hit = featureCache.get(row.id);
  if (hit && hit.version === version) return hit.features;
  const features = taskFeatures({ subjectId: row.subjectId, conditionMd: row.conditionMd });
  if (featureCache.size >= FEATURE_CACHE_LIMIT) {
    const oldest = featureCache.keys().next().value;
    if (oldest !== undefined) featureCache.delete(oldest);
  }
  featureCache.set(row.id, { version, features });
  return features;
}

export interface PoolTask extends SimilarCandidate {
  readonly examSkills: readonly string[];
}

export interface SimilarPool {
  readonly target: PoolTask;
  /** Published tasks in the target's source scope that test the same EGE
   * skill — or, for a task with no EGE skill yet, the same number. */
  readonly candidates: readonly PoolTask[];
}

const taskColumns = {
  id: schema.tasks.id,
  subjectId: schema.tasks.subjectId,
  taskNumber: schema.tasks.taskNumber,
  answerType: schema.tasks.answerType,
  authoredDifficulty: schema.tasks.difficulty,
  observedDifficulty: schema.taskStatistics.difficulty,
  conditionMd: schema.tasks.conditionMd,
  updatedAt: schema.tasks.updatedAt,
  topicSlug: schema.topics.slug,
};
type TaskRow = {
  id: string;
  subjectId: string;
  taskNumber: number;
  answerType: string;
  authoredDifficulty: number;
  observedDifficulty: number | null;
  conditionMd: string;
  updatedAt: Date;
  topicSlug: string | null;
};

async function skillsOf(db: Database, taskIds: readonly string[]) {
  if (taskIds.length === 0) return new Map<string, { exam: string[]; method: string[] }>();
  const links = await db
    .select({ taskId: schema.taskSkills.taskId, slug: schema.skills.slug })
    .from(schema.taskSkills)
    .innerJoin(schema.skills, eq(schema.skills.id, schema.taskSkills.skillId))
    .where(inArray(schema.taskSkills.taskId, [...taskIds]));
  const out = new Map<string, { exam: string[]; method: string[] }>();
  for (const l of links) {
    const entry = out.get(l.taskId) ?? { exam: [], method: [] };
    (isExamSkillSlug(l.slug) ? entry.exam : entry.method).push(l.slug);
    out.set(l.taskId, entry);
  }
  return out;
}

function toPoolTask(
  row: TaskRow,
  skills: { exam: string[]; method: string[] } | undefined,
): PoolTask {
  const difficulty = getComparableDifficulty({
    authoredDifficulty: Math.min(3, Math.max(1, row.authoredDifficulty)) as 1 | 2 | 3,
    observedDifficulty: row.observedDifficulty,
  }).value;
  return {
    taskId: row.id,
    taskNumber: row.taskNumber,
    features: featuresOf(row),
    subtopic: canonicalSubtopic(row.topicSlug),
    methodSkills: [...(skills?.method ?? [])].sort(),
    examSkills: [...(skills?.exam ?? [])].sort(),
    difficulty,
    answerType: row.answerType,
  };
}

function selectTasks(db: Database) {
  return db
    .select(taskColumns)
    .from(schema.tasks)
    .leftJoin(schema.taskStatistics, eq(schema.taskStatistics.taskId, schema.tasks.id))
    .leftJoin(schema.topics, eq(schema.topics.id, schema.tasks.topicId));
}

export async function loadSimilarPool(db: Database, taskId: string): Promise<SimilarPool | null> {
  const [targetRow] = await selectTasks(db).where(eq(schema.tasks.id, taskId));
  if (!targetRow) return null;
  const targetSkills = (await skillsOf(db, [taskId])).get(taskId);
  const target = toPoolTask(targetRow, targetSkills);

  // Same source rule as before: a task of an edition outside «Все
  // источники» is compared with its own edition only, every other task
  // with the default pool.
  const [ownSource] = await outsideSourcesOf(db, taskId);
  const scope = sourceScope(db, { collection: ownSource });
  // An essay is only ever similar to an essay; nothing else is offered one.
  const essay =
    targetRow.answerType === 'essay'
      ? eq(schema.tasks.answerType, 'essay')
      : ne(schema.tasks.answerType, 'essay');
  const base = and(
    eq(schema.tasks.subjectId, targetRow.subjectId),
    eq(schema.tasks.status, 'published'),
    ne(schema.tasks.id, taskId),
    essay,
    scope,
  );

  let rows: TaskRow[];
  if (target.examSkills.length > 0) {
    const sameSkill = db
      .selectDistinct({ id: schema.taskSkills.taskId })
      .from(schema.taskSkills)
      .innerJoin(schema.skills, eq(schema.skills.id, schema.taskSkills.skillId))
      .where(inArray(schema.skills.slug, [...target.examSkills]));
    rows = await selectTasks(db).where(and(base, inArray(schema.tasks.id, sameSkill)));
  } else {
    // Not linked to an EGE skill yet (a new format): the same number is
    // the only safe notion of «the same kind of task».
    rows = await selectTasks(db).where(
      and(base, eq(schema.tasks.taskNumber, targetRow.taskNumber)),
    );
  }
  const skills = await skillsOf(
    db,
    rows.map((r) => r.id),
  );
  return { target, candidates: rows.map((r) => toPoolTask(r, skills.get(r.id))) };
}

/** For tests: forget cached text features. */
export function clearSimilarFeatureCache(): void {
  featureCache.clear();
}
