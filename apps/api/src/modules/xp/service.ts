import type { Database } from '@zybrilka/db';
import { schema } from '@zybrilka/db';
import {
  levelForXp,
  levelProgress,
  toMoscowDateString,
  type AttemptXp,
  type LevelProgress,
  type XpHistoryResponse,
} from '@zybrilka/shared';
import { and, desc, eq, lt, max, or, sql } from 'drizzle-orm';
import { XP_RULES_VERSION, decideTaskXp, taskXpValue, type TaskForXp } from './rules.js';

/**
 * XP ledger operations (docs/XP.md). Every write goes through here and
 * runs inside the caller's transaction, so an award, its `xp_events` row
 * and the `user_xp` total are committed together or not at all.
 *
 * Per user, writes are serialized by a row lock on `user_xp` (taken in
 * `lockUserXp`): two answers submitted at the same moment by the same
 * account are applied one after the other, never interleaved. The unique
 * (userId, dedupKey) index is the second, independent guard: a replay of
 * the same result can never insert a second event.
 */

/** Creates the user's `user_xp` row if missing and locks it until the
 * transaction ends. Returns its current state. */
async function lockUserXp(
  tx: Database,
  userId: string,
): Promise<{ totalXp: number; historyImportedAt: Date | null }> {
  await tx.insert(schema.userXp).values({ userId }).onConflictDoNothing();
  const [row] = await tx
    .select({
      totalXp: schema.userXp.totalXp,
      historyImportedAt: schema.userXp.historyImportedAt,
    })
    .from(schema.userXp)
    .where(eq(schema.userXp.userId, userId))
    .for('update');
  return row!;
}

async function addToTotal(tx: Database, userId: string, amount: number): Promise<number> {
  const [row] = await tx
    .update(schema.userXp)
    .set({
      totalXp: sql`${schema.userXp.totalXp} + ${amount}`,
      updatedAt: new Date(),
    })
    .where(eq(schema.userXp.userId, userId))
    .returning({ totalXp: schema.userXp.totalXp });
  return row!.totalXp;
}

/**
 * Correct answers given before XP existed: turns each task's FIRST
 * correct attempt into the same `task:<id>:first` award a live answer
 * gets now (same rules, the attempt's own date), once per user. Shares
 * dedup keys with live awards, so it can never double-count a task that
 * was already rewarded live. Reviews are not reconstructed.
 * Must be called with the `user_xp` row locked (`lockUserXp`).
 */
async function importHistory(tx: Database, userId: string): Promise<number> {
  const rows = await tx
    .selectDistinctOn([schema.attempts.taskId], {
      attemptId: schema.attempts.id,
      createdAt: schema.attempts.createdAt,
      id: schema.tasks.id,
      subjectId: schema.tasks.subjectId,
      taskNumber: schema.tasks.taskNumber,
      difficulty: schema.tasks.difficulty,
    })
    .from(schema.attempts)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.attempts.taskId))
    .where(and(eq(schema.attempts.userId, userId), eq(schema.attempts.isCorrect, true)))
    .orderBy(schema.attempts.taskId, schema.attempts.createdAt);

  let added = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const values = rows.slice(i, i + CHUNK).map((r) => {
      const value = taskXpValue(r);
      return {
        userId,
        amount: value.amount,
        kind: 'task_first_solve' as const,
        sourceType: 'task',
        sourceId: r.id,
        attemptId: r.attemptId,
        dedupKey: `task:${r.id}:first`,
        metadata: {
          rulesVersion: XP_RULES_VERSION,
          subjectId: r.subjectId,
          taskNumber: r.taskNumber,
          difficulty: r.difficulty,
          difficultyKnown: value.difficultyKnown,
          fromHistory: true,
        },
        createdAt: r.createdAt,
      };
    });
    const inserted = await tx
      .insert(schema.xpEvents)
      .values(values)
      .onConflictDoNothing({ target: [schema.xpEvents.userId, schema.xpEvents.dedupKey] })
      .returning({ amount: schema.xpEvents.amount });
    added += inserted.reduce((sum, r) => sum + r.amount, 0);
  }
  if (added > 0) await addToTotal(tx, userId, added);
  await tx
    .update(schema.userXp)
    .set({ historyImportedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.userXp.userId, userId));
  return added;
}

/** Locks the user's XP row and, the first time, imports earlier history.
 * Call at the START of the attempt transaction (before the new attempt is
 * written), so the import never claims the answer being graded now. */
export async function prepareForAward(tx: Database, userId: string): Promise<number> {
  const state = await lockUserXp(tx, userId);
  if (state.historyImportedAt) return state.totalXp;
  await importHistory(tx, userId);
  const [row] = await tx
    .select({ totalXp: schema.userXp.totalXp })
    .from(schema.userXp)
    .where(eq(schema.userXp.userId, userId));
  return row!.totalXp;
}

