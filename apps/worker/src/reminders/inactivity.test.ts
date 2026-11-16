import { schema } from '@zybrilka/db';
import { createSeededTestDb } from '@zybrilka/db/testing';
import { examCountdown, inactivityReminderText } from '@zybrilka/shared';
import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleUpdate } from '../bot/handleUpdate.js';
import { BotPhotos } from '../bot/photos.js';
import { TelegramApiError, type TelegramClient, type TelegramMessage } from '../telegram/client.js';
import { InactivityReminderScheduler } from './inactivity.js';

const SITE = 'https://zybrilka.ru';
const logger = pino({ enabled: false });
const DAY = 86_400_000;
/** 15 Nov 2026, 12:00 MSK — inside the send window. */
const NOW = new Date('2026-11-15T09:00:00Z');

function fakeTelegram() {
  let id = 1;
  const t = {
    getMe: vi.fn(),
    getWebhookInfo: vi.fn(),
    getUpdates: vi.fn(async () => []),
    sendMessage: vi.fn(
      async (chatId: number, _text: string, _o?: unknown): Promise<TelegramMessage> => ({
        message_id: id++,
        chat: { id: chatId, type: 'private' },
      }),
    ),
    sendPhoto: vi.fn(),
    sendMediaGroup: vi.fn(),
    answerCallbackQuery: vi.fn(async () => true as const),
  };
  return t as typeof t & TelegramClient;
}

