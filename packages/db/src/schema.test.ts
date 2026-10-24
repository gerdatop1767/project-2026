import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema.js';
import { createTestDb } from './testing.js';

describe('task engine schema', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it('creates a subject, topic and task, and queries the task back', async () => {
    const { db } = testDb;
    await db.insert(schema.subjects).values({ id: 'math', name: 'Математика' });
    const [topic] = await db
      .insert(schema.topics)
      .values({ subjectId: 'math', slug: 'numbers', name: 'Числа и вычисления' })
      .returning();

    const [task] = await db
      .insert(schema.tasks)
      .values({
        subjectId: 'math',
        taskNumber: 1,
        topicId: topic!.id,
        difficulty: 1,
        conditionMd: 'Сколько будет 2 + 2?',
        correctAnswer: '4',
        explanationMd: '2 + 2 = 4.',
        source: 'demo',
        status: 'published',
      })
      .returning();

    expect(task).toBeDefined();
    const [found] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, task!.id));
    expect(found?.conditionMd).toBe('Сколько будет 2 + 2?');
    expect(found?.status).toBe('published');
  });

  it('records an attempt and a mistake, keeping attempt history on repeat attempts', async () => {
    const { db } = testDb;
    const [user] = await db.insert(schema.users).values({}).returning();
    const [task] = await db
      .insert(schema.tasks)
      .values({
        subjectId: 'math',
        taskNumber: 2,
        difficulty: 1,
        conditionMd: 'Сколько будет 3 + 3?',
        correctAnswer: '6',
        explanationMd: '3 + 3 = 6.',
        source: 'demo',
        status: 'published',
      })
      .returning();

    const [wrongAttempt] = await db
      .insert(schema.attempts)
      .values({ userId: user!.id, taskId: task!.id, answerRaw: '5', isCorrect: false })
      .returning();
    const [mistake] = await db
      .insert(schema.mistakes)
      .values({
        userId: user!.id,
        taskId: task!.id,
        firstAttemptId: wrongAttempt!.id,
        lastAttemptId: wrongAttempt!.id,
      })
      .returning();
    expect(mistake?.status).toBe('open');
    expect(mistake?.timesWrong).toBe(1);

    const [rightAttempt] = await db
      .insert(schema.attempts)
      .values({ userId: user!.id, taskId: task!.id, answerRaw: '6', isCorrect: true })
      .returning();
    await db
      .update(schema.mistakes)
      .set({ status: 'resolved', lastAttemptId: rightAttempt!.id, updatedAt: new Date() })
      .where(eq(schema.mistakes.id, mistake!.id));

    const [resolved] = await db
      .select()
      .from(schema.mistakes)
      .where(eq(schema.mistakes.id, mistake!.id));
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.timesWrong).toBe(1); // history preserved, not deleted

    const allAttempts = await db
      .select()
      .from(schema.attempts)
      .where(eq(schema.attempts.taskId, task!.id));
    expect(allAttempts).toHaveLength(2);
  });

  it('enforces one mistake row per (user, task)', async () => {
    const { db } = testDb;
    const [user] = await db.insert(schema.users).values({}).returning();
    const [task] = await db
      .insert(schema.tasks)
      .values({
        subjectId: 'math',
        taskNumber: 3,
        difficulty: 1,
        conditionMd: 'Сколько будет 1 + 1?',
        correctAnswer: '2',
        explanationMd: '1 + 1 = 2.',
        source: 'demo',
        status: 'published',
      })
      .returning();
    const [attempt] = await db
      .insert(schema.attempts)
      .values({ userId: user!.id, taskId: task!.id, answerRaw: '3', isCorrect: false })
      .returning();
    await db.insert(schema.mistakes).values({
      userId: user!.id,
      taskId: task!.id,
      firstAttemptId: attempt!.id,
      lastAttemptId: attempt!.id,
    });

    await expect(
      db.insert(schema.mistakes).values({
        userId: user!.id,
        taskId: task!.id,
        firstAttemptId: attempt!.id,
        lastAttemptId: attempt!.id,
      }),
    ).rejects.toThrow();
  });
});

