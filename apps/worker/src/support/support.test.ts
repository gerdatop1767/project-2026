import { createTelegramLinkToken, schema } from '@zybrilka/db';
import { createTestDb } from '@zybrilka/db/testing';
import { reminderText, supportTexts } from '@zybrilka/shared';
import { and, eq } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleUpdate, type BotContext } from '../bot/handleUpdate.js';
import { BotPhotos } from '../bot/photos.js';
import { ReminderScheduler } from '../reminders/scheduler.js';
import {
  TelegramApiError,
  type TelegramClient,
  type TelegramMessage,
  type TelegramUpdate,
} from '../telegram/client.js';
import { SupportSender } from './sender.js';

const SITE = 'https://zybrilka.ru';
const logger = pino({ enabled: false });

let messageId = 100;
function fakeTelegram() {
  const t = {
    getMe: vi.fn(),
    getWebhookInfo: vi.fn(),
    getUpdates: vi.fn(async () => [] as TelegramUpdate[]),
    sendMessage: vi.fn(
      async (chatId: number, _text: string, _options?: unknown): Promise<TelegramMessage> => ({
        message_id: messageId++,
        chat: { id: chatId, type: 'private' },
      }),
    ),
    sendPhoto: vi.fn(async (chatId: number) => ({
      message_id: messageId++,
      chat: { id: chatId, type: 'private' as const },
    })),
    sendMediaGroup: vi.fn(),
    answerCallbackQuery: vi.fn(async () => true as const),
  };
  return t as typeof t & TelegramClient;
}

let updateId = 1;
const msg = (from: number, fields: Partial<TelegramMessage>): TelegramUpdate => ({
  update_id: updateId++,
  message: {
    message_id: fields.message_id ?? updateId * 10,
    chat: { id: from, type: 'private' },
    from: { id: from },
    ...fields,
  },
});
const tap = (from: number, data: string): TelegramUpdate => ({
  update_id: updateId++,
  callback_query: {
    id: `cb${updateId}`,
    from: { id: from },
    data,
    message: { message_id: 1, chat: { id: from, type: 'private' } },
  },
});

