import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { currentScoringRules } from '@zybrilka/shared';
import type { Database } from './client.js';
import * as schema from './schema.js';

/**
 * Shared import routine for «ЕГЭ 2027. Математика. Профильный уровень.
 * Типовые экзаменационные варианты» (под ред. И. В. Ященко, 36 вариантов)
 * — one data module per variant (importEge2027YashchenkoVariantN.ts),
 * same upsert rules as the 2026 importers so a re-run never duplicates
 * or renumbers anything.
 *
 * The edition is a SEPARATE source: its own collection, flagged
 * `inAllSources: false`, so its tasks only appear when the student picks
 * this collection (or one of its variants) and never in «Все источники»
 * next to the 2026 tasks. The numbering is the book's 2027 one (20
 * tasks; the 2026 №13–19 are №14–20 here) and is never mapped onto 2026
 * numbers. See docs/imports/ege-2027-yashchenko-v1-v2-report.md.
 */
export const SOURCE = 'Ященко ЕГЭ 2027. Типовые экзаменационные варианты';
export const SOURCE_DOCUMENT = 'ЕГЭ 2027 Ященко 36 вариантов';
export const SOURCE_YEAR = 2027;
export const COLLECTION_SLUG = 'ege-2027-yashchenko';
const COLLECTION_TITLE = 'ЕГЭ 2027 Ященко';
const COLLECTION_PUBLISHER = 'Ященко';
const COLLECTION_DESCRIPTION =
  'ЕГЭ 2027. Математика. Профильный уровень. Типовые экзаменационные варианты: 36 вариантов (под ред. И. В. Ященко). Нумерация заданий — по формату 2027 года (20 заданий).';
export const EXAM_FORMAT = 'ege-math-profile-2027';
/** The book's own scan Варианты 1–2 were read from (pages are relative to it). */
const SOURCE_FILE = 'ege2027-yashchenko-v1-v2.pdf';
/** The later scan of book Варианты 2–15 (4 pages each; Вариант N on pages 4N−7…4N−4). */
export const SOURCE_FILE_V2_V15 = 'ege2027-yashchenko-v2-v15.pdf';

/** Every explanation here was written by the Зубрилка editors, not taken from the book. */
const AUTHORSHIP_NOTE =
  '_Разбор подготовлен редакцией Зубрилки — это не авторское решение сборника._';

export type ImportStatus = 'published' | 'needs_review';
export type ImportAnswerType = 'short_answer' | 'interval' | 'multi_part';

export interface ImportSolutionStep {
  title: string;
  explanation: string;
}

export interface ImportTask {
  taskNumber: number;
  topicSlug: string;
  topicName: string;
  /** Page of the variant's source file (1-based). */
  sourcePage: number;
  rawStatement: string;
  conditionMd: string;
  imageUrl: string | null;
  answerType?: ImportAnswerType;
  correctAnswer: string;
  correctAnswerDisplay?: string;
  explanationMd: string;
  hintMd: string;
  solutionSteps: readonly ImportSolutionStep[];
  status: ImportStatus;
  reviewNote?: string;
}

export interface VariantData {
  variant: number;
  /** The scan this variant was read from; Варианты 1–2 default to the first scan. */
  sourceFile?: string;
  /** Pages of the source file holding this variant. */
  sourcePageStart: number;
  sourcePageEnd: number;
  tasks: readonly ImportTask[];
}

export function partForTaskNumber(taskNumber: number): 1 | 2 {
  return taskNumber <= 13 ? 1 : 2;
}

function difficultyForTaskNumber(taskNumber: number): 1 | 2 | 3 {
  return partForTaskNumber(taskNumber) === 1 ? 2 : 3;
}

export function maxPrimaryScoreFor(taskNumber: number): number {
  const rule = currentScoringRules(EXAM_FORMAT)?.tasks[taskNumber];
  if (!rule) throw new Error(`No 2027 scoring rule for task ${taskNumber}`);
  return rule.max;
}

