import { validateStressEntries } from '@zybrilka/shared';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { createDb, type Database } from '../client.js';
import { isMainModule } from '../isMainModule.js';
import * as schema from '../schema.js';
import { STRESS_ENTRIES, STRESS_SOURCES, STRESS_WORDS_SOURCE } from './data.js';

const REMOVED_NOTE = 'По сообщениям вторичного источника, нет в «Орфоэпическом списке – 2026».';

export interface StressImportResult {
  readonly words: number;
  readonly deactivated: number;
}

/**
 * Imports the stress dictionary (./data.ts) — idempotent: sources and
 * words are upserted by their stable ids/keys, so word ids (and players'
 * progress on them) survive every re-run; an entry removed from the data
 * is deactivated, never deleted. Refuses to write anything if a single
 * line fails validation.
 */
export async function importStressDictionary(
  db: Database,
  lines: readonly string[] = STRESS_ENTRIES,
): Promise<StressImportResult> {
  const { entries, problems } = validateStressEntries(lines);
  if (problems.length > 0) {
    throw new Error(`Stress dictionary is invalid:\n${problems.join('\n')}`);
  }
  return db.transaction(async (tx) => {
    for (const source of STRESS_SOURCES) {
      await tx
        .insert(schema.stressSources)
        .values({ ...source, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: schema.stressSources.id,
          set: {
            title: source.title,
            kind: source.kind,
            url: source.url,
            verification: source.verification,
            updatedAt: new Date(),
          },
        });
    }
    for (const e of entries) {
      const row = {
        key: e.key,
        word: e.word,
        marked: e.marked,
        stressIndex: e.stressIndex,
        partOfSpeech: e.partOfSpeech,
        formNote: e.formNote,
        sourceId: STRESS_WORDS_SOURCE,
        listStatus: e.removed2026 ? ('reported_removed' as const) : ('fipi_unverified' as const),
        stressStatus: 'confirmed' as const,
        note: e.removed2026 ? REMOVED_NOTE : null,
        active: true,
      };
      await tx
        .insert(schema.stressWords)
        .values(row)
        .onConflictDoUpdate({
          target: schema.stressWords.key,
          set: { ...row, updatedAt: sql`now()` },
        });
    }
    const gone = await tx
      .update(schema.stressWords)
      .set({ active: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.stressWords.active, true),
          notInArray(
            schema.stressWords.key,
            entries.map((e) => e.key),
          ),
        ),
      )
      .returning({ id: schema.stressWords.id });
    return { words: entries.length, deactivated: gone.length };
  });
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const { db, close } = createDb(databaseUrl);
  try {
    const result = await importStressDictionary(db);
    console.log(`Stress dictionary: ${result.words} words, ${result.deactivated} deactivated`);
  } finally {
    await close();
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
