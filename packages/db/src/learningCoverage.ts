import { examSkillInfo, examSkillsForTask, isExamSkillSlug } from '@zybrilka/shared';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Database } from './client.js';
import { isMainModule } from './isMainModule.js';
import * as schema from './schema.js';

/**
 * Learning Engine coverage (docs/learning/LEARNING-COVERAGE.md): how many
 * tasks of each EGE number are linked to an exam skill. Grouped by the
 * number in the CURRENT edition (an old-edition task is counted where its
 * topic is today, e.g. Ященко-2027 №13 → №16 «Финансовая математика»).
 * Computed from the database, never from a list kept by hand:
 * `pnpm --filter @zybrilka/db learning:coverage`.
 */

export interface CoverageRow {
  readonly subjectId: string;
  /** Current-edition number; null = a topic with no current position. */
  readonly examNumber: number | null;
  readonly skillKey: string | null;
  readonly title: string;
  readonly total: number;
  readonly published: number;
  readonly linked: number;
  readonly unlinked: number;
}

export async function learningCoverage(db: Database): Promise<CoverageRow[]> {
  const tasks = await db
    .select({
      id: schema.tasks.id,
      subjectId: schema.tasks.subjectId,
      taskNumber: schema.tasks.taskNumber,
      source: schema.tasks.source,
      sourceYear: schema.tasks.sourceYear,
      status: schema.tasks.status,
    })
    .from(schema.tasks);
  const links = await db
    .select({ taskId: schema.taskSkills.taskId, slug: schema.skills.slug })
    .from(schema.taskSkills)
    .innerJoin(schema.skills, eq(schema.skills.id, schema.taskSkills.skillId));
  const linkedSlugs = new Map<string, string[]>();
  for (const l of links) {
    if (!isExamSkillSlug(l.slug)) continue;
    linkedSlugs.set(l.taskId, [...(linkedSlugs.get(l.taskId) ?? []), l.slug]);
  }

  const rows = new Map<string, { row: Omit<CoverageRow, 'unlinked'>; unlinked: number }>();
  for (const t of tasks) {
    const linked = linkedSlugs.get(t.id) ?? [];
    // The primary skill: the stored link, else what the task's metadata says.
    const expected = examSkillsForTask(t).skillKeys;
    const key = expected.find((k) => linked.includes(k)) ?? linked[0] ?? expected[0] ?? null;
    const info = key ? examSkillInfo(key) : null;
    const id = key ?? `${t.subjectId}:raw:${t.taskNumber}`;
    const entry = rows.get(id) ?? {
      row: {
        subjectId: t.subjectId,
        examNumber: info ? info.examNumber : t.taskNumber,
        skillKey: key,
        title: info?.title ?? 'нет позиции в спецификации',
        total: 0,
        published: 0,
        linked: 0,
      },
      unlinked: 0,
    };
    entry.row = {
      ...entry.row,
      total: entry.row.total + 1,
      published: entry.row.published + (t.status === 'published' ? 1 : 0),
      linked: entry.row.linked + (linked.length > 0 ? 1 : 0),
    };
    if (linked.length === 0) entry.unlinked += 1;
    rows.set(id, entry);
  }
  return [...rows.values()]
    .map(({ row, unlinked }) => ({ ...row, unlinked }))
    .sort(
      (a, b) =>
        a.subjectId.localeCompare(b.subjectId) ||
        (a.examNumber ?? 99) - (b.examNumber ?? 99) ||
        (a.skillKey ?? '').localeCompare(b.skillKey ?? ''),
    );
}

const SUBJECT_NAMES: Record<string, string> = { math: 'Математика', russian: 'Русский язык' };

export function coverageMarkdown(rows: readonly CoverageRow[]): string {
  const lines = [
    '| Предмет | Номер ЕГЭ | Навык | Всего заданий | Опубликовано | Связано с навыками | Без навыка | Статус |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const number = r.examNumber === null ? '— (старая редакция)' : `№${r.examNumber}`;
    const status =
      r.unlinked === 0 ? '✅ полностью' : r.linked === 0 ? '❌ нет навыка' : '⚠️ частично';
    lines.push(
      `| ${SUBJECT_NAMES[r.subjectId] ?? r.subjectId} | ${number} | ${r.title}${r.skillKey ? ` (\`${r.skillKey}\`)` : ''} | ${r.total} | ${r.published} | ${r.linked} | ${r.unlinked} | ${status} |`,
    );
  }
  const bySubject = new Map<string, { total: number; linked: number; published: number }>();
  for (const r of rows) {
    const s = bySubject.get(r.subjectId) ?? { total: 0, linked: 0, published: 0 };
    bySubject.set(r.subjectId, {
      total: s.total + r.total,
      linked: s.linked + r.linked,
      published: s.published + r.published,
    });
  }
  lines.push(
    '',
    '| Предмет | Всего | Опубликовано | Связано | Покрытие |',
    '|---|---|---|---|---|',
  );
  for (const [subjectId, s] of bySubject) {
    const pct = s.total ? Math.round((s.linked / s.total) * 1000) / 10 : 0;
    lines.push(
      `| ${SUBJECT_NAMES[subjectId] ?? subjectId} | ${s.total} | ${s.published} | ${s.linked} | ${pct}% |`,
    );
  }
  return lines.join('\n');
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const client = postgres(url, { max: 1 });
  try {
    console.log(coverageMarkdown(await learningCoverage(drizzle(client, { schema }))));
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
