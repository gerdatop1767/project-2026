import { schema } from '@zybrilka/db';
import { createTestDb } from '@zybrilka/db/testing';
import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TelegramApiError,
  type TelegramClient,
  type TelegramMessage,
  type TelegramUpdate,
} from '../telegram/client.js';
import { handleUpdate, type BotContext } from './handleUpdate.js';
import { iosGuideCaption, welcomeCaption } from './messages.js';
import { BotPhotos } from './photos.js';
import { loadOffset, startPolling } from './polling.js';

const SITE = 'https://zybrilka.ru';
const logger = pino({ enabled: false });

let nextMessageId = 1;
const sentMessage = (chatId: number, photo = false): TelegramMessage => ({
  message_id: nextMessageId++,
  chat: { id: chatId, type: 'private' },
  ...(photo
    ? {
        photo: [
          { file_id: 'small', width: 90, height: 50 },
          { file_id: `FILE-${nextMessageId}`, width: 1280, height: 720 },
        ],
      }
    : {}),
});

function fakeTelegram() {
  const t = {
    getMe: vi.fn(),
    getUpdates: vi.fn(async () => [] as TelegramUpdate[]),
    sendMessage: vi.fn(async (chatId: number, _text: string, _options?: unknown) =>
      sentMessage(chatId),
    ),
    sendPhoto: vi.fn(
      async (chatId: number, _photo: unknown, _caption?: string, _options?: unknown) =>
        sentMessage(chatId, true),
    ),
    sendMediaGroup: vi.fn(),
    answerCallbackQuery: vi.fn(async () => true as const),
  };
  return t as typeof t & TelegramClient;
}

