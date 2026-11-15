import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema.js';
import { syncTaskSkills } from './learningSkills.js';
import { seed } from './seed.js';
import { createTestDb } from './testing.js';

describe('seed', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it('creates published math tasks across numbers 1-5, clearly labeled as demo, not FIPI', async () => {
    const { db } = testDb;
    const result = await seed(db);
    expect(result.taskCount).toBeGreaterThanOrEqual(5);

    const rows = await db.select().from(schema.tasks).where(eq(schema.tasks.subjectId, 'math'));
    expect(rows.length).toBe(result.taskCount);

    const numbers = new Set(rows.map((r) => r.taskNumber));
    for (const n of [1, 2, 3, 4, 5]) {
      expect(numbers.has(n)).toBe(true);
    }
    for (const row of rows) {
      expect(row.status).toBe('published');
      expect(row.source.toLowerCase()).not.toContain('фипи официал');
      expect(row.source).toContain('demo');
    }
  });

  it('is idempotent — re-running does not duplicate demo tasks', async () => {
    const { db } = testDb;
    await seed(db);
    const first = await db.select().from(schema.tasks).where(eq(schema.tasks.subjectId, 'math'));
    await seed(db);
    const second = await db.select().from(schema.tasks).where(eq(schema.tasks.subjectId, 'math'));
    expect(second.length).toBe(first.length);
  });

  it('re-runs after the Learning Engine linked the demo tasks to skills', async () => {
    const { db } = testDb;
    await seed(db);
    await syncTaskSkills(db);
    expect((await db.select().from(schema.taskSkills)).length).toBeGreaterThan(0);
    await seed(db);
    const again = await syncTaskSkills(db);
    expect(again.unmapped).toEqual([]);
    expect((await db.select().from(schema.taskSkills)).length).toBeGreaterThan(0);
  });
});
