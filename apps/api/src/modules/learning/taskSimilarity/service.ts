import type { Database } from '@zybrilka/db';
import { schema } from '@zybrilka/db';
import {
  getComparableDifficulty,
  rankSimilarTasks,
  type SimilarTaskEntry,
  type StudentContext,
  type TaskSimilarityInput,
} from '@zybrilka/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { loadSimilarPool, type SimilarPool } from './pool.js';
import type * as repo from './repo.js';

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

/** Answers within this window are «just practised»: not offered again. */
const RECENT_MS = 30 * 60_000;

export interface SimilarOptions {
  /** The signed-in student, for personal ordering (null for a guest). */
  readonly userId?: string | null;
  /** Tasks the client is showing or just showed — never repeated. */
  readonly exclude?: readonly string[];
  readonly now?: Date;
}

/**
 * «Решать похожие» (docs/learning/SIMILAR-TASKS.md). Candidates: published
 * tasks of the target's source scope that test the same EGE skill
 * (`task_skills`) — never another skill just to fill the list. Ranked by
 * `rankSimilarTasks`: the same subtype first (text features: what is asked,
 * which rule), then a shared feature / method / subtopic, then the same
 * topic; with the student's own history — their wrong subtypes first,
 * solved tasks last, tasks answered in the last 30 minutes and `exclude`
 * left out. Deterministic: no randomness, no AI call. Returns [] for an
 * unknown task or a skill with no other task.
 */
export async function getSimilarTasks(
  db: Database,
  taskId: string,
  limit: number,
  options: SimilarOptions = {},
): Promise<SimilarTaskEntry[]> {
  const pool = await loadSimilarPool(db, taskId);
  if (!pool) return [];
  const student = await studentContext(db, pool, options);
  return rankSimilarTasks(pool.target, pool.candidates, student, limit);
}

async function studentContext(
  db: Database,
  pool: SimilarPool,
  options: SimilarOptions,
): Promise<StudentContext> {
  const recent = new Set(options.exclude ?? []);
  const empty: StudentContext = {
    solved: new Set(),
    recent,
    mistakeSubtypes: new Set(),
    failedTarget: false,
  };
  if (!options.userId) return empty;
  const now = options.now ?? new Date();
  const ids = [pool.target.taskId, ...pool.candidates.map((c) => c.taskId)];
  const [history, open] = await Promise.all([
    db
      .select({
        taskId: schema.attempts.taskId,
        isCorrect: schema.attempts.isCorrect,
        createdAt: schema.attempts.createdAt,
      })
      .from(schema.attempts)
      .where(and(eq(schema.attempts.userId, options.userId), inArray(schema.attempts.taskId, ids)))
      .orderBy(desc(schema.attempts.createdAt)),
    db
      .select({ taskId: schema.mistakes.taskId })
      .from(schema.mistakes)
      .where(
        and(
          eq(schema.mistakes.userId, options.userId),
          eq(schema.mistakes.status, 'open'),
          inArray(schema.mistakes.taskId, ids),
        ),
      ),
  ]);
  const solved = new Set<string>();
  let failedTarget = false;
  let targetSeen = false;
  for (const h of history) {
    if (h.isCorrect) solved.add(h.taskId);
    if (now.getTime() - h.createdAt.getTime() < RECENT_MS) recent.add(h.taskId);
    if (h.taskId === pool.target.taskId && !targetSeen) {
      targetSeen = true; // newest first: the latest answer to the target
      failedTarget = !h.isCorrect;
    }
  }
  const byId = new Map([pool.target, ...pool.candidates].map((t) => [t.taskId, t]));
  const mistakeSubtypes = new Set<string>();
  for (const m of open) {
    const subtype = byId.get(m.taskId)?.features.subtype;
    if (subtype) mistakeSubtypes.add(subtype);
  }
  return { solved, recent, mistakeSubtypes, failedTarget };
}
