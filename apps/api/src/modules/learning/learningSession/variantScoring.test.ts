import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createImported2027TestDb } from '@zybrilka/db/testing';
import { parseMultiPartSpec, type VariantAttemptDetail } from '@zybrilka/shared';
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { submitAttempt } from '../../tasks/service.js';
import {
  finishVariantSession,
  getVariantAttemptDetail,
  openVariantTask,
  startVariantSession,
} from './service.js';

type TaskRow = typeof schema.tasks.$inferSelect;

/**
 * Primary points of a variant attempt (ЕГЭ 2027 Ященко, Вариант 1):
 * first answers only, per-task maxima from the rules frozen at start,
 * а/б/в part credit, preliminary until finished.
 */
describe('variant attempt — primary points', () => {
  let testDb: Awaited<ReturnType<typeof createImported2027TestDb>>;
  let variantId: string;
  let variant2026Id: string;
  const byNumber = new Map<number, TaskRow>();

  beforeAll(async () => {
    testDb = await createImported2027TestDb();
    const [collection] = await testDb.db
      .select()
      .from(schema.collections)
      .where(eq(schema.collections.slug, 'ege-2027-yashchenko'));
    const [variant] = await testDb.db
      .select()
      .from(schema.variants)
      .where(
        and(eq(schema.variants.collectionId, collection!.id), eq(schema.variants.variantNumber, 1)),
      );
    variantId = variant!.id;
    const [old] = await testDb.db
      .select()
      .from(schema.variants)
      .innerJoin(schema.collections, eq(schema.collections.id, schema.variants.collectionId))
      .where(eq(schema.collections.slug, 'ege-2026-yashchenko'));
    variant2026Id = old!.variants.id;
    const rows = await testDb.db
      .select({ task: schema.tasks })
      .from(schema.variantTasks)
      .innerJoin(schema.tasks, eq(schema.tasks.id, schema.variantTasks.taskId))
      .where(eq(schema.variantTasks.variantId, variantId))
      .orderBy(asc(schema.variantTasks.position));
    for (const r of rows) byNumber.set(r.task.taskNumber, r.task);
  });
  afterAll(async () => {
    await testDb.close();
  });

  const newUser = async () => {
    const id = randomUUID();
    await testDb.db.insert(schema.users).values({ id });
    return id;
  };
  const start = async (userId: string, id = variantId) => {
    const s = await startVariantSession(testDb.db, userId, id);
    if (!s || s.status !== 'active') throw new Error('not started');
    return s.sessionId;
  };
  const answer = async (
    userId: string,
    sessionId: string,
    n: number,
    value: string | Record<string, string>,
  ) => {
    // As in the app: a task is opened in the attempt before it is answered.
    await openVariantTask(testDb.db, userId, sessionId, byNumber.get(n)!.id);
    return submitAttempt(testDb.db, byNumber.get(n)!.id, userId, {
      answer: value as never,
      timeSpentMs: 20_000,
      sessionId,
    });
  };
  const right = (n: number) => byNumber.get(n)!.correctAnswer;
  const detail = async (userId: string, sessionId: string) =>
    (await getVariantAttemptDetail(testDb.db, userId, sessionId)) as VariantAttemptDetail;

  it('freezes the 2027 rules into the attempt: 19 tasks offered (no №17), 31 of 33 points', async () => {
    const user = await newUser();
    const sessionId = await start(user);
    const [row] = await testDb.db
      .select()
      .from(schema.learningSessions)
      .where(eq(schema.learningSessions.id, sessionId));
    expect(row!.scoring).toMatchObject({
      version: 1,
      format: 'ege-math-profile-2027',
      rulesStatus: 'project',
      examMaxTotal: 33,
      unavailableTaskNumbers: [17],
      scaleId: null,
    });
    expect(row!.scoring!.tasks).toHaveLength(19);
    const d = await detail(user, sessionId);
    expect(d.scoring).toMatchObject({
      primary: 0,
      maxAvailable: 31,
      examMaxTotal: 33,
      preliminary: true,
      rulesSource: 'snapshot',
    });
    expect(d.scoring!.conversion.available).toBe(false);
  });

  it('counts first answers once, gives а/б/в part credit, and is final once finished', async () => {
    const user = await newUser();
    const sessionId = await start(user);
    await answer(user, sessionId, 1, right(1)); // +1
    await answer(user, sessionId, 2, '0'); // wrong: 0
    await answer(user, sessionId, 2, right(2)); // a retry never counts
    await answer(user, sessionId, 14, '-11π/2; -5π'); // +2
    await answer(user, sessionId, 19, '[-4,5;-2√2) ∪ {-89/18}'); // +4
    const spec = parseMultiPartSpec(right(20))!;
    expect(spec.parts.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    await answer(user, sessionId, 20, { a: 'да', b: 'нет', c: '600' }); // а+б: +2
    // Opening tasks again (any order) adds nothing.
    await openVariantTask(testDb.db, user, sessionId, byNumber.get(3)!.id);
    await openVariantTask(testDb.db, user, sessionId, byNumber.get(1)!.id);

    const live = await detail(user, sessionId);
    expect(live.scoring!.preliminary).toBe(true);
    expect(live.scoring!.primary).toBe(1 + 2 + 4 + 2);

    await finishVariantSession(testDb.db, user, sessionId);
    const done = await detail(user, sessionId);
    const s = done.scoring!;
    expect(s.preliminary).toBe(false);
    expect(s.primary).toBe(9);
    expect(s.partOne).toEqual({ awarded: 1, max: 13 });
    expect(s.partTwo).toEqual({ awarded: 8, max: 18 });
    const task = (n: number) => s.tasks.find((t) => t.taskNumber === n)!;
    expect(task(2)).toMatchObject({ awarded: 0, status: 'zero' });
    expect(task(3)).toMatchObject({ awarded: 0, status: 'unanswered' });
    expect(task(20)).toMatchObject({ awarded: 2, max: 4, status: 'partial' });
    expect(task(19)).toMatchObject({ awarded: 4, max: 4, status: 'full', estimated: true });
    expect(s.tasks.some((t) => t.taskNumber === 17)).toBe(false);
    expect(done.tasks.find((t) => t.taskNumber === 2)!.answers).toBe(2);
  });

  it('an empty finished attempt scores 0 — nothing for unanswered tasks', async () => {
    const user = await newUser();
    const sessionId = await start(user);
    await finishVariantSession(testDb.db, user, sessionId);
    const d = await detail(user, sessionId);
    expect(d.scoring).toMatchObject({ primary: 0, preliminary: false });
    expect(d.scoring!.tasks.every((t) => t.status === 'unanswered')).toBe(true);
  });

  it('scores by the rules saved with the attempt, not by whatever is current', async () => {
    const user = await newUser();
    const sessionId = await start(user);
    await answer(user, sessionId, 1, right(1));
    const [row] = await testDb.db
      .select()
      .from(schema.learningSessions)
      .where(eq(schema.learningSessions.id, sessionId));
    // Pretend the rules at the start gave №1 three points.
    const frozen = {
      ...row!.scoring!,
      tasks: row!.scoring!.tasks.map((t) =>
        t.taskNumber === 1 ? { ...t, rule: { ...t.rule, max: 3 } } : t,
      ),
    };
    await testDb.db
      .update(schema.learningSessions)
      .set({ scoring: frozen })
      .where(eq(schema.learningSessions.id, sessionId));
    const d = await detail(user, sessionId);
    expect(d.scoring!.tasks.find((t) => t.taskNumber === 1)).toMatchObject({ max: 3, awarded: 3 });
  });

  it('an attempt started before scoring existed is scored by current rules, and says so', async () => {
    const user = await newUser();
    const sessionId = await start(user);
    await testDb.db
      .update(schema.learningSessions)
      .set({ scoring: null })
      .where(eq(schema.learningSessions.id, sessionId));
    const d = await detail(user, sessionId);
    expect(d.scoring).toMatchObject({ rulesSource: 'current', maxAvailable: 31 });
  });

  it('the 2026 variants are scored by the 2026 rules (19 tasks, 32 points)', async () => {
    const user = await newUser();
    const sessionId = await start(user, variant2026Id);
    const d = await detail(user, sessionId);
    expect(d.scoring).toMatchObject({
      format: 'ege-math-profile-2026',
      examMaxTotal: 32,
      rulesStatus: 'official',
    });
  });

  it('someone else cannot read the attempt', async () => {
    const owner = await newUser();
    const other = await newUser();
    const sessionId = await start(owner);
    expect(await getVariantAttemptDetail(testDb.db, other, sessionId)).toBeNull();
  });
});
