import { schema } from '@zybrilka/db';
import { createSeededTestDb } from '@zybrilka/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolvePeriod } from '../period.js';
import { fixtures } from '../testFixtures.js';
import { qualityReport } from './quality.js';
import { adminSettingsSchema } from './settings.js';

const NOW = new Date('2026-03-30T09:00:00Z');

describe('quality signals', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;
  let hard: string;
  let small: string;
  let complained: string;

  beforeAll(async () => {
    testDb = await createSeededTestDb();
    const f = fixtures(testDb.db);
    const t = await f.publishedTasks('math', 3);
    [hard, small, complained] = t.map((x) => x.id) as [string, string, string];
    const users = await Promise.all(
      Array.from({ length: 31 }, (_, i) => f.user(`2026-03-01T0${i % 9}:00:00Z`)),
    );
    // 31 answers on `hard`, 1 correct (3%): flagged. 10 wrong answers on `small`: too few to judge.
    for (const [i, u] of users.entries()) {
      await f.attempt(u, hard, i === 0, '2026-03-20T10:00:00Z');
      if (i < 10) await f.attempt(u, small, false, '2026-03-20T11:00:00Z');
    }
    for (const u of users.slice(0, 2)) {
      await testDb.db
        .insert(schema.taskComplaints)
        .values({ taskId: complained, userId: u, reason: 'typo' });
    }
  });
  afterAll(async () => {
    await testDb.close();
  });

  it('flags low accuracy only above the minimum sample, and explains why', async () => {
    const r = await qualityReport(
      testDb.db,
      resolvePeriod({ period: '30d' }, NOW),
      adminSettingsSchema.parse({}),
    );
    const byId = new Map(r.items.map((i) => [i.id, i]));
    const hardSignals = byId.get(hard)!.signals.map((s) => s.type);
    expect(hardSignals).toContain('low_accuracy');
    expect(byId.get(hard)!.signals.find((s) => s.type === 'low_accuracy')!.detail).toMatch(
      /Точность 3% при 31 ответах/,
    );
    expect(byId.get(small)?.signals.map((s) => s.type) ?? []).not.toContain('low_accuracy');
    expect(byId.get(complained)!.signals.map((s) => s.type)).toContain('complaints');
    // Behavioural problems come first.
    expect(r.items[0]!.id === hard || r.items[0]!.id === complained).toBe(true);
  });

  it('thresholds are configurable', async () => {
    const strict = adminSettingsSchema.parse({
      quality: {
        minSample: 5,
        lowAccuracy: 0.15,
        accuracyDrop: 0.25,
        complaints: 5,
        abandonment: 0.6,
      },
    });
    const r = await qualityReport(testDb.db, resolvePeriod({ period: '30d' }, NOW), strict);
    const byId = new Map(r.items.map((i) => [i.id, i]));
    expect(byId.get(small)!.signals.map((s) => s.type)).toContain('low_accuracy');
    expect(byId.get(complained)?.signals.map((s) => s.type) ?? []).not.toContain('complaints');
  });
});
