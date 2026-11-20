import { createHash } from 'node:crypto';
import { serializeMultiPartSpec } from '@zybrilka/shared';
import { and, eq, ne } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Database } from './client.js';
import { isMainModule } from './isMainModule.js';
import * as schema from './schema.js';
import {
  BANK_NUMBERS,
  BANK_SET_SIZE,
  BANK_TAG,
  BANK_YEAR,
  bankCollectionSlug,
  bankCollectionTitle,
  bankSource,
} from './zybrilkaRussian/bank.js';
import {
  MATCH_LABELS,
  answerText,
  type BankNumber,
  type BankTask,
} from './zybrilkaRussian/types.js';
import { BANK_SIZE, validateNumber } from './zybrilkaRussian/validate.js';

/**
 * Зубрилка's own ЕГЭ Russian bank, tasks 4–22 except 10
 * (docs/imports/zybrilka-russian-4-22-plan.md). One collection per number
 * (`zybrilka-russian-N`, 5 sets × 10), its own `tasks.source` per number,
 * so rows of every other source — №10 included — are never matched.
 *
 * Idempotent: a task is upserted by (subject, source, sourceVariant = 1…50),
 * collections by slug, sets by number; ids never change and a row is
 * rewritten only when its content changed. All numbers are validated
 * before anything is written and imported in one transaction. Nothing is
 * deleted; user data is never touched.
 *
 * By default only complete numbers (50 tasks) are imported — a number
 * still being written never reaches students. `allowIncomplete` (tests,
 * a local stand) imports whatever is ready.
 */
const SUBJECT_ID = 'russian';

export function bankContentHash(taskNumber: number, n: number, conditionMd: string): string {
  const normalized = conditionMd.trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256')
    .update(`${SUBJECT_ID}|${bankSource(taskNumber)}|${n}|${taskNumber}|${normalized}`)
    .digest('hex');
}

export function bankAnswerColumns(t: BankTask) {
  const a = t.answer;
  if (a.type === 'digits')
    return {
      answerType: 'short_answer' as const,
      digitSetOrderInsensitive: true,
      correctAnswer: a.digits,
      acceptedAnswers: [] as string[],
      correctAnswerDisplay: `${a.digits} (в любом порядке)`,
    };
  if (a.type === 'word')
    return {
      answerType: 'short_answer' as const,
      digitSetOrderInsensitive: false,
      correctAnswer: a.word,
      acceptedAnswers: [...a.accepted],
      correctAnswerDisplay: a.accepted.length > 0 ? answerText(a) : null,
    };
  return {
    answerType: 'multi_part' as const,
    digitSetOrderInsensitive: false,
    correctAnswer: serializeMultiPartSpec({
      parts: a.parts.map((d, i) => ({
        id: ['a', 'b', 'v', 'g', 'd'][i]!,
        label: MATCH_LABELS[i]!,
        answerType: 'short_answer' as const,
        correctAnswer: d,
      })),
    }),
    acceptedAnswers: [] as string[],
    correctAnswerDisplay: null,
  };
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
  'reviewNote',
] as const;

export function validateBank(
  numbers: readonly BankNumber[],
  opts: { allowIncomplete: boolean },
): BankNumber[] {
  const problems: string[] = [];
  const ready: BankNumber[] = [];
  for (const bank of numbers) {
    const complete = bank.tasks.length === BANK_SIZE;
    if (!complete && !opts.allowIncomplete) continue;
    problems.push(...validateNumber(bank, { complete }));
    ready.push(bank);
  }
  if (problems.length > 0)
    throw new Error(`Зубрилка, банк №4–22: data is invalid:\n- ${problems.join('\n- ')}`);
  return ready;
}

