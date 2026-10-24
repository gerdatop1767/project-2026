import { schema } from '@zybrilka/db';
import { createTestDb } from '@zybrilka/db/testing';
import { ADMIN_NOTIFICATIONS_KEY, type OutboxPayload } from '@zybrilka/shared';
import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramApiError, type TelegramClient } from '../telegram/client.js';
import { AdminNotifier } from './adminNotifier.js';
import { renderNotification } from './format.js';
import { HealthMonitor } from './healthMonitor.js';

const SITE = 'https://zybrilka.ru';
const logger = pino({ enabled: false });

function fakeTelegram() {
  const t = {
    getMe: vi.fn(),
    getUpdates: vi.fn(),
    sendMessage: vi.fn(async (chatId: number, _text: string, _options?: unknown) => ({
      message_id: 1,
      chat: { id: chatId, type: 'private' as const },
    })),
    sendPhoto: vi.fn(),
    sendMediaGroup: vi.fn(),
    answerCallbackQuery: vi.fn(),
  };
  return t as typeof t & TelegramClient;
}

const registration = (userId: string): OutboxPayload => ({
  kind: 'registration',
  data: { userId, method: 'vk', at: '2026-10-23T12:00:00.000Z', campaign: null },
});
const complaint = (comment: string): OutboxPayload => ({
  kind: 'complaint',
  data: {
    complaintId: '9a0e5d0c-3c6f-4c1e-9b1a-2f4d5e6f7a8b',
    reportNumber: 12,
    subjectName: 'Математика',
    taskId: '1b2c3d4e-0000-4000-8000-000000000001',
    taskNumber: 6,
    reason: 'wrong_answer',
    comment,
    at: '2026-10-23T12:00:00.000Z',
  },
});
const siteError: OutboxPayload = {
  kind: 'site_error',
  data: {
    method: 'POST',
    route: '/api/v1/tasks/:id/attempt',
    status: 500,
    error: 'TypeError',
    suppressed: 0,
    firstAt: '2026-10-23T12:00:00.000Z',
    at: '2026-10-23T12:00:00.000Z',
  },
};

