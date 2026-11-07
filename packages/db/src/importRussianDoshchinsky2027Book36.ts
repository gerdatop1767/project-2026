import { createHash } from 'node:crypto';
import { serializeMultiPartSpec } from '@zybrilka/shared';
import { and, eq, ne } from 'drizzle-orm';
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
 * Runs in `infra/docker-compose.yml`'s sync-content chain after the
 * 18-variant Дощинский importers. The data is validated before any
 * write (36 variants, tasks 1–26 each, valid repeat references) and the
 * whole book is imported in one transaction, so a failure exits non-zero
 * with nothing half-written. Existing task rows keep their ids; content
 * columns are rewritten only when they changed. Attempts, mistakes,
 * favorites and other user data are never touched.
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
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.subjectId, SUBJECT_ID),
        eq(schema.tasks.source, R36_SOURCE),
        eq(schema.tasks.sourceVariant, data.variant),
      ),
    );
  const existingByNumber = new Map(existing.map((r) => [r.taskNumber, r]));
  const counts = { created: 0, updated: 0, unchanged: 0, reused: 0, unlinked: 0 };

  for (const task of data.tasks) {
    let taskId: string;
    if (task.sameAs) {
      // The book repeats this task from an earlier variant: link that row
      // into this variant instead of storing a copy.
      const [original] = await db
        .select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.subjectId, SUBJECT_ID),
            eq(schema.tasks.source, R36_SOURCE),
            eq(schema.tasks.sourceVariant, task.sameAs.variant),
            eq(schema.tasks.taskNumber, task.sameAs.taskNumber),
          ),
        );
      if (!original) {
        throw new Error(
          `В${data.variant} №${task.taskNumber} repeats В${task.sameAs.variant} №${task.sameAs.taskNumber}, which is not imported yet`,
        );
      }
      taskId = original.id;
      counts.reused++;
    } else {
      const values = {
        subjectId: SUBJECT_ID,
        taskNumber: task.taskNumber,
        topicId: topicIdBySlug.get(task.topicSlug) ?? null,
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
      const current = existingByNumber.get(task.taskNumber);
      if (!current) {
        const [row] = await db
          .insert(schema.tasks)
          .values(values)
          .returning({ id: schema.tasks.id });
        taskId = row!.id;
        counts.created++;
      } else {
        taskId = current.id;
        // Only content columns are written, and only when something
        // changed: the row id (and everything users attached to it —
        // attempts, mistakes, favorites) never changes, and an unchanged
        // task keeps its updatedAt.
        if (sameContent(current, values)) {
          counts.unchanged++;
        } else {
          await db
            .update(schema.tasks)
            .set({ ...values, updatedAt: new Date() })
            .where(eq(schema.tasks.id, current.id));
          counts.updated++;
        }
      }
    }

    // One task per position: drop a link at this position that points to
    // another task (e.g. a stale own row left from before a task was
    // recognised as a repeat). Only the membership row goes; the task row
    // and its user data stay.
    const stale = await db
      .delete(schema.variantTasks)
      .where(
        and(
          eq(schema.variantTasks.variantId, variant!.id),
          eq(schema.variantTasks.position, task.taskNumber),
          ne(schema.variantTasks.taskId, taskId),
        ),
      )
      .returning({ id: schema.variantTasks.taskId });
    counts.unlinked += stale.length;
    await db
      .insert(schema.variantTasks)
      .values({ variantId: variant!.id, taskId, position: task.taskNumber })
      .onConflictDoUpdate({
        target: [schema.variantTasks.variantId, schema.variantTasks.taskId],
        set: { position: task.taskNumber },
      });
  }

  // A stale own row of a repeated task is no longer in any variant: hide it
  // (never delete — it may carry user attempts).
  for (const task of data.tasks) {
    const own = existingByNumber.get(task.taskNumber);
    if (task.sameAs && own && own.status !== 'archived') {
      await db
        .update(schema.tasks)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(eq(schema.tasks.id, own.id));
    }
  }

  return {
    variant: data.variant,
    total: data.tasks.length,
    published: data.tasks.filter((t) => !t.sameAs && t.status === 'published').length,
    needsReview: data.tasks.filter((t) => !t.sameAs && t.status === 'needs_review').length,
    ...counts,
  };
}

const CONTENT_KEYS = [
  'topicId',
  'passageId',
  'difficulty',
  'conditionMd',
  'imageUrl',
  'answerType',
  'digitSetOrderInsensitive',
  'correctAnswer',
  'acceptedAnswers',
  'correctAnswerDisplay',
  'explanationMd',
  'hintMd',
  'solutionSteps',
  'sampleEssayMd',
  'sourceUrl',
  'sourceYear',
  'sourceDocument',
  'sourcePage',
  'rawStatement',
  'contentHash',
  'tags',
  'status',
] as const;

