import {
  importRussianDoshchinsky2026Book36,
  learningCoverage,
  r26Variants,
  R26_SOURCE,
  schema,
  syncTaskSkills,
} from '@zybrilka/db';
import { createFullContentTestDb } from '@zybrilka/db/testing';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncLearningOnStartup } from '../bootstrap.js';
import { availableTasksBySkill } from './model.js';
import { pickTasksForSkill } from './picker.js';

const silent = { info() {}, warn() {}, error() {} };

/**
 * A new variant reaches the Learning Engine with no code change
 * (docs/learning/IMPORT-INTEGRATION.md): the real Russian ЕГЭ-2026 book
 * importer — not part of the base test content — runs, then the API start
 * step that every deploy runs after `sync-content`.
 */
describe('Learning Engine: automatic connection of new imports', () => {
  let testDb: Awaited<ReturnType<typeof createFullContentTestDb>>;

  beforeAll(async () => {
    testDb = await createFullContentTestDb();
    await syncLearningOnStartup(testDb.db, silent);
  });
  afterAll(async () => {
    await testDb.close();
  });

  it('a newly imported variant is linked to the existing skills — no new or duplicate skills', async () => {
    const skillsBefore = await testDb.db.select({ id: schema.skills.id }).from(schema.skills);
    const variants = r26Variants.slice(0, 2);
    await importRussianDoshchinsky2026Book36(testDb.db, variants);
    const imported = await testDb.db
      .select({ id: schema.tasks.id, n: schema.tasks.taskNumber })
      .from(schema.tasks)
      .where(inArray(schema.tasks.source, [R26_SOURCE]));
    expect(imported.length).toBeGreaterThanOrEqual(27);

    await syncLearningOnStartup(testDb.db, silent);

    const links = await testDb.db
      .select({ taskId: schema.taskSkills.taskId, slug: schema.skills.slug })
      .from(schema.taskSkills)
      .innerJoin(schema.skills, eq(schema.skills.id, schema.taskSkills.skillId))
      .where(
        inArray(
          schema.taskSkills.taskId,
          imported.map((t) => t.id),
        ),
      );
    const slugByTask = new Map(links.map((l) => [l.taskId, l.slug]));
    for (const t of imported) {
      expect(slugByTask.get(t.id), `№${t.n}`).toMatch(
        new RegExp(`^russian\\.${String(t.n).padStart(2, '0')}-`),
      );
    }
    const skillsAfter = await testDb.db.select({ id: schema.skills.id }).from(schema.skills);
    expect(skillsAfter).toHaveLength(skillsBefore.length);
  });

  it('the new tasks are in the training/recommendation pool with no extra step', async () => {
    const available = await availableTasksBySkill(testDb.db);
    // 18 Russian ЕГЭ-2027 variants + the 2 new ЕГЭ-2026 ones, №9 each.
    expect(available.get('russian.09-root-vowels')).toBeGreaterThanOrEqual(20);
    const imported = await testDb.db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.source, R26_SOURCE), eq(schema.tasks.taskNumber, 9)));
    const old = await testDb.db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.taskNumber, 9),
          eq(schema.tasks.subjectId, 'russian'),
          ne(schema.tasks.source, R26_SOURCE),
        ),
      );
    const [user] = await testDb.db.insert(schema.users).values({}).returning();
    const picked = await pickTasksForSkill(testDb.db, user!.id, {
      skillKey: 'russian.09-root-vowels',
      count: 5,
      bucket: 'weak',
      targetDifficulty: 2,
      excludeTaskIds: old.map((t) => t.id),
    });
    expect(picked.length).toBeGreaterThan(0);
    for (const p of picked) expect(imported.map((t) => t.id)).toContain(p.taskId);
  });

  it('the start step also fills statistics missing for links made earlier', async () => {
    const [task] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.subjectId, 'math'))
      .limit(1);
    const [user] = await testDb.db.insert(schema.users).values({}).returning();
    // An answer stored with no statistics row (e.g. history before this step existed).
    await testDb.db
      .insert(schema.attempts)
      .values({ userId: user!.id, taskId: task!.id, answerRaw: 'x', isCorrect: false });
    await syncLearningOnStartup(testDb.db, silent);
    const rows = await testDb.db
      .select()
      .from(schema.userSkillStatistics)
      .where(eq(schema.userSkillStatistics.userId, user!.id));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.attempts).toBe(1);
  });

  it('coverage counts the new tasks automatically and stays complete', async () => {
    const rows = await learningCoverage(testDb.db);
    const russian = rows.filter((r) => r.subjectId === 'russian');
    expect(russian.reduce((n, r) => n + r.unlinked, 0)).toBe(0);
    expect(russian.find((r) => r.examNumber === 9)!.total).toBeGreaterThan(18);
    expect(rows.every((r) => r.unlinked === 0)).toBe(true);
  });

  it('a task of an unknown type is reported for review, never given an invented skill, and does not stop the rest', async () => {
    const [odd] = await testDb.db
      .insert(schema.tasks)
      .values({
        subjectId: 'math',
        taskNumber: 21,
        difficulty: 2,
        conditionMd: 'Задание нового формата (тест).',
        correctAnswer: '1',
        explanationMd: 'Объяснение.',
        source: 'Новый формат 2028',
        sourceYear: 2027,
        status: 'needs_review',
      })
      .returning();
    const result = await syncTaskSkills(testDb.db);
    expect(result.unmapped.map((u) => u.taskId)).toEqual([odd!.id]);
    expect(result.linksCreated).toBe(0);
    const rows = await learningCoverage(testDb.db);
    expect(rows.find((r) => r.skillKey === null)).toMatchObject({ total: 1, unlinked: 1 });
  });
});
