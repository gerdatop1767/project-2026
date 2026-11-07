import { createHash } from 'node:crypto';
import { serializeMultiPartSpec } from '@zybrilka/shared';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Database } from './client.js';
import { isMainModule } from './isMainModule.js';
import { r36Variants } from './russianDoshchinsky36/index.js';
import type { R36Task, R36Variant } from './russianDoshchinsky36/types.js';
import * as schema from './schema.js';

/**
 * «ЕГЭ. Русский язык: типовые экзаменационные варианты: 36 вариантов»
 * (Р. А. Дощинский и др., под ред. Р. А. Дощинского, «Национальное
 * образование», 2027; 336 с.). Tasks 1–26 of every variant; task 27
 * (сочинение) is not part of this import.
 *
 * A separate collection from `ege-2027-doshchinskiy-russian` (Variants
 * 1–18 imported earlier from other PDFs): the texts and tasks differ, so
 * nothing there is overwritten. Answers come from the book's own key
 * (PDF pages 308–325), alternatives («<или>») go to `acceptedAnswers`,
 * «любая другая последовательность этих цифр» to
 * `digitSetOrderInsensitive`. Task texts were transcribed from the OCR
 * and checked against the page scans; explanations are written for this
 * project. A task the transcription or the key could not confirm is
 * `needs_review` and stays hidden from students (see `reviewReason`).
 *
 * Idempotent: tasks are upserted by (subject, source, variant, number),
 * passages by slug, the collection by slug, variants by number.
 *
 * NOT wired into `infra/docker-compose.yml`'s sync-content chain:
 * running it against production is a separate, explicit decision.
 */
export const R36_SOURCE = 'Дощинский ЕГЭ 2027. Русский язык. 36 типовых экзаменационных вариантов';
const SOURCE_YEAR = 2027;
const SUBJECT_ID = 'russian';
const IMPORT_TAG = 'ege-russian-2027-doshchinskiy-36';
export const R36_COLLECTION_SLUG = 'ege-2027-doshchinskiy-russian-36';
const COLLECTION_TITLE = 'ЕГЭ 2027 Дощинский — Русский язык, 36 вариантов';
const COLLECTION_PUBLISHER = 'Дощинский';

function difficultyFor(taskNumber: number): 1 | 2 | 3 {
  return taskNumber === 8 || taskNumber === 22 || taskNumber >= 23 ? 3 : 2;
}

