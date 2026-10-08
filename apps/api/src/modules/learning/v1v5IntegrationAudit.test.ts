import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createImportedVariantsTestDb } from '@zybrilka/db/testing';
import { parseMultiPartSpec } from '@zybrilka/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSimilarTasks } from './taskSimilarity/service.js';
import {
  advanceLearningSession,
  getVariantProgress,
  startVariantSession,
} from './learningSession/service.js';
import { getUserErrorStatistics } from './errorSignatures/service.js';
import { getTaskStatisticsEntry } from './taskStatistics/service.js';
import { submitAttempt } from '../tasks/service.js';
import { getNextTaskRecommendation } from './recommendation/service.js';

/**
 * Integration audit (Block "audit ege 2026 variants 1-5 integration")
 * — proves the existing Zybrilka Learning System (not a new one)
 * actually works end-to-end on the real 152-task V1-V8 catalog: Similar
 * Tasks cross-number isolation on the specific pairs requested, all
 * five Variant Sessions through the one generic service, per-task
 * (not per-number) Task Statistics for two same-numbered tasks from
 * different variants, and error-signature detection on a sample of
 * real imported tasks spanning every answer type in the matrix.
 *
 * Each describe block below that WRITES data (attempts, mistakes,
 * statistics) gets its own freshly-imported database in its own
 * `beforeAll` — never the shared read-only db other blocks use —
 * so one block's attempts can never leak into another's counts.
 */
async function taskByVariantNumber(
  db: Awaited<ReturnType<typeof createImportedVariantsTestDb>>['db'],
  variant: number,
  taskNumber: number,
) {
  const [row] = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.subjectId, 'math'),
        eq(schema.tasks.sourceVariant, variant),
        eq(schema.tasks.taskNumber, taskNumber),
      ),
    );
  if (!row) throw new Error(`V${variant} №${taskNumber} not found`);
  return row;
}

/** Builds a plausible-shaped WRONG answer for any task's real
 * answerType, so the generic variant-session walk can submit an
 * attempt to every real task regardless of type without the request
 * being rejected for a shape mismatch — this audit only needs the
 * attempt to be accepted and graded, never to be correct. */
function wrongAnswerFor(task: {
  answerType: string;
  correctAnswer: string;
}): string | Record<string, string> {
  if (task.answerType === 'multi_part') {
    const spec = parseMultiPartSpec(task.correctAnswer);
    if (!spec) throw new Error('multi_part task with unparseable spec');
    return Object.fromEntries(spec.parts.map((p) => [p.id, '__audit_wrong__']));
  }
  return '__audit_wrong__';
}

describe('EGE-2026 V1-V5 integration audit — Similar Tasks (read-only, shared db)', () => {
  let testDb: Awaited<ReturnType<typeof createImportedVariantsTestDb>>;

  beforeAll(async () => {
    testDb = await createImportedVariantsTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it.each([
    [1, 1],
    [2, 7],
    [2, 10],
    [3, 19],
    [4, 5],
    [5, 15],
    [6, 2],
    [6, 13],
  ])(
    'V%i №%i only surfaces same-numbered tasks, never the source, never another subject',
    async (variant, taskNumber) => {
      const task = await taskByVariantNumber(testDb.db, variant, taskNumber);
      const similar = await getSimilarTasks(testDb.db, task.id, 50);
      expect(similar.length).toBeGreaterThan(0);
      expect(similar.every((r) => r.taskNumber === taskNumber)).toBe(true);
      expect(similar.every((r) => r.taskId !== task.id)).toBe(true);

      // Independently confirm the published candidate count in the DB
      // itself matches what the API returned — proves no leakage AND no
      // under-return, without hardcoding an assumed count (the demo seed
      // also publishes a handful of math tasks numbered 1-5, which are
      // legitimately eligible candidates for №1-5).
      const allWithNumber = await testDb.db
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.subjectId, task.subjectId),
            eq(schema.tasks.taskNumber, taskNumber),
            eq(schema.tasks.status, 'published'),
          ),
        );
      expect(similar.length).toBe(allWithNumber.length - 1);
    },
  );

  it('full 152-task matrix: every task of every variant resolves only same-numbered candidates', async () => {
    const rows = await testDb.db
      .select({
        id: schema.tasks.id,
        taskNumber: schema.tasks.taskNumber,
        sourceVariant: schema.tasks.sourceVariant,
      })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'math'),
          eq(schema.tasks.source, 'Ященко ЕГЭ 2026. Типовые экзаменационные варианты'),
        ),
      );
    expect(rows).toHaveLength(152);
    for (const row of rows) {
      const similar = await getSimilarTasks(testDb.db, row.id, 50);
      for (const candidate of similar) {
        expect(candidate.taskNumber).toBe(row.taskNumber);
        expect(candidate.taskId).not.toBe(row.id);
      }
    }
  });
});

