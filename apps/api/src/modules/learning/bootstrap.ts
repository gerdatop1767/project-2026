import { schema, syncTaskSkills, type Database } from '@zybrilka/db';
import { inArray } from 'drizzle-orm';
import { rebuildUserSkillStatistics } from './service.js';

interface Log {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/**
 * Learning Engine startup step (docs/learning/IMPORT-INTEGRATION.md).
 *
 * On every deploy `sync-content` imports the variants before the API starts;
 * this links whatever is new to its EGE skills and recomputes the skill
 * statistics of the students whose answered tasks just got (or changed) a
 * skill — from their attempt history, so nothing is lost for answers given
 * before the link existed. Idempotent: with nothing new it only checks.
 * Never blocks the server: it runs after `listen`, and a failure is logged,
 * not fatal (the per-answer path links a task on its own anyway).
 */
export async function syncLearningOnStartup(db: Database, log: Log): Promise<void> {
  const started = Date.now();
  try {
    const result = await syncTaskSkills(db);
    log.info(
      {
        tasks: result.tasksChecked,
        linksCreated: result.linksCreated,
        linksRemoved: result.linksRemoved,
        unmapped: result.unmapped.length,
      },
      'learning: task skills synced',
    );
    for (const t of result.unmapped.slice(0, 50)) {
      log.warn(t, 'learning: task without an EGE skill (needs review)');
    }

    const users = new Set<string>();
    const ids = [...result.changedTaskIds];
    for (let i = 0; i < ids.length; i += 500) {
      const rows = await db
        .selectDistinct({ userId: schema.attempts.userId })
        .from(schema.attempts)
        .where(inArray(schema.attempts.taskId, ids.slice(i, i + 500)));
      for (const r of rows) users.add(r.userId);
    }
    for (const userId of users) await rebuildUserSkillStatistics(db, userId);
    log.info(
      { usersRebuilt: users.size, ms: Date.now() - started },
      'learning: skill statistics up to date',
    );
  } catch (error) {
    log.error({ err: error }, 'learning: startup sync failed');
  }
}