describe('inactivity reminders («Давно не виделись»)', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;
  let telegram: ReturnType<typeof fakeTelegram>;
  let chat = 9000;
  let now = NOW;

  beforeAll(async () => {
    testDb = await createSeededTestDb();
  });
  afterAll(async () => {
    await testDb.close();
  });
  beforeEach(async () => {
    telegram = fakeTelegram();
    now = NOW;
    await testDb.db.delete(schema.inactivityReminders);
    // Each test sees only its own students: earlier ones become unreachable.
    await testDb.db.update(schema.telegramBotChats).set({ blockedAt: new Date() });
  });

  const scheduler = (
    extra: Partial<ConstructorParameters<typeof InactivityReminderScheduler>[0]> = {},
  ) =>
    new InactivityReminderScheduler({
      db: testDb.db,
      telegram,
      logger,
      siteUrl: SITE,
      now: () => now,
      sleep: async () => {},
      ...extra,
    });

  /** An account whose last activity (a sign-in) was `daysAgo` days before NOW. */
  async function student(
    daysAgo: number,
    o: { telegram?: boolean; botChat?: boolean; settings?: boolean | null } = {},
  ) {
    const chatId = ++chat;
    const at = new Date(NOW.getTime() - daysAgo * DAY);
    const [user] = await testDb.db
      .insert(schema.users)
      .values({ createdAt: at, lastSeenAt: at })
      .returning();
    const userId = user!.id;
    if (o.telegram !== false) {
      await testDb.db
        .insert(schema.authIdentities)
        .values({ userId, provider: 'telegram', providerUserId: String(chatId) });
    }
    if (o.botChat !== false) {
      await testDb.db.insert(schema.telegramBotChats).values({ chatId, userId });
    }
    if (o.settings !== undefined && o.settings !== null) {
      await testDb.db.insert(schema.reminderSettings).values({ userId, enabled: o.settings });
    }
    await testDb.db
      .insert(schema.authSessions)
      .values({ userId, createdAt: at, expiresAt: new Date(at.getTime() + 30 * DAY) });
    return { userId, chatId };
  }
  const sentTo = () => telegram.sendMessage.mock.calls.map((c) => c[0]);

  it('4 days away — nothing; more than 5 days — one reminder with the exam countdown', async () => {
    const fresh = await student(4);
    const away = await student(5.2);
    const r = await scheduler().run();
    expect(sentTo()).toEqual([away.chatId]);
    expect(sentTo()).not.toContain(fresh.chatId);
    expect(r).toMatchObject({ due: 1, sent: 1, failed: 0 });
    expect(r.checked).toBeGreaterThanOrEqual(2);
    const [, text, options] = telegram.sendMessage.mock.calls[0]!;
    expect(text).toBe(inactivityReminderText(NOW));
    expect(text).toContain('До первого ЕГЭ осталось 198 дней');
    const buttons = (
      options as { replyMarkup: { inline_keyboard: { text: string }[][] } }
    ).replyMarkup.inline_keyboard.flat();
    expect(buttons.map((b) => b.text)).toEqual(['Начать тренировку', 'Отключить напоминания']);
    const [row] = await testDb.db
      .select()
      .from(schema.inactivityReminders)
      .where(eq(schema.inactivityReminders.userId, away.userId));
    expect(row).toMatchObject({ status: 'sent', daysToExam: 198, localDate: '2026-11-15' });
  });

  it('exactly 5 days is not «more than 5 days»', async () => {
    await student(5);
    await scheduler().run();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('no Telegram, bot never started or blocked, notifications off, daily reminder on — nothing', async () => {
    await student(10, { telegram: false });
    await student(10, { botChat: false });
    const blocked = await student(10);
    await testDb.db
      .update(schema.telegramBotChats)
      .set({ blockedAt: new Date() })
      .where(eq(schema.telegramBotChats.chatId, blocked.chatId));
    await student(10, { settings: false }); // switched notifications off
    await student(10, { settings: true }); // already gets the daily reminder
    await scheduler().run();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('a repeated run, a restarted or a second worker sends no duplicate', async () => {
    const s = await student(7);
    await Promise.all([scheduler().run(), scheduler().run()]);
    await scheduler().run();
    expect(sentTo()).toEqual([s.chatId]);
    expect(
      await testDb.db
        .select()
        .from(schema.inactivityReminders)
        .where(eq(schema.inactivityReminders.userId, s.userId)),
    ).toHaveLength(1);
  });

  it('while still away: the next reminder only after another 5 days', async () => {
    const s = await student(6);
    await scheduler().run();
    now = new Date(NOW.getTime() + 4 * DAY);
    await scheduler().run();
    expect(sentTo()).toEqual([s.chatId]);
    now = new Date(NOW.getTime() + 5 * DAY + 60_000);
    await scheduler().run();
    expect(sentTo()).toEqual([s.chatId, s.chatId]);
  });

  it('a student who came back gets no more reminders (and no pending retry)', async () => {
    const s = await student(6);
    telegram.sendMessage.mockRejectedValueOnce(
      new TelegramApiError('sendMessage', 'network', null, 'down', null, {
        code: 'ECONNREFUSED',
        timeout: false,
        maybeDelivered: false,
      }),
    );
    await scheduler().run();
    const [pending] = await testDb.db
      .select()
      .from(schema.inactivityReminders)
      .where(eq(schema.inactivityReminders.userId, s.userId));
    expect(pending!.status).toBe('retry');

    // The student answers a task an hour later.
    now = new Date(NOW.getTime() + 60 * 60_000);
    const [task] = await testDb.db.select({ id: schema.tasks.id }).from(schema.tasks).limit(1);
    await testDb.db.insert(schema.attempts).values({
      userId: s.userId,
      taskId: task!.id,
      answerRaw: '1',
      isCorrect: true,
      createdAt: now,
    });
    const r = await scheduler().run();
    expect(r.skipped).toBe(1);
    now = new Date(NOW.getTime() + 60 * 60_000 + 4 * DAY); // 4 days after coming back
    await scheduler().run();
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1); // just the failed first try
    now = new Date(NOW.getTime() + 60 * 60_000 + 5 * DAY + 60_000);
    await scheduler().run();
    expect(telegram.sendMessage).toHaveBeenCalledTimes(2); // away again → a new reminder
  });

  it('Telegram limits and outages: a 429 stops the batch and is retried later; a block marks the chat', async () => {
    const a = await student(9);
    const b = await student(8);
    telegram.sendMessage.mockRejectedValueOnce(
      new TelegramApiError('sendMessage', 'rate_limited', 429, 'Too Many Requests', 3),
    );
    const r1 = await scheduler().run();
    expect(r1).toMatchObject({ sent: 0, failed: 1 });
    expect(sentTo()).toEqual([a.chatId]); // b waits for the next run
    now = new Date(NOW.getTime() + 2 * 60_000);
    await scheduler().run();
    expect(sentTo()).toEqual([a.chatId, a.chatId, b.chatId]);

    const c = await student(9);
    telegram.sendMessage.mockRejectedValueOnce(
      new TelegramApiError('sendMessage', 'unreachable', 403, 'Forbidden: bot was blocked'),
    );
    await scheduler().run();
    const [chatRow] = await testDb.db
      .select()
      .from(schema.telegramBotChats)
      .where(eq(schema.telegramBotChats.chatId, c.chatId));
    expect(chatRow!.blockedAt).not.toBeNull();
  });

  it('a batch limit per run spreads the load', async () => {
    for (let i = 0; i < 5; i++) await student(10 + i);
    const r = await scheduler({ batchSize: 2 }).run();
    expect(r.sent).toBe(2);
    await scheduler({ batchSize: 2 }).run();
    await scheduler({ batchSize: 2 }).run();
    expect(telegram.sendMessage).toHaveBeenCalledTimes(5);
  });

  it('not at night (Moscow time) and not during the main exam period', async () => {
    await student(10);
    now = new Date('2026-11-15T19:30:00Z'); // 22:30 MSK
    expect((await scheduler().run()).paused).toBe('night');
    now = new Date('2027-06-02T09:00:00Z');
    expect(examCountdown(now).kind).toBe('during');
    expect((await scheduler().run()).paused).toBe('exam_period');
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('«Отключить напоминания» under the nudge switches it off for an account without settings', async () => {
    const s = await student(10);
    await scheduler().run();
    expect(sentTo()).toEqual([s.chatId]);
    await handleUpdate(
      { db: testDb.db, telegram, photos: new BotPhotos(testDb.db), siteUrl: SITE, logger },
      {
        update_id: 1,
        callback_query: {
          id: 'cb',
          from: { id: s.chatId },
          data: 'reminders_off',
          message: { message_id: 1, chat: { id: s.chatId, type: 'private' } },
        },
      },
    );
    const [settings] = await testDb.db
      .select()
      .from(schema.reminderSettings)
      .where(eq(schema.reminderSettings.userId, s.userId));
    expect(settings!.enabled).toBe(false);
    now = new Date(NOW.getTime() + 6 * DAY);
    telegram.sendMessage.mockClear();
    await scheduler().run();
    expect(sentTo()).not.toContain(s.chatId);
  });
});