function sameContent(
  row: typeof schema.tasks.$inferSelect,
  values: Record<(typeof CONTENT_KEYS)[number], unknown>,
): boolean {
  return CONTENT_KEYS.every(
    (key) => JSON.stringify(row[key] ?? null) === JSON.stringify(values[key] ?? null),
  );
}

/** Variants the book has; the import refuses to run on anything else. */
export const R36_VARIANT_COUNT = 36;
const TASKS_PER_VARIANT = 26;

/**
 * Checks the whole data set before anything is written, so a broken or
 * incomplete build fails loudly instead of importing part of the book.
 */
export function validateR36Variants(variants: readonly R36Variant[]): void {
  const problems: string[] = [];
  const numbers = variants.map((v) => v.variant);
  if (new Set(numbers).size !== numbers.length) problems.push('variant numbers repeat');
  const byNumber = new Map(variants.map((v) => [v.variant, v]));
  for (const v of variants) {
    const taskNumbers = v.tasks.map((t) => t.taskNumber).join(',');
    const expected = Array.from({ length: TASKS_PER_VARIANT }, (_, i) => i + 1).join(',');
    if (taskNumbers !== expected)
      problems.push(`В${v.variant}: tasks are not 1–${TASKS_PER_VARIANT}`);
    for (const t of v.tasks) {
      if (t.status === 'needs_review' && !t.reviewReason)
        problems.push(`В${v.variant} №${t.taskNumber}: needs_review without a reason`);
      if (!t.sameAs) continue;
      const original = byNumber
        .get(t.sameAs.variant)
        ?.tasks.find((x) => x.taskNumber === t.sameAs!.taskNumber);
      if (t.sameAs.variant >= v.variant || !original || original.sameAs)
        problems.push(`В${v.variant} №${t.taskNumber}: bad sameAs reference`);
    }
  }
  if (problems.length > 0)
    throw new Error(`«36 вариантов» data is invalid:\n- ${problems.join('\n- ')}`);
}

export async function importRussianDoshchinsky36(
  db: Database,
  variants: readonly R36Variant[] = r36Variants,
) {
  validateR36Variants(variants);
  if (variants === r36Variants && variants.length !== R36_VARIANT_COUNT) {
    throw new Error(
      `«36 вариантов»: expected ${R36_VARIANT_COUNT} variants in the data, found ${variants.length}`,
    );
  }
  const ordered = [...variants].sort((a, b) => a.variant - b.variant);

  // One transaction: either the whole book is imported or nothing changes.
  return db.transaction(async (tx) => {
    await tx
      .insert(schema.subjects)
      .values({ id: SUBJECT_ID, name: 'Русский язык' })
      .onConflictDoNothing();
    const [collection] = await tx
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

    const results: Awaited<ReturnType<typeof importVariant>>[] = [];
    for (const data of ordered) results.push(await importVariant(tx, collection!.id, data));
    const sum = (
      key:
        | 'total'
        | 'published'
        | 'needsReview'
        | 'created'
        | 'updated'
        | 'unchanged'
        | 'reused'
        | 'unlinked',
    ) => results.reduce((s, r) => s + r[key], 0);
    return {
      collectionId: collection!.id,
      variants: results.length,
      /** Positions in variants (26 per variant). */
      total: sum('total'),
      /** Distinct task rows (positions minus the repeats linked to an earlier variant). */
      unique: sum('total') - sum('reused'),
      published: sum('published'),
      needsReview: sum('needsReview'),
      /** Positions filled by an earlier variant's identical task (no new row). */
      reused: sum('reused'),
      created: sum('created'),
      updated: sum('updated'),
      unchanged: sum('unchanged'),
      unlinked: sum('unlinked'),
      perVariant: results,
    };
  });
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const client = postgres(databaseUrl, { max: 1 });
  try {
    const r = await importRussianDoshchinsky36(drizzle(client, { schema }));
    const review = r.perVariant.filter((v) => v.needsReview > 0).map((v) => `В${v.variant}`);
    console.log(
      `Imported «36 вариантов» (Russian): ${r.variants} variants, ${r.total} positions, ${r.unique} unique tasks ` +
        `(${r.published} published, ${r.needsReview} needs_review${review.length ? `: ${review.join(', ')}` : ''}; ` +
        `${r.reused} repeats linked) — rows created ${r.created}, updated ${r.updated}, unchanged ${r.unchanged}` +
        (r.unlinked ? `, stale links removed ${r.unlinked}` : '') +
        '.',
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
