import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  normalizeSeoSettings,
  SEO_DEFAULT_PLATFORMS,
  type SeoAgent,
  type SeoSettings,
} from '@zybrilka/shared';
import { eq, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import * as schema from './schema.js';

/**
 * Helpers shared by the API (SEO Center) and the worker (the agent):
 * settings, the action log, default rows and secret encryption.
 */

type Db = Pick<Database, 'select' | 'insert' | 'update' | 'execute'>;

export async function loadSeoSettings(db: Db): Promise<SeoSettings> {
  const [row] = await db.select().from(schema.seoSettings).where(eq(schema.seoSettings.id, 1));
  return normalizeSeoSettings(row?.value ?? null);
}

export async function saveSeoSettings(db: Db, value: SeoSettings, actorUserId: string | null) {
  await db
    .insert(schema.seoSettings)
    .values({ id: 1, value, updatedBy: actorUserId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.seoSettings.id,
      set: { value, updatedBy: actorUserId, updatedAt: new Date() },
    });
}

export interface SeoLogEntry {
  agent: SeoAgent;
  action: string;
  message: string;
  level?: 'info' | 'warn' | 'error';
  taskId?: string | null;
  articleId?: string | null;
  actorUserId?: string | null;
  details?: Record<string, unknown>;
}

export async function writeSeoLog(db: Pick<Database, 'insert'>, e: SeoLogEntry) {
  await db.insert(schema.seoAgentLog).values({
    agent: e.agent,
    action: e.action,
    message: e.message.slice(0, 2000),
    level: e.level ?? 'info',
    taskId: e.taskId ?? null,
    articleId: e.articleId ?? null,
    actorUserId: e.actorUserId ?? null,
    details: e.details ?? null,
  });
}

/** Idempotent: default platforms and the settings row. */
export async function ensureSeoDefaults(db: Db) {
  await db.insert(schema.seoSettings).values({ id: 1, value: {} }).onConflictDoNothing();
  for (const p of SEO_DEFAULT_PLATFORMS) {
    await db
      .insert(schema.seoPlatforms)
      .values({ slug: p.slug, name: p.name, mode: p.mode, format: p.format, rules: p.rules })
      .onConflictDoNothing();
  }
}

/** Spend in USD since `from` (sum of seo_ai_usage). */
export async function seoSpendSince(db: Pick<Database, 'select'>, from: Date): Promise<number> {
  const [row] = await db
    .select({
      total: sql<string | null>`coalesce(sum((${schema.seoAiUsage.costUsd})::numeric), 0)`,
    })
    .from(schema.seoAiUsage)
    .where(sql`${schema.seoAiUsage.at} >= ${from.toISOString()}`);
  return Number(row?.total ?? 0);
}

/** Start of the current Moscow day / month as UTC instants. */
export function moscowPeriodStarts(now = new Date()) {
  const msk = new Date(now.getTime() + 3 * 3600_000);
  const day = new Date(
    Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate()) - 3 * 3600_000,
  );
  const month = new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), 1) - 3 * 3600_000);
  return { day, month };
}

// ── Secrets ──────────────────────────────────────────────────────────────

export class SeoSecretsKeyMissing extends Error {
  constructor() {
    super('SEO_SECRETS_KEY is not set');
  }
}

/** Parses SEO_SECRETS_KEY (base64 or hex of exactly 32 bytes). */
export function parseSecretsKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const v = raw.trim();
  const buf = /^[0-9a-f]{64}$/i.test(v) ? Buffer.from(v, 'hex') : Buffer.from(v, 'base64');
  return buf.length === 32 ? buf : null;
}

/** AES-256-GCM; output `v1.<iv>.<tag>.<ciphertext>` (base64url). */
export function encryptSecret(key: Buffer | null, plaintext: string): string {
  if (!key) throw new SeoSecretsKeyMissing();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv, tag, enc]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

export function decryptSecret(key: Buffer | null, payload: string): string {
  if (!key) throw new SeoSecretsKeyMissing();
  const [v, iv, tag, enc] = payload.split('.');
  if (v !== 'v1' || !iv || !tag || enc === undefined) throw new Error('bad secret format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(enc, 'base64url')), decipher.final()]).toString(
    'utf8',
  );
}

/** An integration's config + decrypted secret (null when not stored / undecryptable). */
export async function loadIntegration(
  db: Pick<Database, 'select'>,
  key: Buffer | null,
  kind: string,
): Promise<{ config: Record<string, unknown>; secret: string | null; status: string } | null> {
  const [row] = await db
    .select()
    .from(schema.seoIntegrations)
    .where(eq(schema.seoIntegrations.kind, kind));
  if (!row) return null;
  let secret: string | null = null;
  if (row.secretEnc) {
    try {
      secret = decryptSecret(key, row.secretEnc);
    } catch {
      secret = null;
    }
  }
  return { config: row.config, secret, status: row.status };
}
