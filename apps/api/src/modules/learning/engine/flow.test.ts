import { randomUUID } from 'node:crypto';
import { schema, syncTaskSkills } from '@zybrilka/db';
import { createFullContentTestDb } from '@zybrilka/db/testing';
import { YASHCHENKO_2027_PROJECT_SOURCE } from '@zybrilka/shared';
import { and, eq, ne } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { loadConfig } from '../../../config.js';
import { rebuildUserSkillStatistics } from '../service.js';

type TaskRow = typeof schema.tasks.$inferSelect;

/**
 * Learning Engine core flow on the real imported content
 * (docs/learning/TESTING.md): answer → attempt → exam skill → statistics.
 */
describe('Learning Engine: answer → skill (real content)', () => {
  let testDb: Awaited<ReturnType<typeof createFullContentTestDb>>;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    testDb = await createFullContentTestDb();
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test' }),
    });
  });
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  async function account() {
    const [user] = await testDb.db.insert(schema.users).values({}).returning();
    const sessionId = randomUUID();
    await testDb.db
      .insert(schema.authSessions)
      .values({ id: sessionId, userId: user!.id, expiresAt: new Date(Date.now() + 3_600_000) });
    return { userId: user!.id, cookie: `session_id=${sessionId}` };
  }
  const answer = (task: TaskRow, cookie: string, value: string) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/attempt`,
      headers: { cookie },
      payload: { answer: value },
    });
  async function skillRow(userId: string, slug: string) {
    const [row] = await testDb.db
      .select({ s: schema.userSkillStatistics })
      .from(schema.userSkillStatistics)
      .innerJoin(schema.skills, eq(schema.skills.id, schema.userSkillStatistics.skillId))
      .where(and(eq(schema.userSkillStatistics.userId, userId), eq(schema.skills.slug, slug)));
    return row?.s ?? null;
  }
  async function shortTask(where: Parameters<typeof and>[number]) {
    const [t] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.status, 'published'),
          eq(schema.tasks.answerType, 'short_answer'),
          where,
        ),
      )
      .limit(1);
    return t!;
  }

  it('every imported task of the real content is linked to an EGE skill', async () => {
    const result = await syncTaskSkills(testDb.db);
    expect(result.unmapped).toEqual([]);
    expect(result.tasksChecked).toBeGreaterThan(900);
    const again = await syncTaskSkills(testDb.db);
    expect(again.linksCreated).toBe(0);
    expect(again.linksRemoved).toBe(0);
  });

  it('an answer updates the exam skill of its number; the old Ященко numbering lands on the right topic', async () => {
    const { userId, cookie } = await account();
    const equations = await shortTask(
      and(
        eq(schema.tasks.subjectId, 'math'),
        eq(schema.tasks.taskNumber, 6),
        ne(schema.tasks.source, YASHCHENKO_2027_PROJECT_SOURCE),
      ),
    );
    expect((await answer(equations, cookie, '__wrong__')).statusCode).toBe(200);
    const eqRow = await skillRow(userId, 'math.equations-simple');
    expect(eqRow).toMatchObject({ attempts: 1, correctAttempts: 0, incorrectAttempts: 1 });

    // Ященко-2027 (old edition) №6 is «Случайные величины», not equations.
    const randomVars = await shortTask(
      and(eq(schema.tasks.source, YASHCHENKO_2027_PROJECT_SOURCE), eq(schema.tasks.taskNumber, 6)),
    );
    await answer(randomVars, cookie, randomVars.correctAnswer);
    expect(await skillRow(userId, 'math.random-variables')).toMatchObject({
      attempts: 1,
      correctAttempts: 1,
    });
    expect((await skillRow(userId, 'math.equations-simple'))!.attempts).toBe(1);

    // Russian works the same way.
    const nn = await shortTask(
      and(eq(schema.tasks.subjectId, 'russian'), eq(schema.tasks.taskNumber, 15)),
    );
    await answer(nn, cookie, nn.correctAnswer);
    expect(await skillRow(userId, 'russian.15-n-nn')).toMatchObject({
      attempts: 1,
      correctAttempts: 1,
    });
  });

  it('a task imported after the last sync is linked when it is answered — no answer lost', async () => {
    const { userId, cookie } = await account();
    const [fresh] = await testDb.db
      .insert(schema.tasks)
      .values({
        subjectId: 'russian',
        taskNumber: 9,
        difficulty: 2,
        conditionMd: 'Новое задание №9 после импорта (тест).',
        correctAnswer: '13',
        explanationMd: 'Объяснение.',
        source: 'Новый сборник 2027',
        sourceYear: 2027,
        status: 'published',
      })
      .returning();
    await answer(fresh!, cookie, '13');
    expect(await skillRow(userId, 'russian.09-root-vowels')).toMatchObject({
      attempts: 1,
      correctAttempts: 1,
    });
  });

  it('rebuilding a profile from the attempt history gives exactly the stored rows', async () => {
    const { userId, cookie } = await account();
    const t = await shortTask(
      and(eq(schema.tasks.subjectId, 'math'), eq(schema.tasks.taskNumber, 4)),
    );
    for (const v of ['__w1__', '__w2__', t.correctAnswer]) await answer(t, cookie, v);
    const before = await skillRow(userId, 'math.probability-basic');
    await rebuildUserSkillStatistics(testDb.db, userId);
    const after = await skillRow(userId, 'math.probability-basic');
    expect(after).toMatchObject({
      attempts: before!.attempts,
      correctAttempts: before!.correctAttempts,
      mastery: before!.mastery,
      confidence: before!.confidence,
    });
    expect(after!.attempts).toBe(3);
  });
});
