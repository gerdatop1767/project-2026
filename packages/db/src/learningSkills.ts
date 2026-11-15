import { allExamSkills, examSkillsForTask, isExamSkillSlug } from '@zybrilka/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Database } from './client.js';
import { isMainModule } from './isMainModule.js';
import * as schema from './schema.js';

/**
 * Learning Engine: links every task to its EGE skill
 * (docs/learning/IMPORT-INTEGRATION.md).
 *
 * The link is computed from the task's own metadata (subject, source, year,
 * number) by `examSkillsForTask` — never from a list of task ids — so a new
 * variant needs nothing but the import itself. Idempotent: running it twice
 * changes nothing the second time.
 *
 * Runs:
 * - after `sync-content`, when the API starts (apps/api/src/main.ts) — every
 *   deploy picks up whatever the importers added;
 * - for one task inside the answer transaction, when that task has no link
 *   yet (apps/api/src/modules/tasks/service.ts);
 * - by hand: `pnpm --filter @zybrilka/db learning:sync-skills`.
 *
 * A task whose number the specification does not know (a new exam format, a
 * typo in an importer) gets no invented skill: it is reported in
 * `unmapped` and stays out of the skill statistics until its number or the
 * specification is fixed. The rest of the sync is not affected.
 */

export interface UnmappedTask {
  readonly taskId: string;
  readonly subjectId: string;
  readonly taskNumber: number;
  readonly edition: string;
  readonly status: string;
}

export interface SyncTaskSkillsResult {
  readonly tasksChecked: number;
  readonly skillsUpserted: number;
  readonly linksCreated: number;
  readonly linksRemoved: number;
  /** Tasks whose links changed — their attempts need a skill recompute. */
  readonly changedTaskIds: readonly string[];
  readonly unmapped: readonly UnmappedTask[];
}

/** Makes sure every exam skill has its `skills` row; returns slug → id. */
export async function ensureExamSkillRows(db: Database): Promise<Map<string, string>> {
  // Only subjects that exist here (a test database may hold just one).
  const subjectIds = new Set(
    (await db.select({ id: schema.subjects.id }).from(schema.subjects)).map((r) => r.id),
  );
  const skills = allExamSkills().filter((s) => subjectIds.has(s.subjectId));
  if (skills.length === 0) return new Map();
  const wanted = skills.map((s) => ({
    subjectId: s.subjectId,
    slug: s.key,
    name: s.title,
    description: s.examNumber ? `Задание №${s.examNumber} ЕГЭ` : 'Тема кодификатора',
  }));
  const readRows = () =>
    db
      .select({
        id: schema.skills.id,
        subjectId: schema.skills.subjectId,
        slug: schema.skills.slug,
        name: schema.skills.name,
        description: schema.skills.description,
      })
      .from(schema.skills)
      .where(
        inArray(
          schema.skills.slug,
          wanted.map((s) => s.slug),
        ),
      );
  const keyOf = (r: { subjectId: string; slug: string }) => `${r.subjectId}\u0000${r.slug}`;

  // Read first and write only what is missing or changed. This runs inside
  // answer transactions too, and an unconditional upsert would row-lock every
  // skill on every first answer to a new task.
  let rows = await readRows();
  const byKey = new Map(rows.map((r) => [keyOf(r), r]));
  const missing = wanted.filter((s) => !byKey.has(keyOf(s)));
  const changed = wanted.filter((s) => {
    const row = byKey.get(keyOf(s));
    return row !== undefined && (row.name !== s.name || row.description !== s.description);
  });
  if (missing.length > 0) {
    await db.insert(schema.skills).values(missing).onConflictDoNothing();
  }
  for (const s of changed) {
    await db
      .update(schema.skills)
      .set({ name: s.name, description: s.description, updatedAt: new Date() })
      .where(and(eq(schema.skills.subjectId, s.subjectId), eq(schema.skills.slug, s.slug)));
  }
  if (missing.length > 0) rows = await readRows();
  return new Map(rows.map((r) => [r.slug, r.id]));
}

/**
 * Links tasks to their exam skills. `taskIds` limits the run to those tasks
 * (the per-answer path); omitted = every task in the database.
 */
