import { schema } from '@zybrilka/db';
import { createTestDb } from '@zybrilka/db/testing';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fakePng } from '../../testSupport.js';
import { cacheProviderAvatar, isAllowedProviderAvatarUrl } from './providerAvatar.js';
import { resolveProfile } from './service.js';

describe('provider avatar copy', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let userId: string;
  const fetchMock = vi.fn();

  beforeAll(async () => {
    testDb = await createTestDb();
    const [user] = await testDb.db
      .insert(schema.users)
      .values({ avatarUrl: 'https://t.me/i/userpic/320/abc.jpg', profileSource: 'telegram' })
      .returning();
    userId = user!.id;
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => fetchMock.mockReset());
  afterAll(async () => {
    vi.unstubAllGlobals();
    await testDb.close();
  });

  it('only fetches https URLs on the providers’ own image hosts', () => {
    for (const ok of [
      'https://t.me/i/userpic/320/abc.jpg',
      'https://sun9-12.userapi.com/s/v1/ig2/x.jpg?size=200x200',
      'https://cdn4.telesco.pe/file/x.jpg',
    ]) {
      expect(isAllowedProviderAvatarUrl(ok), ok).toBe(true);
    }
    for (const bad of [
      'http://t.me/i/userpic/1.jpg',
      'https://evil.example/t.me.jpg',
      'https://t.me.evil.example/x.jpg',
      'https://user:pw@t.me/x.jpg',
      'https://127.0.0.1/x.jpg',
      'https://t.me:8443/x.jpg',
      'file:///etc/passwd',
      'not a url',
    ]) {
      expect(isAllowedProviderAvatarUrl(bad), bad).toBe(false);
    }
  });

  it('a disallowed URL is never requested', async () => {
    expect(await cacheProviderAvatar(testDb.db, userId, 'vk', 'https://evil.example/a.png')).toBe(
      'skipped',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a failing or non-image download keeps the provider URL', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
    expect(
      await cacheProviderAvatar(
        testDb.db,
        userId,
        'telegram',
        'https://t.me/i/userpic/320/abc.jpg',
      ),
    ).toBe('failed');
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    expect(
      await cacheProviderAvatar(
        testDb.db,
        userId,
        'telegram',
        'https://t.me/i/userpic/320/abc.jpg',
      ),
    ).toBe('failed');
    expect((await resolveProfile(testDb.db, userId)).avatarUrl).toBe(
      'https://t.me/i/userpic/320/abc.jpg',
    );
  });

  it('a real image is stored and then served from our own domain', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(fakePng(64, 64), { status: 200, headers: { 'content-type': 'image/png' } }),
    );
    expect(
      await cacheProviderAvatar(
        testDb.db,
        userId,
        'telegram',
        'https://t.me/i/userpic/320/abc.jpg',
      ),
    ).toBe('stored');
    const profile = await resolveProfile(testDb.db, userId);
    expect(profile.avatarUrl).toMatch(/^\/api\/v1\/me\/avatars\/telegram\?v=[0-9a-f]{12}$/);
    const rows = await testDb.db
      .select()
      .from(schema.userAvatars)
      .where(eq(schema.userAvatars.userId, userId));
    expect(rows.map((r) => r.source)).toEqual(['telegram']);
  });
});
