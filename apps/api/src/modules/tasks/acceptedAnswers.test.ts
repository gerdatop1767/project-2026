import { schema } from '@zybrilka/db';
import { createTestDb } from '@zybrilka/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';

/**
 * The official key may accept several answers («поэтому <или> потому <или>
 * оттого»): `acceptedAnswers` are checked exactly like `correctAnswer`,
 * with the same options; anything else is still wrong.
 */
describe('accepted alternative answers', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let wordTaskId: string;
  let digitTaskId: string;

  beforeAll(async () => {
    testDb = await createTestDb();
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test' }),
    });
    await testDb.db
      .insert(schema.subjects)
      .values({ id: 'russian', name: 'Русский язык' })
      .onConflictDoNothing();
    const [word] = await testDb.db
      .insert(schema.tasks)
      .values({
        subjectId: 'russian',
        taskNumber: 1,
        difficulty: 2,
        conditionMd: 'Самостоятельно подберите наречие…',
        correctAnswer: 'поэтому',
        acceptedAnswers: ['потому', 'оттого'],
        explanationMd: 'Объяснение.',
        source: 'test',
        status: 'published',
      })
      .returning();
    wordTaskId = word!.id;
    const [digits] = await testDb.db
      .insert(schema.tasks)
      .values({
        subjectId: 'russian',
        taskNumber: 25,
        difficulty: 2,
        conditionMd: 'Выпишите антонимы.',
        correctAnswer: 'вспыхивалигасли',
        acceptedAnswers: ['гасливспыхивали'],
        explanationMd: 'Объяснение.',
        source: 'test',
        status: 'published',
      })
      .returning();
    digitTaskId = digits!.id;
  });
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  const attempt = async (taskId: string, answer: string) =>
    (
      await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskId}/attempt`,
        payload: { answer },
      })
    ).json() as { correct: boolean };

  it('the main answer and every accepted alternative count; other words do not', async () => {
    expect((await attempt(wordTaskId, 'поэтому')).correct).toBe(true);
    expect((await attempt(wordTaskId, 'Потому')).correct).toBe(true);
    expect((await attempt(wordTaskId, 'оттого')).correct).toBe(true);
    expect((await attempt(wordTaskId, 'затем')).correct).toBe(false);
    expect((await attempt(digitTaskId, 'гасливспыхивали')).correct).toBe(true);
    expect((await attempt(digitTaskId, 'вспыхивали')).correct).toBe(false);
  });

  it('a task without alternatives behaves exactly as before', async () => {
    const [plain] = await testDb.db
      .insert(schema.tasks)
      .values({
        subjectId: 'russian',
        taskNumber: 5,
        difficulty: 2,
        conditionMd: 'Пароним.',
        correctAnswer: 'охватил',
        explanationMd: 'Объяснение.',
        source: 'test',
        status: 'published',
      })
      .returning();
    expect(plain!.acceptedAnswers).toEqual([]);
    expect((await attempt(plain!.id, 'охватил')).correct).toBe(true);
    expect((await attempt(plain!.id, 'обхватил')).correct).toBe(false);
  });
});
