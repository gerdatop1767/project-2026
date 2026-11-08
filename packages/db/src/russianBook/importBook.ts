import { createHash } from 'node:crypto';
import { serializeMultiPartSpec } from '@zybrilka/shared';
import { and, eq, ne } from 'drizzle-orm';
import type { Database } from '../client.js';
import * as schema from '../schema.js';
import type { RussianBookTask, RussianBookVariant } from './types.js';

/**
 * Shared importer for printed Russian-language variant books (one
 * collection per book, data in `RussianBookVariant` modules). Each book has
 * a thin entry point with its own `RussianBookConfig`
 * (`importRussianDoshchinsky2027Book36.ts`, `importRussianDoshchinsky2026Book36.ts`).
 *
 * Idempotent: tasks are upserted by (subject, source, variant, number),
 * passages by slug, the collection by slug, variants by number. The data is
 * validated before any write and the whole book is imported in one
 * transaction, so a failure leaves nothing half-written. Existing task rows
 * keep their ids; content columns are rewritten only when they changed.
 * Attempts, mistakes, favorites and other user data are never touched.
 */
export interface RussianBookConfig {
  /** Name used in messages, e.g. «36 вариантов». */
  label: string;
  /** `tasks.source` — together with the variant number it identifies a task row. */
  source: string;
  year: number;
  importTag: string;
  collectionSlug: string;
  collectionTitle: string;
  publisher: string;
  /** Passage slug prefix, e.g. 'r36' → `r36-v01-passage-a`. */
  passageSlugPrefix: string;
  variantTitle: (variant: number) => string;
  variantCount: number;
  /** Tasks per variant, numbered 1…N (26 without the essay, 27 with it). */
  tasksPerVariant: number;
}

const SUBJECT_ID = 'russian';

function difficultyFor(taskNumber: number): 1 | 2 | 3 {
  return taskNumber === 8 || taskNumber === 22 || taskNumber >= 23 ? 3 : 2;
}

function normalizeForHash(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Source and variant are part of the hash: generic statements repeat across variants. */
function contentHashFor(config: RussianBookConfig, variant: number, task: RussianBookTask): string {
  return createHash('sha256')
    .update(
      `${SUBJECT_ID}|${config.source}|${variant}|${task.taskNumber}|${normalizeForHash(task.rawStatement)}`,
    )
    .digest('hex');
}

function passageSlug(config: RussianBookConfig, variant: number, key: 'A' | 'B'): string {
  return `${config.passageSlugPrefix}-v${String(variant).padStart(2, '0')}-passage-${key.toLowerCase()}`;
}

function correctAnswerFor(task: RussianBookTask): string {
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

async function importVariant(
  db: Database,
  config: RussianBookConfig,
  collectionId: string,
  data: RussianBookVariant,
) {
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
    const slug = passageSlug(config, data.variant, key);
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

  const title = config.variantTitle(data.variant);
  const [variant] = await db
    .insert(schema.variants)
    .values({
      collectionId,
      variantNumber: data.variant,
      title,
      year: config.year,
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
        eq(schema.tasks.source, config.source),
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
            eq(schema.tasks.source, config.source),
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
        sampleEssayMd: task.sampleEssayMd ?? null,
        source: config.source,
        sourceUrl: null,
        sourceYear: config.year,
        sourceDocument: `${data.sourceFile}, вариант ${data.variant}`,
        sourceVariant: data.variant,
        sourcePage: task.sourcePage,
        rawStatement: task.rawStatement,
        contentHash: contentHashFor(config, data.variant, task),
        tags: [config.importTag],
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

/**
 * Checks the whole data set before anything is written, so a broken or
 * incomplete build fails loudly instead of importing part of the book.
 */
export function validateBookVariants(
  config: RussianBookConfig,
  variants: readonly RussianBookVariant[],
): void {
  const n = config.tasksPerVariant;
  const problems: string[] = [];
  const numbers = variants.map((v) => v.variant);
  if (new Set(numbers).size !== numbers.length) problems.push('variant numbers repeat');
  const byNumber = new Map(variants.map((v) => [v.variant, v]));
  for (const v of variants) {
    const taskNumbers = v.tasks.map((t) => t.taskNumber).join(',');
    const expected = Array.from({ length: n }, (_, i) => i + 1).join(',');
    if (taskNumbers !== expected) problems.push(`В${v.variant}: tasks are not 1–${n}`);
    for (const t of v.tasks) {
      if (t.status === 'needs_review' && !t.reviewReason)
        problems.push(`В${v.variant} №${t.taskNumber}: needs_review without a reason`);
      if (t.answerType === 'essay' && (t.correctAnswer !== '' || t.acceptedAnswers.length > 0))
        problems.push(`В${v.variant} №${t.taskNumber}: an essay has no correct answer`);
      if (t.answerType !== 'essay' && t.sampleEssayMd)
        problems.push(`В${v.variant} №${t.taskNumber}: sample essay on a non-essay task`);
      if (!t.sameAs) continue;
      const original = byNumber
        .get(t.sameAs.variant)
        ?.tasks.find((x) => x.taskNumber === t.sameAs!.taskNumber);
      if (t.sameAs.variant >= v.variant || !original || original.sameAs)
        problems.push(`В${v.variant} №${t.taskNumber}: bad sameAs reference`);
    }
  }
  if (problems.length > 0)
    throw new Error(`${config.label} data is invalid:\n- ${problems.join('\n- ')}`);
}

export async function importRussianBook(
  db: Database,
  config: RussianBookConfig,
  variants: readonly RussianBookVariant[],
  options: { requireAllVariants: boolean },
) {
  validateBookVariants(config, variants);
  if (options.requireAllVariants && variants.length !== config.variantCount) {
    throw new Error(
      `${config.label}: expected ${config.variantCount} variants in the data, found ${variants.length}`,
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
        slug: config.collectionSlug,
        title: config.collectionTitle,
        publisher: config.publisher,
        year: config.year,
        status: 'published',
      })
      .onConflictDoUpdate({
        target: schema.collections.slug,
        set: { title: config.collectionTitle, publisher: config.publisher, year: config.year },
      })
      .returning();

    const results: Awaited<ReturnType<typeof importVariant>>[] = [];
    for (const data of ordered) results.push(await importVariant(tx, config, collection!.id, data));
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
      /** Positions in variants (tasksPerVariant per variant). */
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

export type RussianBookImportResult = Awaited<ReturnType<typeof importRussianBook>>;

/** The one-line summary the sync-content chain prints for a book. */
export function describeBookImport(config: RussianBookConfig, r: RussianBookImportResult): string {
  const review = r.perVariant.filter((v) => v.needsReview > 0).map((v) => `В${v.variant}`);
  return (
    `Imported ${config.label} (Russian): ${r.variants} variants, ${r.total} positions, ${r.unique} unique tasks ` +
    `(${r.published} published, ${r.needsReview} needs_review${review.length ? `: ${review.join(', ')}` : ''}; ` +
    `${r.reused} repeats linked) — rows created ${r.created}, updated ${r.updated}, unchanged ${r.unchanged}` +
    (r.unlinked ? `, stale links removed ${r.unlinked}` : '') +
    '.'
  );
}
