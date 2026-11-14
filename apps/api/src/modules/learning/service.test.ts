import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { parseMultiPartSpec } from '@zybrilka/shared';
import { createImportedTestDb } from '@zybrilka/db/testing';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { syncSkillsFromCanonicalSolutions } from '../skills/sync.js';
import * as repo from './repo.js';
import { getUserMastery, rebuildUserSkillStatistics } from './service.js';

/**
 * These tests never hardcode a taskNumber for the attempt-integration
 * assertions — they resolve a real task that happens to have
 * `task_skills` through the DB itself (`findTaskWithSkills`), exactly
 * as ZUBRILKA LEARNING INTELLIGENCE Phase 3 requires: the system must
 * work for any task with skills, not just #13-19 specifically.
 */
describe('learning module — skill statistics (ZUBRILKA LEARNING INTELLIGENCE Phase 3)', () => {
  let testDb: Awaited<ReturnType<typeof createImportedTestDb>>;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    testDb = await createImportedTestDb();
    await syncSkillsFromCanonicalSolutions(testDb.db);
    app = buildApp({ version: 'test', db: testDb.db });
  });

  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  type TaskRow = typeof schema.tasks.$inferSelect;

  /**
   * The answer a student would send. A multi_part task stores a JSON spec
   * in `correctAnswer` and takes `{ partId: answer }`, so the stored string
   * itself is not a valid answer for it (the API answers 400).
   */
  function answerFor(task: TaskRow, kind: 'correct' | 'wrong'): string | Record<string, string> {
    if (task.answerType === 'multi_part') {
      const spec = parseMultiPartSpec(task.correctAnswer);
      if (!spec) throw new Error(`malformed multi_part spec for task ${task.id}`);
      return Object.fromEntries(
        spec.parts.map((p) => [p.id, kind === 'correct' ? p.correctAnswer : '__wrong__']),
      );
    }
    return kind === 'correct' ? task.correctAnswer : '__definitely_wrong_answer__';
  }

  /** Submits through the real HTTP path and checks it was graded as expected. */
  async function attempt(task: TaskRow, anonId: string, kind: 'correct' | 'wrong') {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${task.id}/attempt`,
      headers: { 'x-anon-id': anonId },
      payload: { answer: answerFor(task, kind) },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().correct).toBe(kind === 'correct');
    return res;
  }

  /** Task–skill links in a stable order: physical row order is not a contract. */
  function skillLinks() {
    return testDb.db
      .select()
      .from(schema.taskSkills)
      .orderBy(asc(schema.taskSkills.taskId), asc(schema.taskSkills.skillId));
  }

  /** Any real task with at least 2 linked skills — not assumed to be #13. */
  async function findTaskWithMultipleSkills() {
    const links = await skillLinks();
    const byTask = new Map<string, string[]>();
    for (const link of links) {
      const list = byTask.get(link.taskId) ?? [];
      list.push(link.skillId);
      byTask.set(link.taskId, list);
    }
    const [taskId, skillIds] = [...byTask.entries()].find(([, ids]) => ids.length >= 2)!;
    const [task] = await testDb.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    return { task: task!, skillIds };
  }

  it('one attempt on a multi-skill task updates every linked skill (never a taskNumber check)', async () => {
    const { task, skillIds } = await findTaskWithMultipleSkills();
    const anonId = randomUUID();

    await attempt(task, anonId, 'correct');

    for (const skillId of skillIds) {
      const stats = await repo.getUserSkillStatisticsForSkill(testDb.db, anonId, skillId);
      expect(stats).toBeDefined();
      expect(stats!.attempts).toBe(1);
      expect(stats!.correctAttempts).toBe(1);
      expect(stats!.incorrectAttempts).toBe(0);
    }
  });

  it('a wrong answer updates all linked skills as incorrect too', async () => {
    const { task, skillIds } = await findTaskWithMultipleSkills();
    const anonId = randomUUID();

    await attempt(task, anonId, 'wrong');

    for (const skillId of skillIds) {
      const stats = await repo.getUserSkillStatisticsForSkill(testDb.db, anonId, skillId);
      expect(stats!.attempts).toBe(1);
      expect(stats!.correctAttempts).toBe(0);
      expect(stats!.incorrectAttempts).toBe(1);
      expect(stats!.mastery).toBe(0);
    }
  });

  it('two attempts on two different tasks sharing one skill both count toward that skill', async () => {
    const links = await skillLinks();
    const bySkill = new Map<string, string[]>();
    for (const link of links) {
      const list = bySkill.get(link.skillId) ?? [];
      list.push(link.taskId);
      bySkill.set(link.skillId, list);
    }
    const [skillId, taskIds] = [...bySkill.entries()].find(([, ids]) => ids.length >= 2)!;
    const anonId = randomUUID();

    for (const taskId of taskIds) {
      const [task] = await testDb.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
      await attempt(task!, anonId, 'correct');
    }

    const stats = await repo.getUserSkillStatisticsForSkill(testDb.db, anonId, skillId);
    expect(stats!.attempts).toBe(taskIds.length);
    expect(stats!.correctAttempts).toBe(taskIds.length);
  });

  it('a multi_part task counts toward a shared skill like any other task', async () => {
    // Regression: a multi_part task (part 2 with items а/б/в) takes its
    // answer as { partId: answer }; it must update a skill it shares with
    // another task exactly like a single-answer task does.
    const links = await skillLinks();
    const tasks = new Map(
      (await testDb.db.select().from(schema.tasks)).map((t) => [t.id, t] as const),
    );
    const bySkill = new Map<string, string[]>();
    for (const link of links) {
      bySkill.set(link.skillId, [...(bySkill.get(link.skillId) ?? []), link.taskId]);
    }
    const shared = [...bySkill.entries()].find(
      ([, ids]) => ids.length >= 2 && ids.some((id) => tasks.get(id)?.answerType === 'multi_part'),
    );
    expect(shared, 'the imported content has a multi_part task sharing a skill').toBeDefined();
    const [skillId, taskIds] = shared!;
    const anonId = randomUUID();
    for (const taskId of taskIds) await attempt(tasks.get(taskId)!, anonId, 'correct');

    const stats = await repo.getUserSkillStatisticsForSkill(testDb.db, anonId, skillId);
    expect(stats!.attempts).toBe(taskIds.length);
    expect(stats!.correctAttempts).toBe(taskIds.length);
    expect(stats!.incorrectAttempts).toBe(0);
  });

  it('never mixes skill statistics between two different users', async () => {
    const { task, skillIds } = await findTaskWithMultipleSkills();
    const userOne = randomUUID();
    const userTwo = randomUUID();

    await attempt(task, userOne, 'correct');

    for (const skillId of skillIds) {
      const userTwoStats = await repo.getUserSkillStatisticsForSkill(testDb.db, userTwo, skillId);
      expect(userTwoStats).toBeUndefined();
    }
  });

  describe('rebuildUserSkillStatistics', () => {
    it('rebuilds identical statistics from historical attempts after a clean wipe', async () => {
      const { task, skillIds } = await findTaskWithMultipleSkills();
      const anonId = randomUUID();

      // Build up real history via the HTTP attempt path (one right, one wrong).
      await attempt(task, anonId, 'correct');
      await attempt(task, anonId, 'wrong');

      const before = await repo.getUserSkillStatistics(testDb.db, anonId);
      expect(before.length).toBeGreaterThan(0);

      await repo.deleteUserSkillStatistics(testDb.db, anonId);
      const wiped = await repo.getUserSkillStatistics(testDb.db, anonId);
      expect(wiped).toHaveLength(0);

      const result = await rebuildUserSkillStatistics(testDb.db, anonId);
      expect(result.skillsUpdated).toBe(skillIds.length);

      const after = await repo.getUserSkillStatistics(testDb.db, anonId);
      const sortByo = (rows: typeof after) =>
        [...rows].sort((a, b) => a.skillId.localeCompare(b.skillId));
      expect(sortByo(after)).toEqual(sortByo(before));
    });

    it('running rebuild twice in a row is idempotent', async () => {
      const { task } = await findTaskWithMultipleSkills();
      const anonId = randomUUID();
      await attempt(task, anonId, 'correct');

      const first = await rebuildUserSkillStatistics(testDb.db, anonId);
      const firstRows = await repo.getUserSkillStatistics(testDb.db, anonId);
      const second = await rebuildUserSkillStatistics(testDb.db, anonId);
      const secondRows = await repo.getUserSkillStatistics(testDb.db, anonId);

      expect(second.skillsUpdated).toBe(first.skillsUpdated);
      const sortByo = (rows: typeof firstRows) =>
        [...rows].sort((a, b) => a.skillId.localeCompare(b.skillId));
      expect(sortByo(secondRows)).toEqual(sortByo(firstRows));
    });

    it('does not create duplicate rows on repeated rebuilds', async () => {
      const { task } = await findTaskWithMultipleSkills();
      const anonId = randomUUID();
      await attempt(task, anonId, 'correct');

      await rebuildUserSkillStatistics(testDb.db, anonId);
      await rebuildUserSkillStatistics(testDb.db, anonId);

      const rows = await testDb.db
        .select()
        .from(schema.userSkillStatistics)
        .where(eq(schema.userSkillStatistics.userId, anonId));
      const uniqueSkillIds = new Set(rows.map((r) => r.skillId));
      expect(rows).toHaveLength(uniqueSkillIds.size);
    });
  });

  describe('getUserMastery', () => {
    it('returns an empty array for a user with no attempts', async () => {
      const entries = await getUserMastery(testDb.db, randomUUID());
      expect(entries).toEqual([]);
    });

    it('returns subject/skill info alongside mastery and confidence', async () => {
      const { task } = await findTaskWithMultipleSkills();
      const anonId = randomUUID();
      await attempt(task, anonId, 'correct');

      const entries = await getUserMastery(testDb.db, anonId);
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.subjectId).toBe('math');
        expect(typeof entry.skillSlug).toBe('string');
        expect(typeof entry.skillName).toBe('string');
        expect(entry.mastery).toBeGreaterThanOrEqual(0);
        expect(entry.mastery).toBeLessThanOrEqual(100);
        expect(entry.confidence).toBeGreaterThanOrEqual(0);
        expect(entry.confidence).toBeLessThanOrEqual(100);
        expect(entry.attempts).toBe(1);
        expect(entry.lastAttemptAt).not.toBeNull();
      }
    });
  });
});
