import { randomUUID } from 'node:crypto';
import { schema, syncTaskSkills } from '@zybrilka/db';
import { createFullContentTestDb } from '@zybrilka/db/testing';
import { YASHCHENKO_2027_PROJECT_SOURCE, isExamSkillSlug, taskFeatures } from '@zybrilka/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSimilarTasks } from './service.js';

/**
 * «Решать похожие» v2 on the REAL imported content (математика ЕГЭ-2026,
 * Ященко-2027, русский язык ЕГЭ-2027) — docs/learning/SIMILAR-TASKS.md.
 */
describe('similar tasks: precision on real 2026 / 2027 content', () => {
  let testDb: Awaited<ReturnType<typeof createFullContentTestDb>>;
  type Row = {
    id: string;
    subjectId: string;
    taskNumber: number;
    source: string;
    conditionMd: string;
  };
  let tasks: Row[];
  const subtypeOf = (id: string) => {
    const t = tasks.find((x) => x.id === id)!;
    return taskFeatures(t).subtype;
  };

  async function examSkills(ids: readonly string[]) {
    const rows = await testDb.db
      .select({ taskId: schema.taskSkills.taskId, slug: schema.skills.slug })
      .from(schema.taskSkills)
      .innerJoin(schema.skills, eq(schema.skills.id, schema.taskSkills.skillId))
      .where(inArray(schema.taskSkills.taskId, [...ids]));
    const out = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!isExamSkillSlug(r.slug)) continue;
      out.set(r.taskId, (out.get(r.taskId) ?? new Set()).add(r.slug));
    }
    return out;
  }

  function find(pred: (t: Row & { subtype: string | null }) => boolean) {
    const t = tasks.map((x) => ({ ...x, subtype: taskFeatures(x).subtype })).find(pred);
    if (!t) throw new Error('no such task in the real content');
    return t;
  }

  async function student() {
    const [u] = await testDb.db.insert(schema.users).values({}).returning();
    return u!.id;
  }

  beforeAll(async () => {
    testDb = await createFullContentTestDb();
    await syncTaskSkills(testDb.db);
    tasks = await testDb.db
      .select({
        id: schema.tasks.id,
        subjectId: schema.tasks.subjectId,
        taskNumber: schema.tasks.taskNumber,
        source: schema.tasks.source,
        conditionMd: schema.tasks.conditionMd,
      })
      .from(schema.tasks)
      .where(eq(schema.tasks.status, 'published'));
  }, 120_000);

  afterAll(async () => {
    await testDb.close();
  });

  it('every result tests the same EGE skill as the task (never another skill to fill the list)', async () => {
    for (const target of [
      find(
        (t) =>
          t.subjectId === 'math' &&
          t.taskNumber === 15 &&
          t.source !== YASHCHENKO_2027_PROJECT_SOURCE,
      ),
      find((t) => t.subjectId === 'russian' && t.taskNumber === 9),
      find(
        (t) =>
          t.subjectId === 'math' &&
          t.source === YASHCHENKO_2027_PROJECT_SOURCE &&
          t.taskNumber === 13,
      ),
    ]) {
      const similar = await getSimilarTasks(testDb.db, target.id, 20);
      expect(similar.length).toBeGreaterThan(0);
      const skills = await examSkills([target.id, ...similar.map((s) => s.taskId)]);
      const own = skills.get(target.id)!;
      for (const s of similar) {
        expect([...skills.get(s.taskId)!].some((k) => own.has(k))).toBe(true);
      }
    }
  });

  it('stereometry: the same question (angle between planes) comes before other stereometry tasks', async () => {
    const target = find(
      (t) => t.subjectId === 'math' && (t.subtype ?? '').startsWith('angle-planes'),
    );
    const similar = await getSimilarTasks(testDb.db, target.id, 10);
    const exact = similar.filter((s) => s.match === 'exact');
    expect(exact.length).toBeGreaterThan(0);
    expect(exact.every((s) => subtypeOf(s.taskId) === target.subtype)).toBe(true);
    // exact matches lead the list
    expect(similar.slice(0, exact.length).every((s) => s.match === 'exact')).toBe(true);
  });

  it('the same number, different tasks: Ященко-2027 №13 «кредит» → credit tasks, never equations', async () => {
    const target = find(
      (t) =>
        t.source === YASHCHENKO_2027_PROJECT_SOURCE &&
        t.taskNumber === 13 &&
        (t.subtype ?? '').includes('finance-credit'),
    );
    const similar = await getSimilarTasks(testDb.db, target.id, 20);
    expect(similar.length).toBeGreaterThan(3);
    expect(similar.every((s) => (subtypeOf(s.taskId) ?? '').startsWith('finance'))).toBe(true);
    const firstDeposit = similar.findIndex((s) => subtypeOf(s.taskId)?.includes('deposit'));
    const lastCredit = similar
      .map((s) => subtypeOf(s.taskId)?.includes('credit'))
      .lastIndexOf(true);
    if (firstDeposit >= 0) expect(lastCredit).toBeLessThan(firstDeposit);
    // ЕГЭ-2026 №13 (уравнения) has the same number but another skill.
    const equation13 = tasks.filter(
      (t) =>
        t.subjectId === 'math' &&
        t.taskNumber === 13 &&
        t.source !== YASHCHENKO_2027_PROJECT_SOURCE,
    );
    expect(similar.some((s) => equation13.some((e) => e.id === s.taskId))).toBe(false);
  });

  it('Russian №15: «одна Н» → «одна Н» first, «НН» only after them', async () => {
    const target = find((t) => t.subjectId === 'russian' && t.subtype === 'one-n');
    const similar = await getSimilarTasks(testDb.db, target.id, 20);
    const kinds = similar.map((s) => subtypeOf(s.taskId));
    const firstOther = kinds.findIndex((k) => k !== 'one-n');
    expect(kinds[0]).toBe('one-n');
    if (firstOther >= 0) expect(kinds.slice(firstOther)).not.toContain('one-n');
  });

  it('subtopic: Russian №21 «тире» → tasks on the dash rule first', async () => {
    const target = find((t) => t.subjectId === 'russian' && t.subtype === 'mark-dash');
    const similar = await getSimilarTasks(testDb.db, target.id, 5);
    expect(similar.every((s) => subtypeOf(s.taskId) === 'mark-dash')).toBe(true);
    expect(similar.every((s) => s.match === 'exact')).toBe(true);
  });

  it('widens gradually when exact matches run out — and stops at the skill', async () => {
    const target = find((t) => t.subjectId === 'russian' && t.subtype === 'mark-colon');
    const similar = await getSimilarTasks(testDb.db, target.id, 20);
    const order = { exact: 0, close: 1, topic: 2 } as const;
    const tiers = similar.map((s) => order[s.match!]);
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
    expect(similar.some((s) => s.match !== 'exact')).toBe(true);
    // №21 of the 2027 Russian set: 17 published, so at most 16 others.
    expect(similar.length).toBeLessThanOrEqual(
      tasks.filter((t) => t.subjectId === 'russian' && t.taskNumber === 21).length - 1,
    );
  });

  it('no repeats: excluded, just-answered and the task itself are left out; solved go last', async () => {
    const target = find((t) => t.subjectId === 'russian' && t.subtype === 'one-n');
    const all = await getSimilarTasks(testDb.db, target.id, 20);
    const [first, second, third] = all;
    const userId = await student();
    const now = new Date();
    await testDb.db.insert(schema.attempts).values([
      // answered a minute ago → not offered again right now
      {
        userId,
        taskId: first!.taskId,
        answerRaw: 'x',
        isCorrect: false,
        createdAt: new Date(now.getTime() - 60_000),
      },
      // solved last week → only after the unsolved ones
      {
        userId,
        taskId: second!.taskId,
        answerRaw: 'x',
        isCorrect: true,
        createdAt: new Date(now.getTime() - 7 * 86_400_000),
      },
    ]);
    const personal = await getSimilarTasks(testDb.db, target.id, 20, {
      userId,
      exclude: [third!.taskId],
      now,
    });
    const ids = personal.map((s) => s.taskId);
    expect(ids).not.toContain(first!.taskId);
    expect(ids).not.toContain(third!.taskId);
    expect(ids).not.toContain(target.id);
    expect(ids.at(-1)).toBe(second!.taskId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the student’s open mistake on a rule pulls that rule forward', async () => {
    const target = find((t) => t.subjectId === 'russian' && t.subtype === 'lex-phraseologism');
    const antonym = find((t) => t.subjectId === 'russian' && t.subtype === 'lex-antonym');
    const userId = await student();
    const neutral = await getSimilarTasks(testDb.db, target.id, 20);
    const [attempt] = await testDb.db
      .insert(schema.attempts)
      .values({
        userId,
        taskId: antonym.id,
        answerRaw: 'x',
        isCorrect: false,
        createdAt: new Date(Date.now() - 86_400_000),
      })
      .returning();
    await testDb.db.insert(schema.mistakes).values({
      userId,
      taskId: antonym.id,
      firstAttemptId: attempt!.id,
      lastAttemptId: attempt!.id,
    });
    const personal = await getSimilarTasks(testDb.db, target.id, 20, { userId });
    const pos = (list: typeof neutral) =>
      list.findIndex((s) => subtypeOf(s.taskId) === 'lex-antonym');
    expect(pos(personal)).toBeLessThanOrEqual(pos(neutral));
    // the exact phraseologism matches still lead
    expect(subtypeOf(personal[0]!.taskId)).toBe('lex-phraseologism');
  });

  it('unknown task → empty list', async () => {
    expect(await getSimilarTasks(testDb.db, randomUUID(), 5)).toEqual([]);
  });

  it('deterministic: the same request gives the same list', async () => {
    const target = find(
      (t) =>
        t.subjectId === 'math' && t.taskNumber === 6 && t.source !== YASHCHENKO_2027_PROJECT_SOURCE,
    );
    const a = await getSimilarTasks(testDb.db, target.id, 10);
    const b = await getSimilarTasks(testDb.db, target.id, 10);
    expect(a).toEqual(b);
    // and only tasks of the target's own source scope
    const ids = a.map((s) => s.taskId);
    const rows = await testDb.db
      .select({ source: schema.tasks.source })
      .from(schema.tasks)
      .where(and(inArray(schema.tasks.id, ids)));
    expect(rows.every((r) => r.source !== YASHCHENKO_2027_PROJECT_SOURCE)).toBe(true);
  });
});
