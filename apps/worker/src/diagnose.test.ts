import { schema } from '@zybrilka/db';
import { createTestDb } from '@zybrilka/db/testing';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.js';
import { diagnose } from './diagnose.js';

const TOKEN = '123456:SECRET-diagnose-token';

describe('diagnose (read-only, safe to print)', () => {
  it('shows webhook state and counts without the token, the webhook path or user data', async () => {
    const testDb = await createTestDb();
    const [owner] = await testDb.db.insert(schema.users).values({}).returning();
    await testDb.db
      .insert(schema.authIdentities)
      .values({ userId: owner!.id, provider: 'telegram', providerUserId: '777' });
    await testDb.db.insert(schema.telegramOutbox).values({
      kind: 'registration',
      payload: { userId: 'u', method: 'vk', at: 'x', campaign: null },
      status: 'skipped',
      lastError: 'no_recipients',
    });
    const fetch = vi.fn(async (url: string) => {
      const method = String(url).split('/').pop();
      const result =
        method === 'getMe'
          ? { id: 1, username: 'zybrilka_bot' }
          : {
              url: 'https://hooks.example.org/secret-path-abcdef123456',
              pending_update_count: 3,
              last_error_message: 'Connection timed out',
              last_error_date: 1_800_000_000,
              allowed_updates: ['message'],
            };
      return new Response(JSON.stringify({ ok: true, result }));
    });
    const report = await diagnose(
      loadConfig({
        TELEGRAM_BOT_TOKEN: TOKEN,
        ADMIN_OWNER_USER_IDS: owner!.id,
        WEB_BASE_URL: 'https://zybrilka.ru',
      } as NodeJS.ProcessEnv),
      { fetch: fetch as unknown as typeof globalThis.fetch, db: testDb.db },
    );
    const text = JSON.stringify(report);
    expect(text).not.toContain('SECRET');
    expect(text).not.toContain('secret-path');
    expect(report).toMatchObject({
      config: { botTokenSet: true, polling: false, healthCheckUrlSet: false, owners: 1 },
      bot: { username: 'zybrilka_bot' },
      webhook: {
        set: true,
        host: 'hooks.example.org',
        pendingUpdateCount: 3,
        lastErrorMessage: 'Connection timed out',
        allowedUpdates: ['message'],
      },
      database: {
        botChats: { total: 0, blocked: 0 },
        ownersWithTelegram: 1,
        outboxLast7Days: [
          { kind: 'registration', status: 'skipped', lastError: 'no_recipients', n: 1 },
        ],
      },
    });
    // Only read-only Bot API methods.
    expect(fetch.mock.calls.map((c) => String(c[0]).split('/').pop()).sort()).toEqual([
      'getMe',
      'getWebhookInfo',
    ]);
    await testDb.close();
  }, 30_000);
});
