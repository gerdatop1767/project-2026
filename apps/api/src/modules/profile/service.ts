import { createHash } from 'node:crypto';
import type { Database } from '@zybrilka/db';
import {
  AVATAR_MAX_BYTES,
  displayNameProblem,
  normalizeDisplayName,
  type IdentitiesResponse,
} from '@zybrilka/shared';
import type { Config } from '../../config.js';
import { isTelegramConfigured } from '../auth/telegram.js';
import { isVkConfigured } from '../auth/vk.js';
import { inspectImage, type ImageProblem } from './image.js';
import * as repo from './repo.js';

export interface ResolvedProfile {
  firstName: string | null;
  lastName: string | null;
  customName: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  hasCustomAvatar: boolean;
}

/** URL the browser uses to read one of the user's stored avatar images.
 * `v` (a hash prefix) changes whenever the picture does, so the long-lived
 * cache header is safe and a new upload shows up immediately. */
export function localAvatarUrl(source: repo.AvatarSource, sha256: string): string {
  return `/api/v1/me/avatars/${source}?v=${sha256.slice(0, 12)}`;
}

/**
 * The single place that decides what name and picture to show, so the web
 * client never re-implements the priority rules:
 *
 * name:   the user's own name  >  provider first + last name  >  none
 * avatar: uploaded image  >  provider photo URL (VK / Telegram)  >
 *         image fetched through the Telegram bot  >  none
 */
export async function resolveProfile(db: Database, userId: string): Promise<ResolvedProfile> {
  const [row, avatars] = await Promise.all([
    repo.getProfileRow(db, userId),
    repo.listAvatarMeta(db, userId),
  ]);
  const uploaded = avatars.find((a) => a.source === 'user');
  const viaBot = avatars.find((a) => a.source === 'telegram');
  const providerName = [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || null;
  const customName = row.displayName?.trim() || null;
  return {
    firstName: row.firstName,
    lastName: row.lastName,
    customName,
    displayName: customName ?? providerName,
    avatarUrl: uploaded
      ? localAvatarUrl('user', uploaded.sha256)
      : (row.avatarUrl ?? (viaBot ? localAvatarUrl('telegram', viaBot.sha256) : null)),
    hasCustomAvatar: Boolean(uploaded),
  };
}

export type UpdateNameResult =
  | { ok: true; customName: string | null }
  | { ok: false; problem: 'too_long' | 'forbidden_characters' };

/** Saves (or, for blank input, clears) the user's own display name. */
export async function updateCustomName(
  db: Database,
  userId: string,
  raw: string | null,
): Promise<UpdateNameResult> {
  const normalized = raw === null ? null : normalizeDisplayName(raw);
  if (normalized !== null) {
    const problem = displayNameProblem(normalized);
    if (problem) return { ok: false, problem };
  }
  await repo.setCustomName(db, userId, normalized);
  return { ok: true, customName: normalized };
}

export type SaveAvatarResult =
  { ok: true } | { ok: false; problem: ImageProblem | 'too_large' | 'empty' };

/** Validates raw uploaded bytes by content (not by the client's claims) and
 * stores them as the user's own avatar, replacing any previous one. */
export async function saveUploadedAvatar(
  db: Database,
  userId: string,
  data: Buffer,
): Promise<SaveAvatarResult> {
  return storeAvatar(db, userId, 'user', data);
}

export async function storeAvatar(
  db: Database,
  userId: string,
  source: repo.AvatarSource,
  data: Buffer,
): Promise<SaveAvatarResult> {
  if (data.length === 0) return { ok: false, problem: 'empty' };
  if (data.length > AVATAR_MAX_BYTES) return { ok: false, problem: 'too_large' };
  const inspected = inspectImage(data);
  if ('problem' in inspected) return { ok: false, problem: inspected.problem };
  await repo.upsertAvatar(db, userId, source, {
    contentType: inspected.contentType,
    width: inspected.width,
    height: inspected.height,
    data,
    sha256: createHash('sha256').update(data).digest('hex'),
  });
  return { ok: true };
}

export async function removeUploadedAvatar(db: Database, userId: string): Promise<boolean> {
  return repo.deleteAvatar(db, userId, 'user');
}

export async function readOwnAvatar(db: Database, userId: string, source: repo.AvatarSource) {
  return repo.getAvatar(db, userId, source);
}

export async function listIdentities(
  db: Database,
  config: Config,
  userId: string,
): Promise<IdentitiesResponse> {
  const rows = await repo.listIdentities(db, userId);
  return {
    identities: rows.map((row) => ({
      provider: row.provider,
      linkedAt: row.createdAt.toISOString(),
    })),
    available: { vk: isVkConfigured(config), telegram: isTelegramConfigured(config) },
    canUnlink: rows.length > 1,
  };
}
