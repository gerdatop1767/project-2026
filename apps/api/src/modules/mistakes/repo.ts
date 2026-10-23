import type { Database } from '@zybrilka/db';
import { schema } from '@zybrilka/db';
import { and, desc, eq, ne } from 'drizzle-orm';

export async function listMistakes(db: Database, userId: string) {
  return db
    .select({
      mistake: schema.mistakes,
      task: schema.tasks,
      topicName: schema.topics.name,
      userAnswer: schema.attempts.answerRaw,
    })
    .from(schema.mistakes)
    .innerJoin(schema.tasks, eq(schema.mistakes.taskId, schema.tasks.id))
    .leftJoin(schema.topics, eq(schema.tasks.topicId, schema.topics.id))
    .innerJoin(schema.attempts, eq(schema.mistakes.lastAttemptId, schema.attempts.id))
    .where(and(eq(schema.mistakes.userId, userId), ne(schema.mistakes.status, 'dismissed')))
    .orderBy(desc(schema.mistakes.updatedAt));
}

/** Hides one of the user's own mistakes from the list (never someone
 * else's: the user id is part of the condition). Idempotent. */
export async function dismissMistake(db: Database, userId: string, mistakeId: string) {
  const [row] = await db
    .update(schema.mistakes)
    .set({ status: 'dismissed', updatedAt: new Date() })
    .where(and(eq(schema.mistakes.id, mistakeId), eq(schema.mistakes.userId, userId)))
    .returning({ id: schema.mistakes.id, status: schema.mistakes.status });
  return row ?? null;
}

/**
 * Brings a dismissed mistake back (the «Вернуть» undo). Its status is
 * re-derived from the user's latest attempt on the task — `resolved` if
 * that was correct, otherwise `open` — so an undo restores exactly what
 * the list showed before.
 */
export async function restoreMistake(db: Database, userId: string, mistakeId: string) {
  const [mistake] = await db
    .select({
      id: schema.mistakes.id,
      taskId: schema.mistakes.taskId,
      status: schema.mistakes.status,
    })
    .from(schema.mistakes)
    .where(and(eq(schema.mistakes.id, mistakeId), eq(schema.mistakes.userId, userId)));
  if (!mistake) return null;
  if (mistake.status !== 'dismissed') return mistake;
  const [latest] = await db
    .select({ isCorrect: schema.attempts.isCorrect })
    .from(schema.attempts)
    .where(and(eq(schema.attempts.userId, userId), eq(schema.attempts.taskId, mistake.taskId)))
    .orderBy(desc(schema.attempts.createdAt), desc(schema.attempts.id))
    .limit(1);
  const status = latest?.isCorrect ? 'resolved' : 'open';
  const [row] = await db
    .update(schema.mistakes)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(schema.mistakes.id, mistakeId), eq(schema.mistakes.userId, userId)))
    .returning({
      id: schema.mistakes.id,
      taskId: schema.mistakes.taskId,
      status: schema.mistakes.status,
    });
  return row ?? null;
}
