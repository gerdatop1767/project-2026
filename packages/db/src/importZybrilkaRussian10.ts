import { createHash } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Database } from './client.js';
import { isMainModule } from './isMainModule.js';
import * as schema from './schema.js';
import { buildTask10, validateAuthoredTasks10 } from './zybrilkaRussian10/build.js';
import { ALL_TASKS_10 } from './zybrilkaRussian10/extra.js';
import type { AuthoredTask10 } from './zybrilkaRussian10/tasks.js';
import {
  ensureZrCollection,
  ensureZrSet,
  retireLegacyCollection,
  ZR_COLLECTION_SLUG,
} from './zybrilkaRussian/collection.js';

/**
 * Зубрилка's own ЕГЭ Russian task 10 bank (docs/imports/zybrilka-russian-10.md):
 * 100 tasks written for the project on the model of ЕГЭ task 10 (1–50 by
 * hand, 51–100 generated from their checked words: zybrilkaRussian10/extra.ts)
 * (правописание приставок), not taken from any book or from ФИПИ.
 *
 * Its own source; the 10 sets × 10 tasks sit in the one collection of all
 * authored Russian tasks (`zybrilka-russian`, zybrilkaRussian/collection.ts),
 * moved there from the old `zybrilka-russian-10`. Rows of other sources are
 * never matched or changed. Idempotent: a task
 * is upserted by (subject, source, sourceVariant = its number 1…100), the
 * collection by slug, sets by number; ids never change and a row is
 * rewritten only when its content changed. The whole set is validated
 * (rules of every word, answers, duplicates) before anything is written,
 * and imported in one transaction. Nothing is ever deleted; user data is
 * never touched.
 */
export const ZR10_SOURCE = 'Зубрилка. Авторские задания ЕГЭ по русскому языку, №10';
/** №10 lives in the one collection of all authored Russian tasks (zybrilkaRussian/collection.ts). */
export const ZR10_COLLECTION_SLUG = ZR_COLLECTION_SLUG;
export const ZR10_TAG = 'zybrilka-russian-10';
export const ZR10_YEAR = 2027;
export const ZR10_SET_SIZE = 10;
const SUBJECT_ID = 'russian';
const TASK_NUMBER = 10;
const TOPIC = { slug: 'russian-prefix-spelling', name: 'Правописание приставок' };
export function zr10ContentHash(n: number, rawStatement: string): string {
  const normalized = rawStatement.trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256')
    .update(`${SUBJECT_ID}|${ZR10_SOURCE}|${n}|${TASK_NUMBER}|${normalized}`)
    .digest('hex');
}

const setOf = (n: number) => Math.ceil(n / ZR10_SET_SIZE);

export function validateZybrilkaRussian10(tasks: readonly AuthoredTask10[]): void {
  const problems = validateAuthoredTasks10(tasks);
  if (problems.length > 0) {
    throw new Error(`Зубрилка №10 data is invalid:\n- ${problems.join('\n- ')}`);
  }
}

const CONTENT_KEYS = [
  'topicId',
  'difficulty',
  'conditionMd',
  'answerType',
  'digitSetOrderInsensitive',
  'correctAnswer',
  'acceptedAnswers',
  'correctAnswerDisplay',
  'explanationMd',
  'hintMd',
  'sourceUrl',
  'sourceYear',
  'sourceDocument',
  'rawStatement',
  'contentHash',
  'tags',
  'status',
] as const;