describe('support, linking and reminders through the bot', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let telegram: ReturnType<typeof fakeTelegram>;
  let ctx: BotContext;

  beforeAll(async () => {
    testDb = await createTestDb();
  });
  afterAll(async () => {
    await testDb.close();
  });
  beforeEach(() => {
    telegram = fakeTelegram();
    ctx = {
      db: testDb.db,
      telegram,
      photos: new BotPhotos(testDb.db, async () => new Uint8Array([1])),
      siteUrl: SITE,
      logger,
    };
  });

  const threadsOf = (chatId: number) =>
    testDb.db.select().from(schema.supportThreads).where(eq(schema.supportThreads.chatId, chatId));
  const messagesOf = (threadId: string) =>
    testDb.db
      .select()
      .from(schema.supportMessages)
      .where(eq(schema.supportMessages.threadId, threadId))
      .orderBy(schema.supportMessages.createdAt);
  const lastText = () => telegram.sendMessage.mock.calls.at(-1)![1];

  describe('support conversation', () => {
    it('«💬 Поддержка» → a message opens a thread; more messages join it; repeats are dropped', async () => {
      await handleUpdate(ctx, msg(5001, { text: '💬 Поддержка' }));
      expect(lastText()).toBe(supportTexts.prompt);
      expect(await threadsOf(5001)).toHaveLength(0);

      await handleUpdate(ctx, msg(5001, { message_id: 1, text: 'Не грузится задание 5' }));
      expect(lastText()).toBe(supportTexts.received);
      const [thread] = await threadsOf(5001);
      expect(thread).toMatchObject({ status: 'open', openedBy: 'user' });

      const photo = msg(5001, {
        message_id: 2,
        caption: 'вот скрин',
        photo: [
          { file_id: 'small', width: 90, height: 60 },
          { file_id: 'BIG', width: 1280, height: 720 },
        ],
      });
      await handleUpdate(ctx, photo);
      expect(lastText()).toBe(supportTexts.appended);
      // Telegram delivers the same update again: stored once, no second «добавлено».
      const before = telegram.sendMessage.mock.calls.length;
      await handleUpdate(ctx, { ...photo, update_id: updateId++ });
      expect(telegram.sendMessage.mock.calls.length).toBe(before);

      const messages = await messagesOf(thread!.id);
      expect(messages.map((m) => [m.direction, m.text])).toEqual([
        ['user', 'Не грузится задание 5'],
        ['user', 'вот скрин'],
      ]);
      expect(messages[1]!.attachments).toEqual([{ kind: 'photo', fileId: 'BIG' }]);
      // The owner gets one notification for the unread conversation.
      const outbox = await testDb.db
        .select()
        .from(schema.telegramOutbox)
        .where(eq(schema.telegramOutbox.kind, 'support'));
      expect(outbox).toHaveLength(1);
    });

    it('commands and the menu button are never taken as support messages', async () => {
      await handleUpdate(ctx, msg(5002, { text: '💬 Поддержка' }));
      await handleUpdate(ctx, msg(5002, { text: '/help' }));
      await handleUpdate(ctx, msg(5002, { text: '📚 Меню' }));
      expect(await threadsOf(5002)).toHaveLength(0);
    });

    it('without «Поддержка» a plain message gets the usual reply, nothing is stored', async () => {
      await handleUpdate(ctx, msg(5003, { text: 'привет' }));
      expect(lastText()).toContain('💬 Поддержка');
      expect(await threadsOf(5003)).toHaveLength(0);
    });

    it('voice notes and stickers are refused politely during support', async () => {
      await handleUpdate(ctx, msg(5004, { text: '/support' }));
      await handleUpdate(ctx, msg(5004, { message_id: 1, text: 'вопрос' }));
      await handleUpdate(ctx, msg(5004, { message_id: 2, voice: { file_id: 'v' } }));
      expect(lastText()).toBe(supportTexts.unsupported);
      const [thread] = await threadsOf(5004);
      expect(await messagesOf(thread!.id)).toHaveLength(1);
    });

    it('«Завершить обращение» closes it; the next message after «Поддержка» opens a new one', async () => {
      await handleUpdate(ctx, msg(5005, { text: '💬 Поддержка' }));
      await handleUpdate(ctx, msg(5005, { message_id: 1, text: 'первый вопрос' }));
      await handleUpdate(ctx, tap(5005, 'support_close'));
      expect(lastText()).toBe(supportTexts.closedByUser);
      await handleUpdate(ctx, msg(5005, { message_id: 2, text: 'ещё вопрос' }));
      expect(lastText()).not.toBe(supportTexts.received); // not support any more
      await handleUpdate(ctx, msg(5005, { text: '💬 Поддержка' }));
      await handleUpdate(ctx, msg(5005, { message_id: 3, text: 'второй вопрос' }));
      const threads = await threadsOf(5005);
      expect(threads.map((t) => t.status).sort()).toEqual(['closed', 'open']);
    });
  });

  describe('admin replies (SupportSender)', () => {
    async function queuedReply(chatId: number, text = 'Ответ') {
      const [thread] = await testDb.db
        .insert(schema.supportThreads)
        .values({ chatId, status: 'open' })
        .onConflictDoNothing()
        .returning();
      const t =
        thread ??
        (
          await testDb.db
            .select()
            .from(schema.supportThreads)
            .where(
              and(
                eq(schema.supportThreads.chatId, chatId),
                eq(schema.supportThreads.status, 'open'),
              ),
            )
        )[0]!;
      const [m] = await testDb.db
        .insert(schema.supportMessages)
        .values({
          threadId: t.id,
          chatId,
          direction: 'admin',
          text,
          deliveryStatus: 'pending',
          nextAttemptAt: new Date(0),
        })
        .returning();
      return m!;
    }
    const statusOf = async (id: string) =>
      (
        await testDb.db
          .select()
          .from(schema.supportMessages)
          .where(eq(schema.supportMessages.id, id))
      )[0]!;

    it('sends the reply to that user once, with a header; plain text only', async () => {
      const m = await queuedReply(6001, '<b>не HTML</b> ответ');
      const sender = new SupportSender({ db: testDb.db, telegram, logger });
      await sender.process();
      await sender.process();
      expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
      const [chatId, text, options] = telegram.sendMessage.mock.calls[0]!;
      expect(chatId).toBe(6001);
      expect(text).toBe(`${supportTexts.replyPrefix}\n\n<b>не HTML</b> ответ`);
      expect((options as { parseMode?: string }).parseMode).toBeUndefined();
      expect((await statusOf(m.id)).deliveryStatus).toBe('sent');
    });

    it('a Telegram outage keeps the reply and retries; «maybe shown» is never resent', async () => {
      const m = await queuedReply(6002);
      let now = new Date('2026-10-24T10:00:00Z');
      const sender = new SupportSender({ db: testDb.db, telegram, logger, now: () => now });
      telegram.sendMessage.mockRejectedValueOnce(
        new TelegramApiError('sendMessage', 'network', null, 'down', null, {
          code: 'ECONNREFUSED',
          timeout: false,
          maybeDelivered: false,
        }),
      );
      await sender.process();
      expect((await statusOf(m.id)).deliveryStatus).toBe('pending');
      await sender.process(); // too early: waits
      expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
      now = new Date(now.getTime() + 60_000);
      await sender.process();
      expect((await statusOf(m.id)).deliveryStatus).toBe('sent');

      const m2 = await queuedReply(6003);
      telegram.sendMessage.mockRejectedValueOnce(
        new TelegramApiError('sendMessage', 'network', null, 'timeout', null, {
          code: 'UND_ERR_HEADERS_TIMEOUT',
          timeout: true,
          maybeDelivered: true,
        }),
      );
      await sender.process();
      expect((await statusOf(m2.id)).deliveryStatus).toBe('uncertain');
    });

    it('a blocked bot fails honestly and marks the chat', async () => {
      await testDb.db.insert(schema.telegramBotChats).values({ chatId: 6004 });
      const m = await queuedReply(6004);
      telegram.sendMessage.mockRejectedValueOnce(
        new TelegramApiError('sendMessage', 'unreachable', 403, 'bot was blocked by the user'),
      );
      await new SupportSender({ db: testDb.db, telegram, logger }).process();
      expect(await statusOf(m.id)).toMatchObject({
        deliveryStatus: 'failed',
        lastError: 'blocked',
      });
      const [chat] = await testDb.db
        .select()
        .from(schema.telegramBotChats)
        .where(eq(schema.telegramBotChats.chatId, 6004));
      expect(chat!.blockedAt).not.toBeNull();
    });

    it('a crash mid-send is recovered as «uncertain», never resent', async () => {
      const m = await queuedReply(6005);
      await testDb.db
        .update(schema.supportMessages)
        .set({ deliveryStatus: 'sending' })
        .where(eq(schema.supportMessages.id, m.id));
      const sender = new SupportSender({ db: testDb.db, telegram, logger });
      expect(await sender.recoverInterrupted()).toBeGreaterThanOrEqual(1);
      await sender.process();
      expect(telegram.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('linking Telegram through /start link_<token>', () => {
    it('links the sender, once; a repeated link says it is used', async () => {
      const [user] = await testDb.db.insert(schema.users).values({}).returning();
      const { token } = await createTelegramLinkToken(testDb.db, user!.id);
      await handleUpdate(ctx, msg(7001, { text: `/start link_${token}` }));
      expect(lastText()).toContain('Telegram привязан');
      await handleUpdate(ctx, msg(7001, { text: `/start link_${token}` }));
      expect(lastText()).toContain('уже использована');
      const [chat] = await testDb.db
        .select()
        .from(schema.telegramBotChats)
        .where(eq(schema.telegramBotChats.chatId, 7001));
      expect(chat!.userId).toBe(user!.id);
    });
  });

  describe('daily reminders (ReminderScheduler)', () => {
    async function subscriber(chatId: number, time: number, timezone: string, enabled = true) {
      const [user] = await testDb.db.insert(schema.users).values({}).returning();
      await testDb.db
        .insert(schema.authIdentities)
        .values({ userId: user!.id, provider: 'telegram', providerUserId: String(chatId) });
      await testDb.db
        .insert(schema.telegramBotChats)
        .values({ chatId, userId: user!.id })
        .onConflictDoNothing();
      await testDb.db
        .insert(schema.reminderSettings)
        .values({ userId: user!.id, enabled, minuteOfDay: time, timezone });
      return user!.id;
    }
    const sentTo = () => telegram.sendMessage.mock.calls.map((c) => c[0]);

    it('at the chosen local time, in the user’s timezone, once a day — even across runs and restarts', async () => {
      await testDb.db.delete(schema.reminderSettings);
      // 09:00 in Moscow (UTC+3) and 09:00 in Novosibirsk (UTC+7).
      await subscriber(8001, 9 * 60, 'Europe/Moscow');
      await subscriber(8002, 9 * 60, 'Asia/Novosibirsk');
      let now = new Date('2026-10-24T02:30:00Z'); // 05:30 MSK, 09:30 NSK
      const make = () =>
        new ReminderScheduler({ db: testDb.db, telegram, logger, siteUrl: SITE, now: () => now });
      await make().run();
      expect(sentTo()).toEqual([8002]);
      const [, text, options] = telegram.sendMessage.mock.calls[0]!;
      expect(text).toBe(reminderText);
      const buttons = (
        options as {
          replyMarkup: { inline_keyboard: { text: string; callback_data?: string }[][] };
        }
      ).replyMarkup.inline_keyboard.flat();
      expect(buttons.map((b) => b.text)).toEqual(['Начать тренировку', 'Отключить напоминания']);

      now = new Date('2026-10-24T06:05:00Z'); // 09:05 MSK
      await make().run();
      await make().run(); // the same minute again / a restarted worker
      expect(sentTo()).toEqual([8002, 8001]);

      now = new Date('2026-10-25T06:01:00Z'); // the next day
      await make().run();
      expect(sentTo()).toEqual([8002, 8001, 8001]);
    });

    it('not to someone who switched it off, never started the bot, or blocked it; not hours late', async () => {
      await testDb.db.delete(schema.reminderSettings);
      await subscriber(8101, 600, 'Europe/Moscow', false); // off
      const notStarted = await subscriber(8102, 600, 'Europe/Moscow');
      await testDb.db
        .delete(schema.telegramBotChats)
        .where(eq(schema.telegramBotChats.chatId, 8102));
      await subscriber(8103, 600, 'Europe/Moscow');
      await testDb.db
        .update(schema.telegramBotChats)
        .set({ blockedAt: new Date() })
        .where(eq(schema.telegramBotChats.chatId, 8103));
      await subscriber(8104, 600, 'Europe/Moscow'); // reachable, but checked 3 h late
      const scheduler = new ReminderScheduler({
        db: testDb.db,
        telegram,
        logger,
        siteUrl: SITE,
        now: () => new Date('2026-10-24T10:00:00Z'), // 13:00 MSK, due 10:00
      });
      await scheduler.run();
      expect(telegram.sendMessage).not.toHaveBeenCalled();
      expect(notStarted).toBeTruthy();
    });

    it('«Отключить напоминания» in the chat turns them off', async () => {
      await testDb.db.delete(schema.reminderSettings);
      const userId = await subscriber(8201, 600, 'Europe/Moscow');
      await handleUpdate(ctx, tap(8201, 'reminders_off'));
      expect(lastText()).toContain('Напоминания отключены');
      const [row] = await testDb.db
        .select()
        .from(schema.reminderSettings)
        .where(eq(schema.reminderSettings.userId, userId));
      expect(row!.enabled).toBe(false);
    });

    it('a failed send is retried within the window; a blocked bot stops it', async () => {
      await testDb.db.delete(schema.reminderSettings);
      await subscriber(8301, 600, 'Europe/Moscow');
      await subscriber(8302, 600, 'Europe/Moscow');
      let now = new Date('2026-10-24T07:00:00Z'); // 10:00 MSK
      const scheduler = new ReminderScheduler({
        db: testDb.db,
        telegram,
        logger,
        siteUrl: SITE,
        now: () => now,
      });
      telegram.sendMessage.mockImplementation(async (chatId: number) => {
        if (chatId === 8301) {
          throw new TelegramApiError('sendMessage', 'network', null, 'down', null, {
            code: 'ECONNREFUSED',
            timeout: false,
            maybeDelivered: false,
          });
        }
        throw new TelegramApiError(
          'sendMessage',
          'unreachable',
          403,
          'bot was blocked by the user',
        );
      });
      await scheduler.run();
      telegram.sendMessage.mockReset();
      telegram.sendMessage.mockImplementation(async (chatId: number) => ({
        message_id: messageId++,
        chat: { id: chatId, type: 'private' as const },
      }));
      now = new Date(now.getTime() + 2 * 60_000);
      await scheduler.run();
      expect(sentTo()).toEqual([8301]);
      const rows = await testDb.db.select().from(schema.reminderDeliveries);
      const byChat = Object.fromEntries(rows.map((r) => [r.chatId, r.status]));
      expect(byChat[8301]).toBe('sent');
      expect(byChat[8302]).toBe('unreachable');
    });
  });
});