export async function syncTaskSkills(
  db: Database,
  options: { taskIds?: readonly string[] } = {},
): Promise<SyncTaskSkillsResult> {
  if (options.taskIds && options.taskIds.length === 0) {
    return {
      tasksChecked: 0,
      skillsUpserted: 0,
      linksCreated: 0,
      linksRemoved: 0,
      changedTaskIds: [],
      unmapped: [],
    };
  }
  const skillIdBySlug = await ensureExamSkillRows(db);
  const examSkillIds = [...skillIdBySlug.values()];

  const tasks = await db
    .select({
      id: schema.tasks.id,
      subjectId: schema.tasks.subjectId,
      taskNumber: schema.tasks.taskNumber,
      source: schema.tasks.source,
      sourceYear: schema.tasks.sourceYear,
      status: schema.tasks.status,
    })
    .from(schema.tasks)
    .where(options.taskIds ? inArray(schema.tasks.id, [...options.taskIds]) : undefined);

  const existing = await db
    .select({ taskId: schema.taskSkills.taskId, skillId: schema.taskSkills.skillId })
    .from(schema.taskSkills)
    .where(
      and(
        inArray(schema.taskSkills.skillId, examSkillIds),
        options.taskIds ? inArray(schema.taskSkills.taskId, [...options.taskIds]) : undefined,
      ),
    );
  const existingByTask = new Map<string, Set<string>>();
  for (const row of existing) {
    const set = existingByTask.get(row.taskId) ?? new Set<string>();
    set.add(row.skillId);
    existingByTask.set(row.taskId, set);
  }

  const toInsert: { taskId: string; skillId: string; source: 'import' }[] = [];
  const unmapped: UnmappedTask[] = [];
  let linksRemoved = 0;
  const changed = new Set<string>();

  for (const task of tasks) {
    const { edition, skillKeys } = examSkillsForTask(task);
    const wanted = new Set(
      skillKeys.map((k) => skillIdBySlug.get(k)).filter((id): id is string => Boolean(id)),
    );
    if (wanted.size === 0) {
      unmapped.push({
        taskId: task.id,
        subjectId: task.subjectId,
        taskNumber: task.taskNumber,
        edition,
        status: task.status,
      });
    }
    const have = existingByTask.get(task.id) ?? new Set<string>();
    for (const skillId of wanted) {
      if (!have.has(skillId)) toInsert.push({ taskId: task.id, skillId, source: 'import' });
    }
    // A number corrected in the importer moves the task to its new skill.
    const stale = [...have].filter((id) => !wanted.has(id));
    if (stale.length > 0) {
      const removed = await db
        .delete(schema.taskSkills)
        .where(
          and(eq(schema.taskSkills.taskId, task.id), inArray(schema.taskSkills.skillId, stale)),
        )
        .returning({ id: schema.taskSkills.id });
      linksRemoved += removed.length;
      if (removed.length > 0) changed.add(task.id);
    }
  }

  let linksCreated = 0;
  for (let i = 0; i < toInsert.length; i += 500) {
    const inserted = await db
      .insert(schema.taskSkills)
      .values(toInsert.slice(i, i + 500))
      .onConflictDoNothing({ target: [schema.taskSkills.taskId, schema.taskSkills.skillId] })
      .returning({ taskId: schema.taskSkills.taskId });
    linksCreated += inserted.length;
    for (const row of inserted) changed.add(row.taskId);
  }

  return {
    tasksChecked: tasks.length,
    skillsUpserted: skillIdBySlug.size,
    linksCreated,
    linksRemoved,
    changedTaskIds: [...changed],
    unmapped,
  };
}

/** True when the task already has at least one exam-skill link. */
export async function taskHasExamSkill(db: Database, taskId: string): Promise<boolean> {
  const rows = await db
    .select({ slug: schema.skills.slug })
    .from(schema.taskSkills)
    .innerJoin(schema.skills, eq(schema.skills.id, schema.taskSkills.skillId))
    .where(eq(schema.taskSkills.taskId, taskId));
  return rows.some((r) => isExamSkillSlug(r.slug));
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const client = postgres(url, { max: 1 });
  try {
    const result = await syncTaskSkills(drizzle(client, { schema }));
    console.log(
      `Learning skills: ${result.tasksChecked} tasks, ${result.linksCreated} links created, ${result.linksRemoved} removed, ${result.unmapped.length} without a skill.`,
    );
    for (const t of result.unmapped) {
      console.log(
        `  needs review: ${t.subjectId} №${t.taskNumber} (${t.edition}) ${t.taskId} [${t.status}]`,
      );
    }
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