describe('admin notifications', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let owner: string;
  let telegram: ReturnType<typeof fakeTelegram>;
  let notifier: AdminNotifier;
  const OWNER_TG = 7001;
  const STRANGER_TG = 7002;

  beforeAll(async () => {
    testDb = await createTestDb();
    const [o] = await testDb.db.insert(schema.users).values({}).returning();
    owner = o!.id;
    const [stranger] = await testDb.db.insert(schema.users).values({}).returning();
    await testDb.db.insert(schema.authIdentities).values([
      { userId: owner, provider: 'telegram', providerUserId: String(OWNER_TG) },
      { userId: stranger!.id, provider: 'telegram', providerUserId: String(STRANGER_TG) },
    ]);
    // Both started the bot; only the owner is an admin.
    await testDb.db.insert(schema.telegramBotChats).values([
      { chatId: OWNER_TG, userId: owner },
      { chatId: STRANGER_TG, userId: stranger!.id },
    ]);
  });
  afterAll(async () => {
    await testDb.close();
  });
  beforeEach(async () => {
    await testDb.db.delete(schema.telegramOutbox);
    await testDb.db.delete(schema.appSettings);
    await testDb.db.update(schema.telegramBotChats).set({ blockedAt: null });
    telegram = fakeTelegram();
    notifier = new AdminNotifier({
      db: testDb.db,
      telegram,
      ownerIds: [owner],
      siteUrl: SITE,
      logger,
    });
  });

  const enqueue = (payload: OutboxPayload) =>
    testDb.db
      .insert(schema.telegramOutbox)
      .values({ kind: payload.kind, payload: payload.data as unknown as Record<string, unknown> })
      .returning()
      .then((r) => r[0]!);
  const statusOf = async (id: string) =>
    (
      await testDb.db.select().from(schema.telegramOutbox).where(eq(schema.telegramOutbox.id, id))
    )[0]!;
  const setSettings = (value: object) =>
    testDb.db.insert(schema.appSettings).values({ key: ADMIN_NOTIFICATIONS_KEY, value });

  it('goes only to the owner’s verified Telegram chat, never to other users', async () => {
    const row = await enqueue(registration('u-1'));
    expect(await notifier.processOutbox()).toBe(1);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage.mock.calls[0]![0]).toBe(OWNER_TG);
    expect((await statusOf(row.id)).status).toBe('sent');
  });

  it('each kind can be switched off on its own; the rest still go out', async () => {
    await setSettings({ registrations: false, siteErrors: true, complaints: true });
    const reg = await enqueue(registration('u-2'));
    const com = await enqueue(complaint('ответ неверный'));
    const err = await enqueue(siteError);
    await notifier.processOutbox();
    expect((await statusOf(reg.id)).status).toBe('skipped');
    expect((await statusOf(com.id)).status).toBe('sent');
    expect((await statusOf(err.id)).status).toBe('sent');

    for (const [key, kind] of [
      ['complaints', complaint('x')],
      ['siteErrors', siteError],
    ] as const) {
      await testDb.db.delete(schema.appSettings);
      await setSettings({ registrations: true, siteErrors: true, complaints: true, [key]: false });
      const fresh = new AdminNotifier({
        db: testDb.db,
        telegram,
        ownerIds: [owner],
        siteUrl: SITE,
        logger,
      });
      const off = await enqueue(kind);
      const on = await enqueue(registration(`u-${key}`));
      await fresh.processOutbox();
      expect((await statusOf(off.id)).status).toBe('skipped');
      expect((await statusOf(on.id)).status).toBe('sent');
    }
  });

  it('with no owner linked to the bot nothing is sent and nothing piles up', async () => {
    const lonely = new AdminNotifier({
      db: testDb.db,
      telegram,
      ownerIds: [],
      siteUrl: SITE,
      logger,
    });
    const row = await enqueue(registration('u-3'));
    await lonely.processOutbox();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(await statusOf(row.id)).toMatchObject({ status: 'skipped', lastError: 'no_recipients' });
  });

  it('a 429 waits for retry_after; a network error retries later; then gives up', async () => {
    telegram.sendMessage.mockRejectedValueOnce(
      new TelegramApiError('sendMessage', 'rate_limited', 429, 'Too Many Requests', 42),
    );
    const row = await enqueue(complaint('x'));
    const before = Date.now();
    await notifier.processOutbox();
    const after429 = await statusOf(row.id);
    expect(after429.status).toBe('pending');
    expect(after429.lastError).toBe('rate_limited');
    expect(after429.nextAttemptAt.getTime() - before).toBeGreaterThanOrEqual(41_000);

    telegram.sendMessage.mockRejectedValue(
      new TelegramApiError('sendMessage', 'network', null, 'timeout'),
    );
    for (let i = 0; i < 6; i++) {
      await testDb.db
        .update(schema.telegramOutbox)
        .set({ nextAttemptAt: new Date(0) })
        .where(eq(schema.telegramOutbox.id, row.id));
      await notifier.processOutbox();
    }
    expect(await statusOf(row.id)).toMatchObject({ status: 'failed', lastError: 'network' });
  });

  it('regression: reaches the owner with no /start recorded (bot not reading updates)', async () => {
    // Production had TELEGRAM_BOT_POLLING=false, so telegram_bot_chats stayed
    // empty and every notification ended as «no_recipients». The owner's
    // private chat id is their verified Telegram id — no recorded /start needed.
    const [lonelyOwner] = await testDb.db.insert(schema.users).values({}).returning();
    await testDb.db
      .insert(schema.authIdentities)
      .values({ userId: lonelyOwner!.id, provider: 'telegram', providerUserId: '7333' });
    const noPolling = new AdminNotifier({
      db: testDb.db,
      telegram,
      ownerIds: [lonelyOwner!.id],
      siteUrl: SITE,
      logger,
    });
    const row = await enqueue(registration('u-reg'));
    await noPolling.processOutbox();
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage.mock.calls[0]![0]).toBe(7333);
    expect((await statusOf(row.id)).status).toBe('sent');
  });

  it('an owner who has not pressed Start: «not_started», and nothing is marked blocked', async () => {
    telegram.sendMessage.mockRejectedValueOnce(
      new TelegramApiError(
        'sendMessage',
        'unreachable',
        403,
        "Forbidden: bot can't initiate conversation with a user",
      ),
    );
    const row = await enqueue(registration('u-4'));
    await notifier.processOutbox();
    expect(await statusOf(row.id)).toMatchObject({ status: 'failed', lastError: 'not_started' });
    const [chat] = await testDb.db
      .select()
      .from(schema.telegramBotChats)
      .where(eq(schema.telegramBotChats.chatId, OWNER_TG));
    expect(chat!.blockedAt).toBeNull();
    // Once they press Start, the next one goes through.
    const next = await enqueue(registration('u-5'));
    await notifier.processOutbox();
    expect((await statusOf(next.id)).status).toBe('sent');
  });

  it('two workers never send the same row twice', async () => {
    await enqueue(registration('u-5'));
    const other = new AdminNotifier({
      db: testDb.db,
      telegram,
      ownerIds: [owner],
      siteUrl: SITE,
      logger,
    });
    await Promise.all([notifier.processOutbox(), other.processOutbox()]);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('messages carry the essentials and escape user text', () => {
    const r = renderNotification(complaint('<b>x</b> & <script>'), SITE);
    expect(r.text).toContain('Жалоба RPT-12');
    expect(r.text).toContain('Математика · задание №6');
    expect(r.text).toContain('Неправильный ответ в задании');
    expect(r.text).toContain('&lt;b&gt;x&lt;/b&gt; &amp; &lt;script&gt;');
    expect(r.keyboard!.inline_keyboard[0]![0]).toEqual({
      text: 'Открыть жалобу',
      url: `${SITE}/admin/complaints/9a0e5d0c-3c6f-4c1e-9b1a-2f4d5e6f7a8b`,
    });
    const reg = renderNotification(registration('abc'), SITE);
    expect(reg.text).toContain('VK ID');
    expect(reg.text).toContain('Источник: не определён');
    expect(reg.text).toContain('23.10.2026');
  });
});

