import type { Database } from '@zybrilka/db';
import { schema } from '@zybrilka/db';
import {
  allExamSkills,
  isNearMiss,
  isPartialDigitAnswer,
  type DiagnosisAttempt,
} from '@zybrilka/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { featuresOf } from '../taskSimilarity/pool.js';

const examKeys = allExamSkills().map((s) => s.key);

export interface SkillAttemptFacts extends DiagnosisAttempt {
  readonly slug: string;
}

/**
 * Every attempt of the student in the given exam skills (all of them when
 * omitted), with the facts `diagnoseSkill` reads (docs/learning/
 * PERSONAL-PLANS.md § Диагностика). Facts come only from data the server
 * has: the submitted and the correct answer, whether the task's solution
 * had been opened before the attempt (`task_answer_reveals`, or a mistake
 * whose explanation was opened), the task's subtype from its condition.
 */
export async function loadSkillAttempts(
  db: Database,
  userId: string,
  skillKeys?: readonly string[],
): Promise<Map<string, SkillAttemptFacts[]>> {
  const keys = skillKeys?.length ? skillKeys.filter((k) => examKeys.includes(k)) : examKeys;
  const out = new Map<string, SkillAttemptFacts[]>();
  if (keys.length === 0) return out;
  const rows = await db
    .select({
      slug: schema.skills.slug,
      taskId: schema.attempts.taskId,
      isCorrect: schema.attempts.isCorrect,
      createdAt: schema.attempts.createdAt,
      answerRaw: schema.attempts.answerRaw,
      difficulty: schema.tasks.difficulty,
      correctAnswer: schema.tasks.correctAnswer,
      answerType: schema.tasks.answerType,
    })
    .from(schema.attempts)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.attempts.taskId))
    .innerJoin(schema.taskSkills, eq(schema.taskSkills.taskId, schema.attempts.taskId))
    .innerJoin(schema.skills, eq(schema.skills.id, schema.taskSkills.skillId))
    .where(and(eq(schema.attempts.userId, userId), inArray(schema.skills.slug, [...keys])));
  if (rows.length === 0) return out;

  const taskIds = [...new Set(rows.map((r) => r.taskId))];
  const [tasks, reveals, opened] = await Promise.all([
    db
      .select({
        id: schema.tasks.id,
        subjectId: schema.tasks.subjectId,
        conditionMd: schema.tasks.conditionMd,
        updatedAt: schema.tasks.updatedAt,
      })
      .from(schema.tasks)
      .where(inArray(schema.tasks.id, taskIds)),
    db
      .select({ taskId: schema.taskAnswerReveals.taskId, at: schema.taskAnswerReveals.revealedAt })
      .from(schema.taskAnswerReveals)
      .where(
        and(
          eq(schema.taskAnswerReveals.userId, userId),
          inArray(schema.taskAnswerReveals.taskId, taskIds),
        ),
      ),
    db
      .select({ taskId: schema.mistakes.taskId })
      .from(schema.mistakes)
      .where(
        and(
          eq(schema.mistakes.userId, userId),
          eq(schema.mistakes.explanationOpened, true),
          inArray(schema.mistakes.taskId, taskIds),
        ),
      ),
  ]);
  const subtypeOf = new Map(tasks.map((t) => [t.id, featuresOf(t).subtype]));
  const revealedAt = new Map(reveals.map((r) => [r.taskId, r.at.getTime()]));
  const explanationOpened = new Set(opened.map((o) => o.taskId));

  // A wrong answer counts as «after the solution» when the solution of that
  // task had been seen before it: a reveal earlier than the attempt, or an
  // opened explanation and an earlier attempt on the same task.
  const firstAttemptAt = new Map<string, number>();
  for (const r of rows) {
    const t = r.createdAt.getTime();
    const prev = firstAttemptAt.get(r.taskId);
    if (prev === undefined || t < prev) firstAttemptAt.set(r.taskId, t);
  }

  for (const r of rows) {
    const t = r.createdAt.getTime();
    const revealed = revealedAt.get(r.taskId);
    const afterExplanation =
      !r.isCorrect &&
      ((revealed !== undefined && revealed < t) ||
        (explanationOpened.has(r.taskId) && t > firstAttemptAt.get(r.taskId)!));
    const shortAnswer = r.answerType === 'short_answer';
    const facts: SkillAttemptFacts = {
      slug: r.slug,
      taskId: r.taskId,
      isCorrect: r.isCorrect,
      createdAt: r.createdAt,
      difficulty: r.difficulty,
      subtype: subtypeOf.get(r.taskId) ?? null,
      nearMiss: !r.isCorrect && shortAnswer && isNearMiss(r.answerRaw, r.correctAnswer),
      partial: !r.isCorrect && shortAnswer && isPartialDigitAnswer(r.answerRaw, r.correctAnswer),
      blank: !r.isCorrect && r.answerRaw.trim() === '',
      afterExplanation,
    };
    const list = out.get(r.slug);
    if (list) list.push(facts);
    else out.set(r.slug, [facts]);
  }
  return out;
}