describe('EGE-2026 V1-V5 integration audit — Variant Sessions (isolated db)', () => {
  let testDb: Awaited<ReturnType<typeof createImportedVariantsTestDb>>;

  beforeAll(async () => {
    testDb = await createImportedVariantsTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  async function freshUserId(): Promise<string> {
    const userId = randomUUID();
    await testDb.db.insert(schema.users).values({ id: userId });
    return userId;
  }

  it.each([1, 2, 3, 4, 5, 6])(
    'V%i: 19 tasks, order №1→№19, submit, advance, complete — same generic service, no special-casing',
    async (variantNumber) => {
      const [variantRow] = await testDb.db
        .select()
        .from(schema.variants)
        .where(eq(schema.variants.variantNumber, variantNumber));
      const [collection] = await testDb.db
        .select()
        .from(schema.collections)
        .where(eq(schema.collections.id, variantRow!.collectionId));
      expect(collection!.slug).toBe('ege-2026-yashchenko');

      const orderedRows = await testDb.db
        .select()
        .from(schema.variantTasks)
        .innerJoin(schema.tasks, eq(schema.tasks.id, schema.variantTasks.taskId))
        .where(eq(schema.variantTasks.variantId, variantRow!.id))
        .orderBy(schema.variantTasks.position);
      expect(orderedRows).toHaveLength(19);
      expect(orderedRows.map((r) => r.tasks.taskNumber)).toEqual(
        Array.from({ length: 19 }, (_, i) => i + 1),
      );

      const userId = await freshUserId();
      const started = await startVariantSession(testDb.db, userId, variantRow!.id);
      expect(started).not.toBeNull();
      if (!started || started.status !== 'active') throw new Error('unreachable');
      expect(started.total).toBe(19);
      expect(started.position).toBe(1);
      expect(started.task.id).toBe(orderedRows[0]!.tasks.id);

      let sessionId = started.sessionId;
      const servedIds = [started.task.id];
      for (let i = 0; i < 18; i++) {
        const currentTask = orderedRows[i]!.tasks;
        const result = await submitAttempt(testDb.db, currentTask.id, userId, {
          answer: wrongAnswerFor(currentTask) as never,
        });
        expect(result).toBeDefined();

        const next = await advanceLearningSession(testDb.db, userId, sessionId);
        if (!next || next.status !== 'active')
          throw new Error(`V${variantNumber}: unreachable at step ${i}`);
        servedIds.push(next.task.id);
        sessionId = next.sessionId;
      }
      expect(servedIds).toEqual(orderedRows.map((r) => r.tasks.id));

      const lastTask = orderedRows[18]!.tasks;
      await submitAttempt(testDb.db, lastTask.id, userId, {
        answer: wrongAnswerFor(lastTask) as never,
      });
      const finished = await advanceLearningSession(testDb.db, userId, sessionId);
      expect(finished?.status).toBe('completed');
      if (!finished || finished.status !== 'completed') throw new Error('unreachable');
      expect(finished.total).toBe(19);
      expect(finished.variant).toMatchObject({ variantId: variantRow!.id, variantNumber });

      const progress = await getVariantProgress(testDb.db, userId);
      const item = progress.items.find((i) => i.sessionId === finished.sessionId);
      expect(item).toBeDefined();
      expect(item!.plannedCount).toBe(19);
      expect(item!.solvedCount).toBe(19);
    },
  );
});

describe('EGE-2026 V1-V5 integration audit — Task Statistics (isolated db)', () => {
  let testDb: Awaited<ReturnType<typeof createImportedVariantsTestDb>>;

  beforeAll(async () => {
    testDb = await createImportedVariantsTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  async function freshUserId(): Promise<string> {
    const userId = randomUUID();
    await testDb.db.insert(schema.users).values({ id: userId });
    return userId;
  }

  it('V2 №7 and V3 №7 are different tasks (different ids) but both report taskNumber=7, and their statistics never mix', async () => {
    const v2t7 = await taskByVariantNumber(testDb.db, 2, 7);
    const v3t7 = await taskByVariantNumber(testDb.db, 3, 7);
    expect(v2t7.id).not.toBe(v3t7.id);
    expect(v2t7.taskNumber).toBe(7);
    expect(v3t7.taskNumber).toBe(7);

    const userA = await freshUserId();
    const userB = await freshUserId();
    await submitAttempt(testDb.db, v2t7.id, userA, { answer: 'wrong' });
    await submitAttempt(testDb.db, v3t7.id, userB, { answer: 'wrong' });
    await submitAttempt(testDb.db, v3t7.id, userA, { answer: 'wrong' });

    const statsV2 = await getTaskStatisticsEntry(testDb.db, v2t7.id);
    const statsV3 = await getTaskStatisticsEntry(testDb.db, v3t7.id);
    expect(statsV2.attempts).toBe(1);
    expect(statsV3.attempts).toBe(2);
  });
});

describe('EGE-2026 V1-V5 integration audit — Error signatures (isolated db)', () => {
  let testDb: Awaited<ReturnType<typeof createImportedVariantsTestDb>>;

  beforeAll(async () => {
    testDb = await createImportedVariantsTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  async function freshUserId(): Promise<string> {
    const userId = randomUUID();
    await testDb.db.insert(schema.users).values({ id: userId });
    return userId;
  }

  it.each([
    { label: 'V4 №13', variant: 4, taskNumber: 13 },
    { label: 'V4 №19', variant: 4, taskNumber: 19 },
    { label: 'V5 №19', variant: 5, taskNumber: 19 },
    { label: 'V3 №19', variant: 3, taskNumber: 19 },
    { label: 'V2 №15', variant: 2, taskNumber: 15 },
    { label: 'V2 №18', variant: 2, taskNumber: 18 },
  ])(
    '$label (real answerType read from DB): a blank/wrong answer is graded and detected without crashing',
    async ({ variant, taskNumber }) => {
      const task = await taskByVariantNumber(testDb.db, variant, taskNumber);
      const userId = await freshUserId();
      const result = await submitAttempt(testDb.db, task.id, userId, {
        answer: wrongAnswerFor(task) as never,
      });
      expect(result).toBeDefined();
      expect(result!.correct).toBe(false);

      const stats = await getUserErrorStatistics(testDb.db, userId);
      expect(stats.length).toBeGreaterThan(0);
    },
  );
});

describe('EGE-2026 V1-V5 integration audit — Smart Training (isolated db)', () => {
  let testDb: Awaited<ReturnType<typeof createImportedVariantsTestDb>>;

  beforeAll(async () => {
    testDb = await createImportedVariantsTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it('recommends a real published task from the catalog with no per-variant special-casing', async () => {
    const recommendation = await getNextTaskRecommendation(testDb.db, randomUUID(), {
      subjectId: 'math',
    });
    expect(recommendation).not.toBeNull();
    if (!recommendation) throw new Error('unreachable');
    const [row] = await testDb.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, recommendation.taskId));
    expect(row).toBeDefined();
    expect(row!.status).toBe('published');
  });
});
