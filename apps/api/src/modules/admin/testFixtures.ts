import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import type { Database } from '@zybrilka/db';
import { and, eq } from 'drizzle-orm';

/** Test-only builders for admin report fixtures with explicit timestamps. */
export function fixtures(db: Database) {
  let tgId = 900000;
  return {
    async publishedTasks(subjectId = 'math', limit = 3) {
      return db
        .select({ id: schema.tasks.id, taskNumber: schema.tasks.taskNumber })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.subjectId, subjectId), eq(schema.tasks.status, 'published')))
        .limit(limit);
    },
    async user(createdAt: string, provider: 'email' | 'vk' | 'telegram' = 'telegram') {
      const [user] = await db
        .insert(schema.users)
        .values({ createdAt: new Date(createdAt) })
        .returning();
      await db.insert(schema.authIdentities).values({
        userId: user!.id,
        provider,
        providerUserId: String(tgId++),
        createdAt: new Date(createdAt),
      });
      return user!.id;
    },
    /** A pre-auth anonymous row: never counted as a user. */
    async legacyAnonymous(createdAt: string) {
      const [user] = await db
        .insert(schema.users)
        .values({ createdAt: new Date(createdAt) })
        .returning();
      return user!.id;
    },
    async attempt(userId: string, taskId: string, correct: boolean, at: string) {
      const [row] = await db
        .insert(schema.attempts)
        .values({
          userId,
          taskId,
          isCorrect: correct,
          answerRaw: correct ? 'ok' : 'bad',
          createdAt: new Date(at),
        })
        .returning();
      return row!.id;
    },
    async guestAnswer(visitorId: string, taskId: string, correct: boolean, at: string) {
      await db.insert(schema.analyticsEvents).values({
        type: 'answer_checked',
        visitorId,
        taskId,
        props: { correct, guest: true },
        occurredAt: new Date(at),
      });
    },
    async event(
      type: string,
      at: string,
      extra: Partial<typeof schema.analyticsEvents.$inferInsert> = {},
    ) {
      await db.insert(schema.analyticsEvents).values({ type, occurredAt: new Date(at), ...extra });
    },
    async visitor(
      createdAt: string,
      extra: Partial<typeof schema.analyticsVisitors.$inferInsert> = {},
    ) {
      const [row] = await db
        .insert(schema.analyticsVisitors)
        .values({ createdAt: new Date(createdAt), ...extra })
        .returning();
      return row!.id;
    },
    async session(userId: string) {
      const sessionId = randomUUID();
      await db
        .insert(schema.authSessions)
        .values({ id: sessionId, userId, expiresAt: new Date(Date.now() + 3_600_000) });
      return `session_id=${sessionId}`;
    },
  };
}
