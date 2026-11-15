import { createHash } from 'node:crypto';
import type { Database } from '@zybrilka/db';
import { schema } from '@zybrilka/db';
import { effectiveDifficulty, type TrainingBucket } from '@zybrilka/shared';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { inAllSourcesPool } from '../../tasks/repo.js';
import { communityDifficulty } from '../difficultyRating/service.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PickOptions {
  readonly skillKey: string;
  readonly count: number;
  readonly bucket: TrainingBucket;
  /** Target difficulty on the authored 1..3 scale (`targetDifficultyFor`). */
  readonly targetDifficulty: number;
  readonly excludeTaskIds?: readonly string[];
  /** Smart Training «Только нерешённые»: never a task already attempted. */
  readonly unseenOnly?: boolean;
  readonly now?: Date;
}

export interface PickedTask {
  readonly taskId: string;
  readonly why: 'mistake' | 'retry' | 'new' | 'review';
}

/**
 * Concrete tasks for one skill (docs/learning/ALGORITHMS.md § 3). Pool:
 * published, auto-checked tasks linked to the skill — from «Все источники»
 * first; tasks of separate sources (the old Ященко-2027 edition) only when
 * the pool runs short. Each task gets a score:
 *   - the student's own history: an open mistake (bucket `mistakes`), a task
 *     answered wrong and not yet right, a new task, an already solved one
 *     (only for `strong` maintenance), minus a penalty for anything answered
 *     in the last 7 days — so the same tasks are not served again and again;
 *   - difficulty fit: |effective difficulty − target| (community ratings
 *     included, never the student's own);
 *   - a small daily shuffle (hash of student, task and date) so equal tasks
 *     rotate day to day while one request stays deterministic.
 */
export async function pickTasksForSkill(
  db: Database,
  userId: string,
  options: PickOptions,
): Promise<PickedTask[]> {
  const now = options.now ?? new Date();
  const exclude = new Set(options.excludeTaskIds ?? []);
  const base = and(
    eq(schema.skills.slug, options.skillKey),
    eq(schema.tasks.status, 'published'),
    ne(schema.tasks.answerType, 'essay'),
  );
  const select = {
    taskId: schema.tasks.id,
    difficulty: schema.tasks.difficulty,
  };
  const main = await db
    .select(select)
    .from(schema.tasks)
    .innerJoin(schema.taskSkills, eq(schema.taskSkills.taskId, schema.tasks.id))
    .innerJoin(schema.skills, eq(schema.skills.id, schema.taskSkills.skillId))
    .where(and(base, inAllSourcesPool(db)));
  let pool = main.filter((t) => !exclude.has(t.taskId));
  if (pool.length < options.count) {
    const all = await db
      .select(select)
      .from(schema.tasks)
      .innerJoin(schema.taskSkills, eq(schema.taskSkills.taskId, schema.tasks.id))
      .innerJoin(schema.skills, eq(schema.skills.id, schema.taskSkills.skillId))
      .where(base);
    const have = new Set(pool.map((t) => t.taskId));
    pool = [...pool, ...all.filter((t) => !exclude.has(t.taskId) && !have.has(t.taskId))];
  }
  if (pool.length === 0) return [];

  const ids = pool.map((t) => t.taskId);
  const [history, openMistakes, community] = await Promise.all([
    db
      .select({
        taskId: schema.attempts.taskId,
        isCorrect: schema.attempts.isCorrect,
        createdAt: schema.attempts.createdAt,
      })
      .from(schema.attempts)
      .where(and(eq(schema.attempts.userId, userId), inArray(schema.attempts.taskId, ids))),
    db
      .select({ taskId: schema.mistakes.taskId })
      .from(schema.mistakes)
      .where(
        and(
          eq(schema.mistakes.userId, userId),
          eq(schema.mistakes.status, 'open'),
          inArray(schema.mistakes.taskId, ids),
        ),
      ),
    communityDifficulty(db, ids),
  ]);
  const stats = new Map<string, { correct: boolean; wrong: number; last: number }>();
  for (const h of history) {
    const s = stats.get(h.taskId) ?? { correct: false, wrong: 0, last: 0 };
    stats.set(h.taskId, {
      correct: s.correct || h.isCorrect,
      wrong: s.wrong + (h.isCorrect ? 0 : 1),
      last: Math.max(s.last, h.createdAt.getTime()),
    });
  }
  const mistakeSet = new Set(openMistakes.map((m) => m.taskId));
  const day = now.toISOString().slice(0, 10);

  const scored = pool
    .filter((t) => !options.unseenOnly || !stats.has(t.taskId))
    .map((t) => {
      const s = stats.get(t.taskId);
      let score = 0;
      let why: PickedTask['why'] = 'new';
      if (mistakeSet.has(t.taskId)) {
        score += options.bucket === 'mistakes' ? 4 : 1;
        why = 'mistake';
      } else if (s && !s.correct) {
        score += options.bucket === 'mistakes' ? 2.5 : 1.2;
        why = 'retry';
      } else if (!s) {
        score += options.bucket === 'mistakes' ? 0.5 : 2;
      } else {
        score += options.bucket === 'strong' ? 0.5 : -2;
        why = 'review';
      }
      if (s && now.getTime() - s.last < 7 * MS_PER_DAY) score -= 1.5;
      const eff = effectiveDifficulty(t.difficulty, community.get(t.taskId)?.median ?? null);
      score -= Math.abs(eff - options.targetDifficulty);
      const jitter =
        createHash('sha1').update(`${userId}|${t.taskId}|${day}`).digest().readUInt16BE(0) /
        65535 /
        3;
      return { taskId: t.taskId, why, score: score + jitter };
    })
    .sort((a, b) => b.score - a.score || a.taskId.localeCompare(b.taskId));

  return scored.slice(0, options.count).map(({ taskId, why }) => ({ taskId, why }));
}