function normalizeForHash(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Unlike the 2026 hash (subject|number|statement), the source is part of
 * it: the same statement in another edition is a different task and must
 * never collide with (or overwrite) a 2026 row.
 */
function contentHashFor(taskNumber: number, statement: string): string {
  return createHash('sha256')
    .update(`math|${SOURCE}|${taskNumber}|${normalizeForHash(statement)}`)
    .digest('hex');
}

export function importTag(variant: number): string {
  return `ege-2027-variant-${variant}`;
}

export async function importYashchenko2027Variant(db: Database, data: VariantData) {
  const { variant: variantNumber, tasks } = data;
  const numbers = tasks.map((t) => t.taskNumber);
  if (numbers.length !== 20 || numbers.some((n, i) => n !== i + 1)) {
    throw new Error(`Вариант ${variantNumber}: expected tasks 1..20 in order`);
  }

  await db
    .insert(schema.subjects)
    .values({ id: 'math', name: 'Математика' })
    .onConflictDoUpdate({ target: schema.subjects.id, set: { name: 'Математика' } });

  // Topics are shared with the 2026 tasks by slug. An existing topic keeps
  // its name: this importer only creates the slugs that don't exist yet.
  const topicIdBySlug = new Map<string, string>();
  for (const slug of new Set(tasks.map((t) => t.topicSlug))) {
    const topicName = tasks.find((t) => t.topicSlug === slug)!.topicName;
    await db
      .insert(schema.topics)
      .values({ subjectId: 'math', slug, name: topicName })
      .onConflictDoNothing({ target: [schema.topics.subjectId, schema.topics.slug] });
    const [topic] = await db
      .select({ id: schema.topics.id })
      .from(schema.topics)
      .where(and(eq(schema.topics.subjectId, 'math'), eq(schema.topics.slug, slug)));
    topicIdBySlug.set(slug, topic!.id);
  }

  const collectionValues = {
    title: COLLECTION_TITLE,
    publisher: COLLECTION_PUBLISHER,
    year: SOURCE_YEAR,
    description: COLLECTION_DESCRIPTION,
    inAllSources: false,
    examFormat: EXAM_FORMAT,
  };
  const [collection] = await db
    .insert(schema.collections)
    .values({ subjectId: 'math', slug: COLLECTION_SLUG, status: 'published', ...collectionValues })
    .onConflictDoUpdate({ target: schema.collections.slug, set: collectionValues })
    .returning();

  const variantTitle = `ЕГЭ 2027 — Ященко — Вариант ${variantNumber}`;
  const [variant] = await db
    .insert(schema.variants)
    .values({
      collectionId: collection!.id,
      variantNumber,
      title: variantTitle,
      year: SOURCE_YEAR,
      status: 'published',
      sourceFile: data.sourceFile ?? SOURCE_FILE,
      sourcePageStart: data.sourcePageStart,
      sourcePageEnd: data.sourcePageEnd,
    })
    .onConflictDoUpdate({
      target: [schema.variants.collectionId, schema.variants.variantNumber],
      set: {
        title: variantTitle,
        sourceFile: data.sourceFile ?? SOURCE_FILE,
        sourcePageStart: data.sourcePageStart,
        sourcePageEnd: data.sourcePageEnd,
        updatedAt: new Date(),
      },
    })
    .returning();

  const existingRows = await db
    .select({ id: schema.tasks.id, taskNumber: schema.tasks.taskNumber })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.subjectId, 'math'),
        eq(schema.tasks.source, SOURCE),
        eq(schema.tasks.sourceVariant, variantNumber),
      ),
    );
  const existingIdByNumber = new Map(existingRows.map((r) => [r.taskNumber, r.id]));

  const taskIds: string[] = [];
  for (const t of tasks) {
    const values = {
      subjectId: 'math',
      taskNumber: t.taskNumber,
      sourceTaskNumber: t.taskNumber,
      maxPrimaryScore: maxPrimaryScoreFor(t.taskNumber),
      topicId: topicIdBySlug.get(t.topicSlug),
      difficulty: difficultyForTaskNumber(t.taskNumber),
      conditionMd: t.conditionMd,
      imageUrl: t.imageUrl,
      answerType: t.answerType ?? ('short_answer' as const),
      correctAnswer: t.correctAnswer,
      correctAnswerDisplay: t.correctAnswerDisplay ?? null,
      explanationMd: `${t.explanationMd}\n\n${AUTHORSHIP_NOTE}`,
      hintMd: t.hintMd,
      solutionSteps: t.solutionSteps,
      source: SOURCE,
      sourceUrl: null,
      sourceYear: SOURCE_YEAR,
      sourceDocument: SOURCE_DOCUMENT,
      sourceVariant: variantNumber,
      sourcePage: t.sourcePage,
      rawStatement: t.rawStatement,
      contentHash: contentHashFor(t.taskNumber, t.rawStatement),
      tags: [importTag(variantNumber)],
      status: t.status,
      reviewNote: t.reviewNote ?? null,
    };

    const existingId = existingIdByNumber.get(t.taskNumber);
    if (existingId) {
      await db
        .update(schema.tasks)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(schema.tasks.id, existingId));
      taskIds.push(existingId);
    } else {
      const [row] = await db.insert(schema.tasks).values(values).returning({ id: schema.tasks.id });
      taskIds.push(row!.id);
    }
  }

  for (let i = 0; i < tasks.length; i++) {
    await db
      .insert(schema.variantTasks)
      .values({ variantId: variant!.id, taskId: taskIds[i]!, position: tasks[i]!.taskNumber })
      .onConflictDoUpdate({
        target: [schema.variantTasks.variantId, schema.variantTasks.taskId],
        set: { position: tasks[i]!.taskNumber },
      });
  }

  return {
    total: tasks.length,
    published: tasks.filter((t) => t.status === 'published').length,
    needsReview: tasks.filter((t) => t.status === 'needs_review').length,
    collectionId: collection!.id,
    variantId: variant!.id,
    taskIds,
  };
}