export async function importZybrilkaRussian10(
  db: Database,
  tasks: readonly AuthoredTask10[] = ALL_TASKS_10,
) {
  validateZybrilkaRussian10(tasks);
  const built = tasks.map(buildTask10);
  const sets = [...new Set(built.map((t) => setOf(t.n)))];

  return db.transaction(async (tx) => {
    await tx
      .insert(schema.subjects)
      .values({ id: SUBJECT_ID, name: 'Русский язык' })
      .onConflictDoNothing();
    await tx
      .insert(schema.topics)
      .values({ subjectId: SUBJECT_ID, slug: TOPIC.slug, name: TOPIC.name })
      .onConflictDoNothing({ target: [schema.topics.subjectId, schema.topics.slug] });
    const [topic] = await tx
      .select({ id: schema.topics.id })
      .from(schema.topics)
      .where(and(eq(schema.topics.subjectId, SUBJECT_ID), eq(schema.topics.slug, TOPIC.slug)));

    const collectionId = await ensureZrCollection(tx);
    const variantIdBySet = new Map<number, string>();
    for (const set of sets)
      variantIdBySet.set(set, await ensureZrSet(tx, collectionId, TASK_NUMBER, set));
    await retireLegacyCollection(tx, TASK_NUMBER);

    const existing = await tx
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, SUBJECT_ID),
          eq(schema.tasks.source, ZR10_SOURCE),
          eq(schema.tasks.taskNumber, TASK_NUMBER),
        ),
      );
    const existingByN = new Map(existing.map((r) => [r.sourceVariant, r]));
    const counts = { created: 0, updated: 0, unchanged: 0, needsReview: 0 };

    for (const t of built) {
      const set = setOf(t.n);
      const values = {
        subjectId: SUBJECT_ID,
        taskNumber: TASK_NUMBER,
        topicId: topic!.id,
        passageId: null,
        difficulty: t.difficulty,
        conditionMd: t.conditionMd,
        imageUrl: null,
        answerType: 'short_answer' as const,
        digitSetOrderInsensitive: true,
        correctAnswer: t.correctAnswer,
        acceptedAnswers: [] as string[],
        correctAnswerDisplay: t.correctAnswerDisplay,
        explanationMd: t.explanationMd,
        hintMd: t.hintMd,
        solutionSteps: [],
        source: ZR10_SOURCE,
        sourceUrl: null,
        sourceYear: ZR10_YEAR,
        sourceDocument: `Авторское задание Зубрилки по образцу ЕГЭ №10, набор ${set}, задание ${t.n}`,
        sourceVariant: t.n,
        sourcePage: null,
        rawStatement: t.rawStatement,
        contentHash: zr10ContentHash(t.n, t.rawStatement),
        tags: [ZR10_TAG],
        status: t.status,
      };
      if (t.status === 'needs_review') counts.needsReview++;
      const current = existingByN.get(t.n);
      let taskId: string;
      if (!current) {
        const [row] = await tx
          .insert(schema.tasks)
          .values(values)
          .returning({ id: schema.tasks.id });
        taskId = row!.id;
        counts.created++;
      } else {
        taskId = current.id;
        const same = CONTENT_KEYS.every(
          (k) => JSON.stringify(current[k] ?? null) === JSON.stringify(values[k] ?? null),
        );
        if (same) counts.unchanged++;
        else {
          await tx
            .update(schema.tasks)
            .set({ ...values, updatedAt: new Date() })
            .where(eq(schema.tasks.id, current.id));
          counts.updated++;
        }
      }

      const variantId = variantIdBySet.get(set)!;
      const position = ((t.n - 1) % ZR10_SET_SIZE) + 1;
      // One task per position (only the membership row; the task stays).
      await tx
        .delete(schema.variantTasks)
        .where(
          and(
            eq(schema.variantTasks.variantId, variantId),
            eq(schema.variantTasks.position, position),
            ne(schema.variantTasks.taskId, taskId),
          ),
        );
      await tx
        .insert(schema.variantTasks)
        .values({ variantId, taskId, position })
        .onConflictDoUpdate({
          target: [schema.variantTasks.variantId, schema.variantTasks.taskId],
          set: { position },
        });
    }

    return { total: built.length, sets: sets.length, ...counts };
  });
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const client = postgres(databaseUrl, { max: 1 });
  try {
    const r = await importZybrilkaRussian10(drizzle(client, { schema }));
    console.log(
      `Зубрилка №10: ${r.total} tasks in ${r.sets} sets — created ${r.created}, updated ${r.updated}, unchanged ${r.unchanged}, needs_review ${r.needsReview}`,
    );
  } finally {
    await client.end();
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
