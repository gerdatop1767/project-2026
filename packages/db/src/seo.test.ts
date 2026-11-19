import { DEFAULT_SEO_SETTINGS } from '@zybrilka/shared';
import { describe, expect, it } from 'vitest';
import * as schema from './schema.js';
import {
  decryptSecret,
  encryptSecret,
  ensureSeoDefaults,
  loadSeoSettings,
  moscowPeriodStarts,
  parseSecretsKey,
  saveSeoSettings,
  seoSpendSince,
} from './seo.js';
import { createTestDb } from './testing.js';

describe('seo db helpers', () => {
  it('migration seeds settings and competitors; defaults add platforms idempotently', async () => {
    const { db } = await createTestDb();
    expect(await loadSeoSettings(db)).toEqual(DEFAULT_SEO_SETTINGS);
    await ensureSeoDefaults(db);
    await ensureSeoDefaults(db);
    const platforms = await db.select().from(schema.seoPlatforms);
    expect(platforms.map((p) => p.slug).sort()).toEqual([
      'dzen',
      'pikabu',
      'reddit',
      'telegram',
      'vc',
      'vk',
    ]);
    expect(platforms.find((p) => p.slug === 'telegram')!.mode).toBe('api');
    expect((await db.select().from(schema.seoCompetitors)).length).toBe(6);
    await saveSeoSettings(db, { ...DEFAULT_SEO_SETTINGS, mode: 'auto' }, null);
    expect((await loadSeoSettings(db)).mode).toBe('auto');
  });

  it('sums spend', async () => {
    const { db } = await createTestDb();
    await db.insert(schema.seoAiUsage).values([
      { agent: 'content', purpose: 'x', model: 'claude-opus-5-5', costUsd: 0.5 },
      { agent: 'content', purpose: 'x', model: 'claude-opus-5-5', costUsd: 0.25 },
    ]);
    expect(await seoSpendSince(db, new Date(Date.now() - 3600_000))).toBeCloseTo(0.75);
    expect(await seoSpendSince(db, new Date(Date.now() + 3600_000))).toBe(0);
  });

  it('encrypts secrets with AES-GCM and rejects tampering', () => {
    const key = parseSecretsKey(Buffer.alloc(32, 7).toString('base64'));
    expect(parseSecretsKey('short')).toBeNull();
    const enc = encryptSecret(key, 'token-123');
    expect(enc).not.toContain('token-123');
    expect(decryptSecret(key, enc)).toBe('token-123');
    const parts = enc.split('.');
    parts[3] = Buffer.from('other').toString('base64url');
    expect(() => decryptSecret(key, parts.join('.'))).toThrow();
    expect(() => encryptSecret(null, 'x')).toThrow('SEO_SECRETS_KEY');
  });

  it('computes Moscow day/month starts', () => {
    const { day, month } = moscowPeriodStarts(new Date('2026-11-19T22:30:00Z'));
    expect(day.toISOString()).toBe('2026-11-19T21:00:00.000Z');
    expect(month.toISOString()).toBe('2026-10-31T21:00:00.000Z');
  });
});