describe('HealthMonitor', () => {
  it('one alert per outage after two failed probes, reminders on a cooldown, then recovery', async () => {
    let now = 0;
    const results: boolean[] = [];
    const notify = vi.fn(async (_text: string) => {});
    const monitor = new HealthMonitor({
      probe: async () => ({ ok: results.shift() ?? true, reason: 'база данных недоступна' }),
      notify,
      reminderMs: 60 * 60_000,
      now: () => now,
    });
    const tick = async (ok: boolean) => {
      results.push(ok);
      await monitor.check();
      now += 60_000;
    };

    await tick(false); // a single blip: no alert
    expect(notify).not.toHaveBeenCalled();
    await tick(true);
    await tick(false);
    await tick(false); // second in a row: alert
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![0]).toContain('Сайт недоступен');
    expect(notify.mock.calls[0]![0]).toContain('база данных недоступна');
    for (let i = 0; i < 30; i++) await tick(false); // still down: no flood
    expect(notify).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 40; i++) await tick(false); // past the cooldown: one reminder
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[1]![0]).toContain('всё ещё недоступен');
    await tick(true);
    expect(notify).toHaveBeenCalledTimes(3);
    expect(notify.mock.calls[2]![0]).toContain('снова работает');
    await tick(true);
    expect(notify).toHaveBeenCalledTimes(3);
  });

  it('a probe that throws counts as a failure', async () => {
    const notify = vi.fn(async (_text: string) => {});
    const monitor = new HealthMonitor({
      probe: async () => {
        throw new Error('boom');
      },
      notify,
    });
    await monitor.check();
    await monitor.check();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('site-error notifications switched off: the direct alert is not sent', async () => {
    const testDb = await createTestDb();
    const [o] = await testDb.db.insert(schema.users).values({}).returning();
    await testDb.db
      .insert(schema.authIdentities)
      .values({ userId: o!.id, provider: 'telegram', providerUserId: '8001' });
    await testDb.db.insert(schema.telegramBotChats).values({ chatId: 8001, userId: o!.id });
    await testDb.db.insert(schema.appSettings).values({
      key: ADMIN_NOTIFICATIONS_KEY,
      value: { registrations: true, siteErrors: false, complaints: true },
    });
    const telegram = fakeTelegram();
    const notifier = new AdminNotifier({
      db: testDb.db,
      telegram,
      ownerIds: [o!.id],
      siteUrl: SITE,
      logger,
    });
    await notifier.sendDirect('down', 'siteErrors');
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    await notifier.sendDirect('down', 'registrations');
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    await testDb.close();
  });
});
