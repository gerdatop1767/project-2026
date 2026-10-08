import { schema } from '@zybrilka/db';
import { createTestDb } from '@zybrilka/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSimilarTasks } from './service.js';

/**
 * "Решить похожее" (CLAUDE.md) must only ever surface another task of
 * the EXACT same EGE question number as the one the user got wrong —
 * taskNumber is a hard SQL filter on the candidate pool
 * (`getCandidateTasksForSimilarity`), never a scoring weight applied
 * after the fact. These tests build an adversarial scenario (a
 * different-numbered task that would score far HIGHER than any
 * same-numbered one under the existing skills/topic/answerType/
 * difficulty formula) to prove the filter actually excludes it before
 * scoring ever runs, not just that it usually ranks lower.
 */
describe('getSimilarTasks — taskNumber is a hard filter, never a weight', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let targetId: string;
  let sameNumberCloseId: string;
  let sameNumberFarId: string;
  let otherNumberIdenticalId: string;

  beforeAll(async () => {
    testDb = await createTestDb();

    await testDb.db.insert(schema.subjects).values({ id: 'math', name: 'Математика' });

    const [topicA] = await testDb.db
      .insert(schema.topics)
      .values({ subjectId: 'math', slug: 'topic-a', name: 'Тема А' })
      .returning();
    const [topicB] = await testDb.db
      .insert(schema.topics)
      .values({ subjectId: 'math', slug: 'topic-b', name: 'Тема Б' })
      .returning();

    const [skill1] = await testDb.db
      .insert(schema.skills)
      .values({ subjectId: 'math', slug: 'skill-1', name: 'Навык 1' })
      .returning();

    function task(input: {
      taskNumber: number;
      topicId: string;
      difficulty: 1 | 2 | 3;
      answerType: 'short_answer';
    }) {
      return testDb.db
        .insert(schema.tasks)
        .values({
          subjectId: 'math',
          taskNumber: input.taskNumber,
          topicId: input.topicId,
          difficulty: input.difficulty,
          answerType: input.answerType,
          conditionMd: 'Условие.',
          correctAnswer: '42',
          explanationMd: 'Объяснение.',
          source: 'test',
          status: 'published',
        })
        .returning();
    }

    // Target: №5, topic A, skill1, easy.
    const [target] = await task({
      taskNumber: 5,
      topicId: topicA!.id,
      difficulty: 1,
      answerType: 'short_answer',
    });
    targetId = target!.id;
    await testDb.db
      .insert(schema.taskSkills)
      .values({ taskId: targetId, skillId: skill1!.id });

    // Same number (5), but a WORSE match: different topic, no shared
    // skill, different difficulty — should still be the only thing
    // ever returned.
    const [sameNumberFar] = await task({
      taskNumber: 5,
      topicId: topicB!.id,
      difficulty: 3,
      answerType: 'short_answer',
    });
    sameNumberFarId = sameNumberFar!.id;

    // Same number (5), a closer match (same topic, same skill).
    const [sameNumberClose] = await task({
      taskNumber: 5,
      topicId: topicA!.id,
      difficulty: 1,
      answerType: 'short_answer',
    });
    sameNumberCloseId = sameNumberClose!.id;
    await testDb.db
      .insert(schema.taskSkills)
      .values({ taskId: sameNumberCloseId, skillId: skill1!.id });

    // A DIFFERENT number (6) that is an otherwise-PERFECT match: same
    // topic, same skill, same difficulty, same answerType — under pure
    // skills/topic/answerType/difficulty scoring (no number filter)
    // this would outscore both same-number candidates above. It must
    // never appear in the result.
    const [otherNumberIdentical] = await task({
      taskNumber: 6,
      topicId: topicA!.id,
      difficulty: 1,
      answerType: 'short_answer',
    });
    otherNumberIdenticalId = otherNumberIdentical!.id;
    await testDb.db
      .insert(schema.taskSkills)
      .values({ taskId: otherNumberIdenticalId, skillId: skill1!.id });
  });

  afterAll(async () => {
    await testDb.close();
  });

  it('never returns a candidate of a different task number, even one with a far higher raw similarity score', async () => {
    const result = await getSimilarTasks(testDb.db, targetId, 20);
    const resultIds = result.map((r) => r.taskId);

    expect(resultIds).not.toContain(otherNumberIdenticalId);
    expect(result.every((r) => r.taskNumber === 5)).toBe(true);
  });

  it('returns the real same-number candidates when they exist', async () => {
    const result = await getSimilarTasks(testDb.db, targetId, 20);
    const resultIds = result.map((r) => r.taskId);
    expect(resultIds).toContain(sameNumberCloseId);
    expect(resultIds).toContain(sameNumberFarId);
  });

  it('never returns the source task among its own candidates', async () => {
    const result = await getSimilarTasks(testDb.db, targetId, 20);
    expect(result.some((r) => r.taskId === targetId)).toBe(false);
  });

  it('returns an empty list, never a different-numbered substitute, when no other same-number task exists', async () => {
    const [lonelyTask] = await testDb.db
      .insert(schema.tasks)
      .values({
        subjectId: 'math',
        taskNumber: 99,
        difficulty: 2,
        answerType: 'short_answer',
        conditionMd: 'Условие.',
        correctAnswer: '1',
        explanationMd: 'Объяснение.',
        source: 'test',
        status: 'published',
      })
      .returning();

    const result = await getSimilarTasks(testDb.db, lonelyTask!.id, 20);
    expect(result).toEqual([]);
  });

  it('a task of №13 only ever returns other №13 tasks (second concrete number, per the spec examples)', async () => {
    const [topic] = await testDb.db
      .select()
      .from(schema.topics)
      .where(eq(schema.topics.slug, 'topic-a'));

    const [t13a] = await testDb.db
      .insert(schema.tasks)
      .values({
        subjectId: 'math',
        taskNumber: 13,
        topicId: topic!.id,
        difficulty: 2,
        answerType: 'short_answer',
        conditionMd: 'Условие 13а.',
        correctAnswer: '1',
        explanationMd: 'Объяснение.',
        source: 'test',
        status: 'published',
      })
      .returning();
    const [t13b] = await testDb.db
      .insert(schema.tasks)
      .values({
        subjectId: 'math',
        taskNumber: 13,
        topicId: topic!.id,
        difficulty: 2,
        answerType: 'short_answer',
        conditionMd: 'Условие 13б.',
        correctAnswer: '2',
        explanationMd: 'Объяснение.',
        source: 'test',
        status: 'published',
      })
      .returning();
    const [t14] = await testDb.db
      .insert(schema.tasks)
      .values({
        subjectId: 'math',
        taskNumber: 14,
        topicId: topic!.id,
        difficulty: 2,
        answerType: 'short_answer',
        conditionMd: 'Условие 14.',
        correctAnswer: '3',
        explanationMd: 'Объяснение.',
        source: 'test',
        status: 'published',
      })
      .returning();

    const result = await getSimilarTasks(testDb.db, t13a!.id, 20);
    const resultIds = result.map((r) => r.taskId);
    expect(resultIds).toContain(t13b!.id);
    expect(resultIds).not.toContain(t14!.id);
    expect(result.every((r) => r.taskNumber === 13)).toBe(true);
  });
});
