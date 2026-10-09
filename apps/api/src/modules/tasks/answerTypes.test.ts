import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createTestDb } from '@zybrilka/db/testing';
import { serializeMultiPartSpec } from '@zybrilka/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';

/**
 * S3.1 — proves the new 'interval' and 'multi_part' answer types are
 * graded correctly end to end through the real API, and that a
 * mismatched answer shape (object for a non-multi_part task, or vice
 * versa) is a 400, never a 500.
 */
describe('interval and multi_part answer types', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let app: ReturnType<typeof buildApp>;
  let intervalTaskId: string;
  let multiPartTaskId: string;
  let essayTaskId: string;

  beforeAll(async () => {
    testDb = await createTestDb();
    app = buildApp({ version: 'test', db: testDb.db });

    await testDb.db
      .insert(schema.subjects)
      .values({ id: 'math', name: 'Математика' })
      .onConflictDoNothing();

    const [intervalTask] = await testDb.db
      .insert(schema.tasks)
      .values({
        subjectId: 'math',
        taskNumber: 15,
        difficulty: 3,
        conditionMd: 'Решите неравенство (интервальный ответ).',
        answerType: 'interval',
        correctAnswer: '(log_5(2);log_5(8)) ∪ (log_5(8);log_3(8)]',
        explanationMd: 'Объяснение.',
        source: 'test',
        status: 'published',
      })
      .returning();
    intervalTaskId = intervalTask!.id;

    const [multiPartTask] = await testDb.db
      .insert(schema.tasks)
      .values({
        subjectId: 'math',
        taskNumber: 19,
        difficulty: 3,
        conditionMd: 'Задача с тремя пунктами а/б/в.',
        answerType: 'multi_part',
        correctAnswer: serializeMultiPartSpec({
          parts: [
            { id: 'a', label: 'а', answerType: 'short_answer', correctAnswer: 'нет' },
            { id: 'b', label: 'б', answerType: 'short_answer', correctAnswer: '607' },
            { id: 'c', label: 'в', answerType: 'short_answer', correctAnswer: '1066' },
          ],
        }),
        explanationMd: '### А\n...\n### Б\n...\n### В\n...',
        source: 'test',
        status: 'published',
      })
      .returning();
    multiPartTaskId = multiPartTask!.id;

    const [essayTask] = await testDb.db
      .insert(schema.tasks)
      .values({
        subjectId: 'math',
        taskNumber: 27,
        difficulty: 3,
        conditionMd: 'Задание с развёрнутым ответом (сочинение) — тест.',
        answerType: 'essay',
        correctAnswer: '',
        explanationMd: 'Нет единственного правильного ответа.',
        source: 'test',
        status: 'needs_review',
      })
      .returning();
    essayTaskId = essayTask!.id;
  });

  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  describe('interval', () => {
    it('accepts an equivalent notation as correct', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${intervalTaskId}/attempt`,
        headers: { 'x-anon-id': randomUUID() },
        payload: { answer: '(log_5(2),log_5(8)) U (log_5(8),log_3(8)]' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().correct).toBe(true);
    });

    it('rejects a wrong interval', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${intervalTaskId}/attempt`,
        headers: { 'x-anon-id': randomUUID() },
        payload: { answer: '(0;1]' },
      });
      expect(res.json().correct).toBe(false);
    });

    it('an unparseable interval string is graded incorrect, not a 500', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${intervalTaskId}/attempt`,
        headers: { 'x-anon-id': randomUUID() },
        payload: { answer: 'совсем не интервал' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().correct).toBe(false);
    });

    it('rejects an object payload for an interval task with 400, not 500', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${intervalTaskId}/attempt`,
        headers: { 'x-anon-id': randomUUID() },
        payload: { answer: { a: '1' } },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_answer_shape');
    });
  });

  describe('multi_part', () => {
    it('grades all parts correct', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${multiPartTaskId}/attempt`,
        headers: { 'x-anon-id': randomUUID() },
        payload: { answer: { a: 'нет', b: '607', c: '1066' } },
      });
      const body = res.json();
      expect(body.correct).toBe(true);
      expect(body.partStatus).toBe('all_correct');
      expect(body.correctParts).toBe(3);
      expect(body.totalParts).toBe(3);
      expect(body.mistakeId).toBeNull();
    });

    it('grades a partially-correct attempt and creates a mistake with only the wrong parts', async () => {
      const anonId = randomUUID();
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${multiPartTaskId}/attempt`,
        headers: { 'x-anon-id': anonId },
        payload: { answer: { a: 'нет', b: 'wrong', c: '1066' } },
      });
      const body = res.json();
      expect(body.correct).toBe(false);
      expect(body.partStatus).toBe('partially_correct');
      expect(body.correctParts).toBe(2);
      expect(body.parts).toEqual([
        { id: 'a', label: 'а', correct: true },
        { id: 'b', label: 'б', correct: false },
        { id: 'c', label: 'в', correct: true },
      ]);
      expect(body.mistakeId).not.toBeNull();

      const [mistake] = await testDb.db
        .select()
        .from(schema.mistakes)
        .where(eqBoth(anonId, multiPartTaskId));
      expect(mistake?.wrongParts).toEqual(['b']);
      expect(mistake?.status).toBe('open');
    });

    it('resolving the mistake later keeps history but a fully correct retry updates status', async () => {
      const anonId = randomUUID();
      await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${multiPartTaskId}/attempt`,
        headers: { 'x-anon-id': anonId },
        payload: { answer: { a: 'да', b: '1', c: '2' } },
      });
      await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${multiPartTaskId}/attempt`,
        headers: { 'x-anon-id': anonId },
        payload: { answer: { a: 'нет', b: '607', c: '1066' } },
      });
      const [mistake] = await testDb.db
        .select()
        .from(schema.mistakes)
        .where(eqBoth(anonId, multiPartTaskId));
      expect(mistake?.status).toBe('resolved');

      const allAttempts = await testDb.db
        .select()
        .from(schema.attempts)
        .where(eqTask(multiPartTaskId));
      expect(allAttempts.length).toBeGreaterThanOrEqual(2);
    });

    it('rejects a plain string payload for a multi_part task with 400, not 500', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${multiPartTaskId}/attempt`,
        headers: { 'x-anon-id': randomUUID() },
        payload: { answer: '607' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_answer_shape');
    });

    it('a missing part in the payload is graded incorrect for that part, not a crash', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${multiPartTaskId}/attempt`,
        headers: { 'x-anon-id': randomUUID() },
        payload: { answer: { a: 'нет', c: '1066' } },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.partStatus).toBe('partially_correct');
      expect(body.correctParts).toBe(2);
    });
  });

  describe('essay', () => {
    it('rejects any attempt against an essay task with 400, never a 500 or a grade', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${essayTaskId}/attempt`,
        headers: { 'x-anon-id': randomUUID() },
        payload: { answer: 'Полный текст сочинения...' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('essay_not_gradable');
    });

    it('records no attempt row for a rejected essay submission', async () => {
      const anonId = randomUUID();
      await app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${essayTaskId}/attempt`,
        headers: { 'x-anon-id': anonId },
        payload: { answer: 'Текст сочинения' },
      });
      const rows = await testDb.db.select().from(schema.attempts).where(eqTask(essayTaskId));
      expect(rows).toHaveLength(0);
    });

    it('fetching the essay task still works (no correctAnswer leaked)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/tasks/${essayTaskId}`,
        headers: { 'x-anon-id': randomUUID() },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().answerType).toBe('essay');
    });

    it('exposes explanationMd up front, with NO attempt ever recorded — essay tasks never gate their explanation behind an attempt that can never happen', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/tasks/${essayTaskId}`,
        headers: { 'x-anon-id': randomUUID() },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.explanationMd).toBe('Нет единственного правильного ответа.');
      expect(body.correctAnswer).toBe('');
    });

    it('explanationMd is also visible with no anon-id/userId at all (anonymous browsing)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/tasks/${essayTaskId}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().explanationMd).toBe('Нет единственного правильного ответа.');
    });
  });

  function eqBoth(anonId: string, taskId: string) {
    return and(eq(schema.mistakes.userId, anonId), eq(schema.mistakes.taskId, taskId));
  }
  function eqTask(taskId: string) {
    return eq(schema.attempts.taskId, taskId);
  }
});