let updateId = 1;
const start = (
  from: number,
  text = '/start',
  type: 'private' | 'group' = 'private',
): TelegramUpdate => ({
  update_id: updateId++,
  message: {
    message_id: 1,
    chat: { id: type === 'private' ? from : -100, type },
    from: { id: from },
    text,
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

describe('Telegram bot', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let telegram: ReturnType<typeof fakeTelegram>;
  let ctx: BotContext;
  const readAsset = vi.fn(async (name: string) => new TextEncoder().encode(`image:${name}`));

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
      photos: new BotPhotos(testDb.db, readAsset),
      siteUrl: SITE,
      logger,
    };
  });

  const chatRow = async (chatId: number) =>
    (
      await testDb.db
        .select()
        .from(schema.telegramBotChats)
        .where(eq(schema.telegramBotChats.chatId, chatId))
    )[0];

  it('greets a new user with the welcome image, text and both buttons', async () => {
    await handleUpdate(ctx, start(1001));
    expect(telegram.sendPhoto).toHaveBeenCalledTimes(1);
    const [chatId, photo, caption, options] = telegram.sendPhoto.mock.calls[0] as unknown as [
      number,
      { filename: string },
      string,
      {
        parseMode: string;
        replyMarkup: {
          inline_keyboard: { text: string; web_app?: { url: string }; callback_data?: string }[][];
        };
      },
    ];
    expect(chatId).toBe(1001);
    expect(photo.filename).toBe('welcome.png');
    expect(caption).toBe(welcomeCaption);
    expect(caption).toMatch(/бесплатно/i);
    expect(options.parseMode).toBe('HTML');
    const buttons = options.replyMarkup.inline_keyboard.flat();
    expect(buttons[0]).toEqual({ text: 'Открыть Зубрилку', web_app: { url: SITE } });
    expect(buttons[1]).toEqual({ text: 'Скачать приложение на iOS', callback_data: 'ios_guide' });
    expect(await chatRow(1001)).toMatchObject({ chatId: 1001, startCount: 1, userId: null });
  });

  it('a repeated /start does not register again: one row, a short welcome back', async () => {
    await handleUpdate(ctx, start(1002));
    await handleUpdate(ctx, start(1002));
    await handleUpdate(ctx, start(1002, '/start campaign_x'));
    const rows = await testDb.db
      .select()
      .from(schema.telegramBotChats)
      .where(eq(schema.telegramBotChats.chatId, 1002));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.startCount).toBe(3);
    expect(telegram.sendPhoto).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(2);
    expect(telegram.sendMessage.mock.calls[0]![1]).toContain('С возвращением');
    // No account is created by the bot.
    expect(await testDb.db.select().from(schema.users)).toHaveLength(0);
  });

  it('links the chat to an existing account that signed in with this Telegram user', async () => {
    const [user] = await testDb.db.insert(schema.users).values({}).returning();
    await testDb.db
      .insert(schema.authIdentities)
      .values({ userId: user!.id, provider: 'telegram', providerUserId: '1003' });
    await handleUpdate(ctx, start(1003));
    expect((await chatRow(1003))!.userId).toBe(user!.id);
    expect(await testDb.db.select().from(schema.users)).toHaveLength(1);
  });

  it('the iOS button sends the step-by-step guide with its image and a plain site link', async () => {
    await handleUpdate(ctx, tap(1004, 'ios_guide'));
    expect(telegram.answerCallbackQuery).toHaveBeenCalledTimes(1);
    const [chatId, photo, caption, options] = telegram.sendPhoto.mock.calls[0] as unknown as [
      number,
      { filename: string },
      string,
      { replyMarkup: { inline_keyboard: { text: string; url?: string }[][] } },
    ];
    expect(chatId).toBe(1004);
    expect(photo.filename).toBe('ios-install.png');
    expect(caption).toBe(iosGuideCaption(SITE));
    for (const step of ['Safari', '«Поделиться»', 'На экран „Домой“', '«Добавить»', 'иконки']) {
      expect(caption).toContain(step);
    }
    expect(caption).toContain('App Store нет');
    expect(caption.length).toBeLessThanOrEqual(1024);
    expect(options.replyMarkup.inline_keyboard[0]![0]).toEqual({ text: 'Открыть сайт', url: SITE });
  });

  it('uploads each image once, then reuses Telegram’s file_id', async () => {
    const photos = new BotPhotos(testDb.db, readAsset);
    const c = { ...ctx, photos };
    await handleUpdate(c, tap(1005, 'ios_guide'));
    await handleUpdate(c, tap(1006, 'ios_guide'));
    const second = telegram.sendPhoto.mock.calls[1]![1] as { fileId?: string };
    expect(second.fileId).toMatch(/^FILE-/);
    // …and after a restart (a fresh cache) it is read back from the database.
    const afterRestart = { ...ctx, photos: new BotPhotos(testDb.db, readAsset) };
    await handleUpdate(afterRestart, tap(1007, 'ios_guide'));
    expect((telegram.sendPhoto.mock.calls[2]![1] as { fileId?: string }).fileId).toBe(
      second.fileId,
    );
  });

  it('sends the real bundled PNGs from apps/worker/assets', async () => {
    const photos = new BotPhotos(undefined);
    for (const image of ['welcome', 'iosGuide'] as const) {
      await photos.send(telegram, 1, image, 'x', {});
    }
    for (const call of telegram.sendPhoto.mock.calls) {
      const bytes = (call[1] as { bytes: Uint8Array }).bytes;
      // PNG signature: \x89 P N G
      expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      expect(bytes.length).toBeGreaterThan(50_000);
    }
  });

  it('answers an unknown command and plain text, and ignores group chats', async () => {
    await handleUpdate(ctx, start(1008, '/settings'));
    expect(telegram.sendMessage.mock.calls[0]![1]).toContain('Такой команды я не знаю');
    await handleUpdate(ctx, start(1008, 'привет'));
    expect(telegram.sendMessage.mock.calls[1]![1]).toContain('Сообщить об ошибке');
    await handleUpdate(ctx, start(1009, '/start', 'group'));
    expect(telegram.sendMessage).toHaveBeenCalledTimes(2);
    expect(await chatRow(-100)).toBeUndefined();
  });

  it('an http site (development) gets a plain link instead of the Mini App button', async () => {
    await handleUpdate({ ...ctx, siteUrl: 'http://localhost:5173' }, start(1010));
    const options = telegram.sendPhoto.mock.calls[0]![3] as {
      replyMarkup: { inline_keyboard: { url?: string; web_app?: unknown }[][] };
    };
    expect(options.replyMarkup.inline_keyboard[0]![0]).toEqual({
      text: 'Открыть Зубрилку',
      url: 'http://localhost:5173',
    });
  });

  describe('polling', () => {
    it('handles every update, survives a Telegram error, saves the offset, logs no token or text', async () => {
      const lines: string[] = [];
      const log = pino({ level: 'debug' }, { write: (l: string) => void lines.push(l) });
      let call = 0;
      telegram.getUpdates.mockImplementation(async () => {
        call++;
        if (call === 1) {
          throw new TelegramApiError('getUpdates', 'network', null, 'timeout');
        }
        if (call === 2) return [start(2001, '/start'), start(2002, 'секретный текст пользователя')];
        await new Promise((r) => setTimeout(r, 5));
        return [];
      });
      telegram.sendPhoto.mockRejectedValueOnce(
        new TelegramApiError(
          'sendPhoto',
          'unreachable',
          403,
          'Forbidden: bot was blocked by the user',
        ),
      );
      const poller = startPolling({
        db: testDb.db,
        telegram,
        logger: log,
        handle: (u) => handleUpdate({ ...ctx, logger: log }, u),
        backoffMs: () => 1,
      });
      await vi.waitFor(async () => expect(await loadOffset(testDb.db)).toBeGreaterThan(0));
      await poller.stop();
      // The failing first update did not stop the second one.
      expect(telegram.sendMessage).toHaveBeenCalledWith(
        2002,
        expect.stringContaining('бот Зубрилки'),
      );
      const all = lines.join('\n');
      expect(all).toContain('telegram update failed');
      expect(all).not.toContain('секретный текст');
      expect(all).not.toMatch(/\d+:[A-Za-z0-9_-]{10,}/); // nothing token-shaped
    });

    it('stops for good when the token is rejected', async () => {
      telegram.getUpdates.mockRejectedValue(
        new TelegramApiError('getUpdates', 'unauthorized', 401, 'Unauthorized'),
      );
      const poller = startPolling({ db: testDb.db, telegram, logger, handle: async () => {} });
      await vi.waitFor(() => expect(telegram.getUpdates).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 20));
      expect(telegram.getUpdates).toHaveBeenCalledTimes(1);
      await poller.stop();
    });
  });
});
