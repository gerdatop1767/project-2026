import { schema } from '@zybrilka/db';
import { createTestDb } from '@zybrilka/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backfillProviderAvatars,
  resetProviderAvatarBackfillForTests,
} from './providerAvatarBackfill.js';
import { chooseAvatar } from './service.js';
import type { AvatarMeta } from './repo.js';

describe('rating avatars: which photo, and copying provider photos', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    testDb = await createTestDb();
  });
  afterAll(async () => {
    await testDb.close();
  });
  beforeEach(() => resetProviderAvatarBackfillForTests());

  const meta = (source: AvatarMeta['source']) =>
    ({ id: `id-${source}`, source, sha256: 'f'.repeat(64) }) as AvatarMeta;

  it('priority: own photo > profile provider copy > provider URL (profile only) > other copies > none', () => {
    const all = [meta('telegram'), meta('vk'), meta('user'), meta('yandex')];
    expect(chooseAvatar(all, 'vk', true)).toMatchObject({ source: 'user' });
    expect(chooseAvatar(all.slice(0, 2), 'telegram', true)).toMatchObject({ source: 'telegram' });
    // The profile itself may use the provider URL…
    expect(chooseAvatar([meta('yandex')], 'vk', true)).toBe('external');
    // …what others see never does: a stored copy of a connected provider.
    expect(chooseAvatar([meta('yandex')], 'vk', true, { storedOnly: true })).toMatchObject({
      source: 'yandex',
    });
    expect(chooseAvatar([], 'vk', true, { storedOnly: true })).toBeNull();
    expect(chooseAvatar([], null, false)).toBeNull();
  });

  it('copies through the profile provider, once per retry window, a few per call', async () => {
    const rows = await testDb.db
      .insert(schema.users)
      .values([
        { profileSource: 'vk', avatarUrl: 'https://sun9-1.userapi.com/a.jpg' },
        {
          profileSource: 'yandex',
          avatarUrl: 'https://avatars.yandex.net/get-yapic/1/islands-200',
        },
        { profileSource: null, avatarUrl: 'https://sun9-1.userapi.com/b.jpg' },
        { profileSource: 'telegram', avatarUrl: null },
      ])
      .returning();
    const ids = rows.map((r) => r.id);
    const cache = vi.fn(async () => 'stored' as const);
    await backfillProviderAvatars(testDb.db, ids, { now: 1000, cache });
    expect(cache.mock.calls.map((c) => [c[2], c[3]]).sort()).toEqual(
      [
        ['vk', 'https://sun9-1.userapi.com/a.jpg'],
        ['yandex', 'https://avatars.yandex.net/get-yapic/1/islands-200'],
      ].sort(),
    );
    // Tried just now: not again soon…
    await backfillProviderAvatars(testDb.db, ids, { now: 2000, cache });
    expect(cache).toHaveBeenCalledTimes(2);
    // …but again after the retry window.
    await backfillProviderAvatars(testDb.db, ids, { now: 1000 + 7 * 3600_000, cache });
    expect(cache).toHaveBeenCalledTimes(4);

    const many = await testDb.db
      .insert(schema.users)
      .values(
        Array.from({ length: 9 }, () => ({
          profileSource: 'vk' as const,
          avatarUrl: 'https://sun9-1.userapi.com/c.jpg',
        })),
      )
      .returning();
    const cache2 = vi.fn(async () => 'stored' as const);
    await backfillProviderAvatars(
      testDb.db,
      many.map((r) => r.id),
      { now: 5000, cache: cache2 },
    );
    expect(cache2).toHaveBeenCalledTimes(5);
  });
});
