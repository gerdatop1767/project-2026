import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema.js';
import { createTestDb } from './testing.js';

// Drizzle wraps the driver error; the trigger's message is its cause.
const appendOnly = { cause: { message: expect.stringMatching(/append-only/) } };

describe('admin_audit_log is append-only', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    testDb = await createTestDb();
  });
  afterAll(async () => {
    await testDb.close();
  });

  it('accepts inserts but rejects UPDATE and DELETE at the database level', async () => {
    const [row] = await testDb.db
      .insert(schema.adminAuditLog)
      .values({ action: 'test', result: 'ok' })
      .returning();
    expect(row!.action).toBe('test');
    await expect(
      testDb.db.execute(sql`UPDATE admin_audit_log SET action = 'forged'`),
    ).rejects.toMatchObject(appendOnly);
    await expect(testDb.db.execute(sql`DELETE FROM admin_audit_log`)).rejects.toMatchObject(
      appendOnly,
    );
    const rows = await testDb.db.select().from(schema.adminAuditLog);
    expect(rows.map((r) => r.action)).toEqual(['test']);
  });

  it('knows the Europe/Moscow time zone (admin periods are Moscow days)', async () => {
    const result = await testDb.db.execute(
      sql`SELECT (TIMESTAMPTZ '2026-01-01 21:30:00+00' AT TIME ZONE 'Europe/Moscow')::date::text AS d`,
    );
    expect((result.rows[0] as { d: string }).d).toBe('2026-01-02');
  });
});