export async function importZybrilkaRussianBank(
  db: Database,
  options: { numbers?: readonly BankNumber[]; allowIncomplete?: boolean } = {},
) {
  const numbers = validateBank(options.numbers ?? BANK_NUMBERS, {
    allowIncomplete: options.allowIncomplete ?? false,
  });

  return db.transaction(async (tx) => {
    await tx
      .insert(schema.subjects)
      .values({ id: SUBJECT_ID, name: 'Русский язык' })
      .onConflictDoNothing();
    const results: {
      taskNumber: number;
      total: number;
      created: number;
      updated: number;
      unchanged: number;
      needsReview: number;
    }[] = [];

    for (const bank of numbers) {
      const N = bank.taskNumber;
      const source = bankSource(N);
      await tx
        .insert(schema.topics)
        .values({ subjectId: SUBJECT_ID, slug: bank.topicSlug, name: bank.topicName })
        .onConflictDoNothing({ target: [schema.topics.subjectId, schema.topics.slug] });
      const [topic] = await tx
        .select({ id: schema.topics.id })
        .from(schema.topics)
        .where(
          and(eq(schema.topics.subjectId, SUBJECT_ID), eq(schema.topics.slug, bank.topicSlug)),
        );

      const meta = {
        title: bankCollectionTitle(N),
        publisher: 'Зубрилка',
        description: `Задания составлены командой Зубрилки по образцу задания №${N} ЕГЭ по русскому языку. Это не материалы ФИПИ и не задания из сборников. 50 заданий в пяти наборах, к каждому — подробный разбор.`,
        year: BANK_YEAR,
      };
      const [collection] = await tx
        .insert(schema.collections)
        .values({
          subjectId: SUBJECT_ID,
          slug: bankCollectionSlug(N),
          ...meta,
          status: 'published',
          inAllSources: true,
          examFormat: null,
        })
        .onConflictDoUpdate({ target: schema.collections.slug, set: meta })
        .returning();

      const sets = [...new Set(bank.tasks.map((t) => Math.ceil(t.n / BANK_SET_SIZE)))];
      const variantIdBySet = new Map<number, string>();
      for (const set of sets) {
        const title = `Зубрилка — №${N}, набор ${set}`;
        const sourceFile = 'Авторские задания Зубрилки';
        const [variant] = await tx
          .insert(schema.variants)
          .values({
            collectionId: collection!.id,
            variantNumber: set,
            title,
            year: BANK_YEAR,
            status: 'published',
            sourceFile,
          })
          .onConflictDoUpdate({
            target: [schema.variants.collectionId, schema.variants.variantNumber],
            set: { title, sourceFile, updatedAt: new Date() },
          })
          .returning();
        variantIdBySet.set(set, variant!.id);
      }

      const existing = await tx
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.subjectId, SUBJECT_ID),
            eq(schema.tasks.source, source),
            eq(schema.tasks.taskNumber, N),
          ),
        );
      const existingByN = new Map(existing.map((r) => [r.sourceVariant, r]));
      const counts = { created: 0, updated: 0, unchanged: 0, needsReview: 0 };

      for (const t of bank.tasks) {
        const set = Math.ceil(t.n / BANK_SET_SIZE);
        const status = t.review ? ('needs_review' as const) : ('published' as const);
        const values = {
          subjectId: SUBJECT_ID,
          taskNumber: N,
          topicId: topic!.id,
          passageId: null,
          difficulty: t.difficulty,
          conditionMd: t.conditionMd,
          imageUrl: null,
          ...bankAnswerColumns(t),
          explanationMd: t.explanationMd,
          hintMd: t.hintMd,
          solutionSteps: [],
          source,
          sourceUrl: null,
          sourceYear: BANK_YEAR,
          sourceDocument: `Авторское задание Зубрилки по образцу ЕГЭ №${N}, набор ${set}, задание ${t.n}`,
          sourceVariant: t.n,
          sourcePage: null,
          rawStatement: t.conditionMd,
          contentHash: bankContentHash(N, t.n, t.conditionMd),
          tags: [BANK_TAG, `zybrilka-russian-${N}`],
          status,
          reviewNote: t.review ?? null,
        };
        if (status === 'needs_review') counts.needsReview++;
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
        const position = ((t.n - 1) % BANK_SET_SIZE) + 1;
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
      results.push({ taskNumber: N, total: bank.tasks.length, ...counts });
    }
    return results;
  });
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const allowIncomplete = process.argv.includes('--allow-incomplete');
  const client = postgres(databaseUrl, { max: 1 });
  try {
    const results = await importZybrilkaRussianBank(drizzle(client, { schema }), {
      allowIncomplete,
    });
    const skipped = BANK_NUMBERS.filter((b) => !results.some((r) => r.taskNumber === b.taskNumber));
    for (const r of results)
      console.log(
        `Зубрилка №${r.taskNumber}: ${r.total} tasks — created ${r.created}, updated ${r.updated}, unchanged ${r.unchanged}, needs_review ${r.needsReview}`,
      );
    for (const b of skipped)
      console.log(
        `Зубрилка №${b.taskNumber}: ${b.tasks.length} of ${BANK_SIZE} — not complete, skipped`,
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