/**
 * Applies the XP rules to one graded attempt. Call after `prepareForAward`
 * in the same transaction. Returns what the client is told about it.
 */
export async function awardForAttempt(
  tx: Database,
  input: {
    userId: string;
    task: TaskForXp;
    attemptId: string;
    correct: boolean;
    at: Date;
    totalBefore: number;
  },
): Promise<AttemptXp> {
  const previousLevel = levelForXp(input.totalBefore);
  const unchanged: AttemptXp = {
    awarded: 0,
    kind: null,
    totalXp: input.totalBefore,
    level: previousLevel,
    previousLevel,
  };
  if (!input.correct) return unchanged;

  const [last] = await tx
    .select({ at: max(schema.xpEvents.createdAt) })
    .from(schema.xpEvents)
    .where(
      and(eq(schema.xpEvents.userId, input.userId), eq(schema.xpEvents.sourceId, input.task.id)),
    );
  const decision = decideTaskXp({
    task: input.task,
    correct: true,
    lastAwardAt: last?.at ?? null,
    now: input.at,
    moscowDate: toMoscowDateString(input.at),
  });
  if (!decision) return unchanged;

  const inserted = await tx
    .insert(schema.xpEvents)
    .values({
      userId: input.userId,
      amount: decision.amount,
      kind: decision.kind,
      sourceType: 'task',
      sourceId: input.task.id,
      attemptId: input.attemptId,
      dedupKey: decision.dedupKey,
      metadata: decision.metadata,
      createdAt: input.at,
    })
    .onConflictDoNothing({ target: [schema.xpEvents.userId, schema.xpEvents.dedupKey] })
    .returning({ amount: schema.xpEvents.amount });
  if (inserted.length === 0) return unchanged;

  const totalXp = await addToTotal(tx, input.userId, decision.amount);
  return {
    awarded: decision.amount,
    kind: decision.kind,
    totalXp,
    level: levelForXp(totalXp),
    previousLevel,
  };
}

/** GET /progress/xp — the level shown everywhere in the app. */
export async function getXpSummary(db: Database, userId: string): Promise<LevelProgress> {
  const totalXp = await db.transaction((tx) => prepareForAward(tx, userId));
  return levelProgress(totalXp);
}

const HISTORY_PAGE = 20;

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    const createdAt = new Date(iso ?? '');
    if (!id || Number.isNaN(createdAt.getTime())) return null;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export class InvalidCursorError extends Error {}

/** GET /progress/xp/history — the user's own awards, newest first. */
export async function getXpHistory(
  db: Database,
  userId: string,
  cursor: string | undefined,
): Promise<XpHistoryResponse> {
  // Make sure earlier answers are in the ledger before listing it.
  await db.transaction((tx) => prepareForAward(tx, userId));
  const after = cursor ? decodeCursor(cursor) : null;
  if (cursor && !after) throw new InvalidCursorError();

  const rows = await db
    .select({
      id: schema.xpEvents.id,
      amount: schema.xpEvents.amount,
      kind: schema.xpEvents.kind,
      createdAt: schema.xpEvents.createdAt,
      taskId: schema.tasks.id,
      subjectId: schema.tasks.subjectId,
      subjectName: schema.subjects.name,
      taskNumber: schema.tasks.taskNumber,
    })
    .from(schema.xpEvents)
    .leftJoin(schema.tasks, eq(schema.tasks.id, schema.xpEvents.sourceId))
    .leftJoin(schema.subjects, eq(schema.subjects.id, schema.tasks.subjectId))
    .where(
      and(
        eq(schema.xpEvents.userId, userId),
        after
          ? or(
              lt(schema.xpEvents.createdAt, after.createdAt),
              and(eq(schema.xpEvents.createdAt, after.createdAt), lt(schema.xpEvents.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(schema.xpEvents.createdAt), desc(schema.xpEvents.id))
    .limit(HISTORY_PAGE + 1);

  const page = rows.slice(0, HISTORY_PAGE);
  const lastRow = page[page.length - 1];
  return {
    items: page.map((r) => ({
      id: r.id,
      amount: r.amount,
      kind: r.kind,
      createdAt: r.createdAt.toISOString(),
      task:
        r.taskId && r.subjectId && r.subjectName && r.taskNumber !== null
          ? {
              id: r.taskId,
              subjectId: r.subjectId,
              subjectName: r.subjectName,
              taskNumber: r.taskNumber,
            }
          : null,
    })),
    nextCursor:
      rows.length > HISTORY_PAGE && lastRow ? encodeCursor(lastRow.createdAt, lastRow.id) : null,
  };
}