describe('collections / variants / variant_tasks (S3.2)', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
    await testDb.db.insert(schema.subjects).values({ id: 'math', name: 'Математика' });
  });

  afterAll(async () => {
    await testDb.close();
  });

  it('links two existing tasks into one variant, ordered by position, without duplicating the tasks', async () => {
    const { db } = testDb;
    const [collection] = await db
      .insert(schema.collections)
      .values({
        subjectId: 'math',
        slug: 'ege-2026-yashchenko',
        title: 'ЕГЭ 2026 Ященко',
        year: 2026,
      })
      .returning();
    const [variant] = await db
      .insert(schema.variants)
      .values({ collectionId: collection!.id, variantNumber: 1, title: 'Вариант 1' })
      .returning();

    const [taskA] = await db
      .insert(schema.tasks)
      .values({
        subjectId: 'math',
        taskNumber: 101,
        difficulty: 1,
        conditionMd: 'A',
        correctAnswer: '1',
        explanationMd: 'A.',
        source: 'demo',
        status: 'published',
      })
      .returning();
    const [taskB] = await db
      .insert(schema.tasks)
      .values({
        subjectId: 'math',
        taskNumber: 102,
        difficulty: 1,
        conditionMd: 'B',
        correctAnswer: '2',
        explanationMd: 'B.',
        source: 'demo',
        status: 'published',
      })
      .returning();

    await db.insert(schema.variantTasks).values([
      { variantId: variant!.id, taskId: taskA!.id, position: 1 },
      { variantId: variant!.id, taskId: taskB!.id, position: 2 },
    ]);

    const members = await db
      .select()
      .from(schema.variantTasks)
      .where(eq(schema.variantTasks.variantId, variant!.id))
      .orderBy(schema.variantTasks.position);
    expect(members).toHaveLength(2);
    expect(members.map((m) => m.taskId)).toEqual([taskA!.id, taskB!.id]);

    // Total tasks table is unaffected in count — no copies were created.
    const allTasks = await db.select().from(schema.tasks).where(eq(schema.tasks.subjectId, 'math'));
    expect(allTasks.filter((t) => t.id === taskA!.id || t.id === taskB!.id)).toHaveLength(2);
  });

  it('rejects a duplicate (variantId, taskId) membership row', async () => {
    const { db } = testDb;
    const [collection] = await db
      .insert(schema.collections)
      .values({ subjectId: 'math', slug: 'dup-collection', title: 'Dup' })
      .returning();
    const [variant] = await db
      .insert(schema.variants)
      .values({ collectionId: collection!.id, variantNumber: 1, title: 'V1' })
      .returning();
    const [task] = await db
      .insert(schema.tasks)
      .values({
        subjectId: 'math',
        taskNumber: 103,
        difficulty: 1,
        conditionMd: 'C',
        correctAnswer: '3',
        explanationMd: 'C.',
        source: 'demo',
        status: 'published',
      })
      .returning();

    await db
      .insert(schema.variantTasks)
      .values({ variantId: variant!.id, taskId: task!.id, position: 1 });
    await expect(
      db
        .insert(schema.variantTasks)
        .values({ variantId: variant!.id, taskId: task!.id, position: 2 }),
    ).rejects.toThrow();
  });

  it('rejects a duplicate variantNumber within the same collection', async () => {
    const { db } = testDb;
    const [collection] = await db
      .insert(schema.collections)
      .values({ subjectId: 'math', slug: 'dup-variant-number', title: 'Dup2' })
      .returning();
    await db
      .insert(schema.variants)
      .values({ collectionId: collection!.id, variantNumber: 1, title: 'V1' });
    await expect(
      db
        .insert(schema.variants)
        .values({ collectionId: collection!.id, variantNumber: 1, title: 'V1 again' }),
    ).rejects.toThrow();
  });

  it('rejects a duplicate collection slug', async () => {
    const { db } = testDb;
    await db
      .insert(schema.collections)
      .values({ subjectId: 'math', slug: 'dup-slug', title: 'First' });
    await expect(
      db
        .insert(schema.collections)
        .values({ subjectId: 'math', slug: 'dup-slug', title: 'Second' }),
    ).rejects.toThrow();
  });
});