function normalizeForHash(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Source and variant are part of the hash: generic statements repeat across variants. */
function contentHashFor(variant: number, task: R36Task): string {
  return createHash('sha256')
    .update(
      `${SUBJECT_ID}|${R36_SOURCE}|${variant}|${task.taskNumber}|${normalizeForHash(task.rawStatement)}`,
    )
    .digest('hex');
}

function passageSlug(variant: number, key: 'A' | 'B'): string {
  return `r36-v${String(variant).padStart(2, '0')}-passage-${key.toLowerCase()}`;
}

function correctAnswerFor(task: R36Task): string {
  if (task.answerType !== 'multi_part') return task.correctAnswer;
  return serializeMultiPartSpec({
    parts: (task.multiPart ?? []).map((cell) => ({
      id: cell.id,
      label: cell.label,
      answerType: 'short_answer' as const,
      correctAnswer: cell.correctAnswer,
    })),
  });
}

async function importVariant(db: Database, collectionId: string, data: R36Variant) {
  const topicIdBySlug = new Map<string, string>();
  for (const task of data.tasks) {
    if (topicIdBySlug.has(task.topicSlug)) continue;
    const [topic] = await db
      .insert(schema.topics)
      .values({ subjectId: SUBJECT_ID, slug: task.topicSlug, name: task.topicName })
      .onConflictDoNothing({ target: [schema.topics.subjectId, schema.topics.slug] })
      .returning();
    const id =
      topic?.id ??
      (
        await db
          .select({ id: schema.topics.id })
          .from(schema.topics)
          .where(
            and(eq(schema.topics.subjectId, SUBJECT_ID), eq(schema.topics.slug, task.topicSlug)),
          )
      )[0]!.id;
    topicIdBySlug.set(task.topicSlug, id);
  }

  const passageIdByKey = new Map<'A' | 'B', string>();
  for (const key of ['A', 'B'] as const) {
    const p = data.passages[key];
    const slug = passageSlug(data.variant, key);
    const values = {
      title: p.title,
      bodyMd: p.bodyMd,
      sourceAuthor: p.sourceAuthor,
      sourceNote: p.sourceNote,
    };
    const [row] = await db
      .insert(schema.passages)
      .values({ subjectId: SUBJECT_ID, slug, ...values })
      .onConflictDoUpdate({
        target: [schema.passages.subjectId, schema.passages.slug],
        set: { ...values, updatedAt: new Date() },
      })
      .returning();
    passageIdByKey.set(key, row!.id);
  }

  const title = `ЕГЭ 2027 — Дощинский, 36 вариантов — Вариант ${data.variant}`;
  const [variant] = await db
    .insert(schema.variants)
    .values({
      collectionId,
      variantNumber: data.variant,
      title,
      year: SOURCE_YEAR,
      status: 'published',
      sourceFile: data.sourceFile,
      sourcePageStart: data.sourcePageStart,
      sourcePageEnd: data.sourcePageEnd,
    })
    .onConflictDoUpdate({
      target: [schema.variants.collectionId, schema.variants.variantNumber],
      set: {
        title,
        sourceFile: data.sourceFile,
        sourcePageStart: data.sourcePageStart,
        sourcePageEnd: data.sourcePageEnd,
        updatedAt: new Date(),
      },
    })
    .returning();

  const existing = await db
    .select({ id: schema.tasks.id, taskNumber: schema.tasks.taskNumber })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.subjectId, SUBJECT_ID),
        eq(schema.tasks.source, R36_SOURCE),
        eq(schema.tasks.sourceVariant, data.variant),
      ),
    );
  const existingIdByNumber = new Map(existing.map((r) => [r.taskNumber, r.id]));

  for (const task of data.tasks) {
    const values = {
      subjectId: SUBJECT_ID,
      taskNumber: task.taskNumber,
      topicId: topicIdBySlug.get(task.topicSlug),
      passageId: task.passage ? passageIdByKey.get(task.passage)! : null,
      difficulty: difficultyFor(task.taskNumber),
      conditionMd: task.conditionMd,
      imageUrl: null,
      answerType: task.answerType,
      digitSetOrderInsensitive: task.digitSetOrderInsensitive,
      correctAnswer: correctAnswerFor(task),
      acceptedAnswers: [...task.acceptedAnswers],
      correctAnswerDisplay: task.correctAnswerDisplay,
      explanationMd: task.explanationMd,
      hintMd: task.hintMd,
      solutionSteps: [],
      sampleEssayMd: null,
      source: R36_SOURCE,
      sourceUrl: null,
      sourceYear: SOURCE_YEAR,
      sourceDocument: `${data.sourceFile}, вариант ${data.variant}`,
      sourceVariant: data.variant,
      sourcePage: task.sourcePage,
      rawStatement: task.rawStatement,
      contentHash: contentHashFor(data.variant, task),
      tags: [IMPORT_TAG],
      status: task.status,
    };
    const existingId = existingIdByNumber.get(task.taskNumber);
    let taskId: string;
    if (existingId) {
      await db
        .update(schema.tasks)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(schema.tasks.id, existingId));
      taskId = existingId;
    } else {
      const [row] = await db.insert(schema.tasks).values(values).returning({ id: schema.tasks.id });
      taskId = row!.id;
    }
    await db
      .insert(schema.variantTasks)
      .values({ variantId: variant!.id, taskId, position: task.taskNumber })
      .onConflictDoUpdate({
        target: [schema.variantTasks.variantId, schema.variantTasks.taskId],
        set: { position: task.taskNumber },
      });
  }

  return {
    variant: data.variant,
    total: data.tasks.length,
    published: data.tasks.filter((t) => t.status === 'published').length,
    needsReview: data.tasks.filter((t) => t.status === 'needs_review').length,
  };
}

export async function importRussianDoshchinsky36(
  db: Database,
  variants: readonly R36Variant[] = r36Variants,
) {
  await db
    .insert(schema.subjects)
    .values({ id: SUBJECT_ID, name: 'Русский язык' })
    .onConflictDoNothing();
  const [collection] = await db
    .insert(schema.collections)
    .values({
      subjectId: SUBJECT_ID,
      slug: R36_COLLECTION_SLUG,
      title: COLLECTION_TITLE,
      publisher: COLLECTION_PUBLISHER,
      year: SOURCE_YEAR,
      status: 'published',
    })
    .onConflictDoUpdate({
      target: schema.collections.slug,
      set: { title: COLLECTION_TITLE, publisher: COLLECTION_PUBLISHER, year: SOURCE_YEAR },
    })
    .returning();

  const results = [];
  for (const data of variants) results.push(await importVariant(db, collection!.id, data));
  return {
    collectionId: collection!.id,
    variants: results.length,
    total: results.reduce((s, r) => s + r.total, 0),
    published: results.reduce((s, r) => s + r.published, 0),
    needsReview: results.reduce((s, r) => s + r.needsReview, 0),
    perVariant: results,
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const client = postgres(databaseUrl, { max: 1 });
  try {
    const result = await importRussianDoshchinsky36(drizzle(client, { schema }));
    console.log(
      `Imported ${result.total} tasks from ${result.variants} variants of «36 вариантов» (${result.published} published, ${result.needsReview} needs_review).`,
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