describe('users display profile columns (migration 0021)', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it('adds first_name / last_name / avatar_url as nullable text, so pre-existing users stay valid', async () => {
    const { rows } = (await testDb.db.execute(
      `select column_name, data_type, is_nullable from information_schema.columns
       where table_name = 'users' and column_name in ('first_name', 'last_name', 'avatar_url')
       order by column_name`,
    )) as unknown as { rows: { column_name: string; data_type: string; is_nullable: string }[] };
    expect(rows).toEqual([
      { column_name: 'avatar_url', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'first_name', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'last_name', data_type: 'text', is_nullable: 'YES' },
    ]);
  });

  it('a user created the old way (id only) reads back with null profile fields; updates keep other columns', async () => {
    const { db } = testDb;
    const [user] = await db.insert(schema.users).values({}).returning();
    expect(user).toMatchObject({ firstName: null, lastName: null, avatarUrl: null });

    await db.update(schema.users).set({ firstName: 'Иван' }).where(eq(schema.users.id, user!.id));
    const [after] = await db.select().from(schema.users).where(eq(schema.users.id, user!.id));
    expect(after).toMatchObject({ firstName: 'Иван', lastName: null, createdAt: user!.createdAt });
  });

  it('the migration is purely additive: only ADD COLUMN, no drops / NOT NULL / data rewrites', () => {
    const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
    const file = readdirSync(dir).find((name) => name.startsWith('0021_'))!;
    const sql = readFileSync(`${dir}${file}`, 'utf-8');
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements).toHaveLength(3);
    for (const statement of statements) {
      expect(statement).toMatch(/^ALTER TABLE "users" ADD COLUMN "\w+" text;?$/);
    }
  });
});

describe('custom display name, profile source and user_avatars (migration 0022)', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  it('adds display_name / profile_source as nullable text; old users stay valid', async () => {
    const { db } = testDb;
    const { rows } = (await db.execute(
      `select column_name, data_type, is_nullable from information_schema.columns
       where table_name = 'users' and column_name in ('display_name', 'profile_source')
       order by column_name`,
    )) as unknown as { rows: { column_name: string; data_type: string; is_nullable: string }[] };
    expect(rows).toEqual([
      { column_name: 'display_name', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'profile_source', data_type: 'text', is_nullable: 'YES' },
    ]);
    const [user] = await db.insert(schema.users).values({}).returning();
    expect(user).toMatchObject({ displayName: null, profileSource: null });
  });

  it('stores avatar bytes exactly and keeps one row per (user, source)', async () => {
    const { db } = testDb;
    const [user] = await db.insert(schema.users).values({}).returning();
    const data = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255, 1, 2, 3]);
    const base = {
      userId: user!.id,
      source: 'user' as const,
      contentType: 'image/png',
      width: 100,
      height: 100,
      byteSize: data.length,
      sha256: 'x'.repeat(64),
      data,
    };
    await db.insert(schema.userAvatars).values(base);
    const [stored] = await db
      .select()
      .from(schema.userAvatars)
      .where(eq(schema.userAvatars.userId, user!.id));
    expect(Buffer.compare(Buffer.from(stored!.data), data)).toBe(0);
    await expect(db.insert(schema.userAvatars).values(base)).rejects.toThrow();
    await db.insert(schema.userAvatars).values({ ...base, source: 'telegram' });
  });

  it('rejects an avatar for a user that does not exist', async () => {
    await expect(
      testDb.db.insert(schema.userAvatars).values({
        userId: '00000000-0000-4000-8000-000000000000',
        source: 'user' as const,
        contentType: 'image/png',
        width: 1,
        height: 1,
        byteSize: 1,
        sha256: 'y',
        data: Buffer.from([1]),
      }),
    ).rejects.toThrow();
  });

  it('the migration is purely additive: new table + ADD COLUMN, nothing dropped or rewritten', () => {
    const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
    const file = readdirSync(dir).find((name) => name.startsWith('0022_'))!;
    const sql = readFileSync(`${dir}${file}`, 'utf-8');
    const withoutFkActions = sql.replace(/ON DELETE no action ON UPDATE no action/g, '');
    expect(withoutFkActions).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE|RENAME|SET NOT NULL)\b/i);
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) {
      expect(statement).toMatch(
        /^(CREATE TABLE "user_avatars"|ALTER TABLE "(users|user_avatars)" (ADD COLUMN|ADD CONSTRAINT)|CREATE UNIQUE INDEX "user_avatars_)/,
      );
    }
  });
});
