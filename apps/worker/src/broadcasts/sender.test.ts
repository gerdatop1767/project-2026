import { schema } from '@zybrilka/db';
import { createTestDb } from '@zybrilka/db/testing';
import { and, eq } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TelegramApiError, type TelegramClient, type TelegramMessage } from '../telegram/client.js';
import { BroadcastSender } from './sender.js';

const logger = pino({ enabled: false });
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000100000001008020000009091683600000000',
  'hex',
);

let messageId = 1;
const reply = (chatId: number, photo = false): TelegramMessage => ({
  message_id: messageId++,
  chat: { id: chatId, type: 'private' },
  ...(photo ? { photo: [{ file_id: `PHOTO-${messageId}`, width: 16, height: 16 }] } : {}),
});

function fakeTelegram() {
  const t = {
    getMe: vi.fn(),
    getUpdates: vi.fn(),
    sendMessage: vi.fn(async (chatId: number, _text: string, _o?: unknown) => reply(chatId)),
    sendPhoto: vi.fn(async (chatId: number, _p: unknown, _c?: string, _o?: unknown) =>
      reply(chatId, true),
    ),
    sendMediaGroup: vi.fn(async (chatId: number, photos: unknown[]) =>
      photos.map(() => reply(chatId, true)),
    ),
    answerCallbackQuery: vi.fn(),
  };
  return t as typeof t & TelegramClient;
}

describe('BroadcastSender', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  let author: string;
  let telegram: ReturnType<typeof fakeTelegram>;
  let sleeps: number[];
  let sender: BroadcastSender;
  const CHATS = [101, 102, 103, 104];

  beforeAll(async () => {
    testDb = await createTestDb();
    const [u] = await testDb.db.insert(schema.users).values({}).returning();
    author = u!.id;
  });
  afterAll(async () => {
    await testDb.close();
  });
  beforeEach(async () => {
    await testDb.db.delete(schema.broadcastDeliveries);
    await testDb.db.delete(schema.broadcastAttachments);
    await testDb.db.delete(schema.broadcasts);
    await testDb.db.delete(schema.telegramBotChats);
    await testDb.db.insert(schema.telegramBotChats).values([
      ...CHATS.map((chatId) => ({ chatId })),
      { chatId: 999, blockedAt: new Date() }, // blocked earlier: never contacted
    ]);
    telegram = fakeTelegram();
    sleeps = [];
    sender = new BroadcastSender({
      db: testDb.db,
      telegram,
      logger,
      adminChats: async () => [5000],
      sleep: async (ms) => void sleeps.push(ms),
    });
  });

  const create = async (values: Partial<typeof schema.broadcasts.$inferInsert> = {}) =>
    (
      await testDb.db
        .insert(schema.broadcasts)
        .values({
          authorUserId: author,
          text: '<b>Новое</b> в Зубрилке',
          status: 'sending',
          confirmedAt: new Date(),
          ...values,
        })
        .returning()
    )[0]!;
  const load = async (id: string) =>
    (await testDb.db.select().from(schema.broadcasts).where(eq(schema.broadcasts.id, id)))[0]!;
  const recipients = () => telegram.sendMessage.mock.calls.map((c) => c[0]).sort();

  it('a draft or an unconfirmed broadcast sends nothing', async () => {
    await create({ status: 'draft' });
    await create({ status: 'awaiting_confirmation' });
    await create({ status: 'cancelled' });
    expect(await sender.processBroadcasts()).toBe(0);
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(await testDb.db.select().from(schema.broadcastDeliveries)).toHaveLength(0);
  });

  it('sends once to every chat that started the bot and did not block it', async () => {
    const b = await create();
    await sender.processBroadcasts();
    expect(recipients()).toEqual(CHATS);
    expect(telegram.sendMessage.mock.calls[0]![1]).toBe('<b>Новое</b> в Зубрилке');
    expect(await load(b.id)).toMatchObject({
      status: 'completed',
      recipientsTotal: 4,
      sentCount: 4,
      failedCount: 0,
      blockedCount: 0,
    });
    // Running again (or after a restart) sends nothing more.
    await sender.processBroadcasts();
    expect(telegram.sendMessage).toHaveBeenCalledTimes(4);
    expect(sleeps.every((ms) => ms === 50)).toBe(true); // ~20 messages/second
  });

  it('counts successes and failures truthfully and marks chats that blocked the bot', async () => {
    telegram.sendMessage.mockImplementation(async (chatId: number) => {
      if (chatId === 102) {
        throw new TelegramApiError(
          'sendMessage',
          'unreachable',
          403,
          'Forbidden: bot was blocked by the user',
        );
      }
      if (chatId === 103) throw new TelegramApiError('sendMessage', 'rejected', 400, 'Bad Request');
      return reply(chatId);
    });
    const b = await create();
    await sender.processBroadcasts();
    expect(await load(b.id)).toMatchObject({
      status: 'completed_with_errors',
      sentCount: 2,
      failedCount: 1,
      blockedCount: 1,
    });
    const rows = await testDb.db
      .select()
      .from(schema.broadcastDeliveries)
      .where(eq(schema.broadcastDeliveries.broadcastId, b.id));
    expect(Object.fromEntries(rows.map((r) => [r.chatId, r.status]))).toEqual({
      101: 'sent',
      102: 'blocked',
      103: 'failed',
      104: 'sent',
    });
    const [blocked] = await testDb.db
      .select()
      .from(schema.telegramBotChats)
      .where(eq(schema.telegramBotChats.chatId, 102));
    expect(blocked!.blockedAt).not.toBeNull();
  });

  it('on HTTP 429 waits retry_after and retries the same chat — not counted as a failure', async () => {
    telegram.sendMessage.mockRejectedValueOnce(
      new TelegramApiError('sendMessage', 'rate_limited', 429, 'Too Many Requests', 7),
    );
    const b = await create();
    await sender.processBroadcasts();
    expect(sleeps).toContain(7000);
    expect(await load(b.id)).toMatchObject({ status: 'completed', sentCount: 4, failedCount: 0 });
    expect(telegram.sendMessage).toHaveBeenCalledTimes(5);
  });

  it('a stopped broadcast starts no new sends', async () => {
    const b = await create();
    telegram.sendMessage.mockImplementation(async (chatId: number) => {
      // The owner presses «Остановить» right after the first message.
      await testDb.db
        .update(schema.broadcasts)
        .set({ status: 'cancelled' })
        .where(eq(schema.broadcasts.id, b.id));
      return reply(chatId);
    });
    await sender.processBroadcasts();
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    const after = await load(b.id);
    expect(after).toMatchObject({ status: 'cancelled', sentCount: 1 });
    await sender.processBroadcasts();
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('after a crash mid-send, the interrupted chat is not sent again; the rest still are', async () => {
    const b = await create();
    // Simulate the state a crash leaves: audience snapshotted, one sent,
    // one in flight (unknown whether Telegram delivered it).
    await testDb.db
      .update(schema.broadcasts)
      .set({ recipientsTotal: 4, sentCount: 1 })
      .where(eq(schema.broadcasts.id, b.id));
    await testDb.db.insert(schema.broadcastDeliveries).values([
      { broadcastId: b.id, chatId: 101, status: 'sent' },
      { broadcastId: b.id, chatId: 102, status: 'in_flight' },
      { broadcastId: b.id, chatId: 103 },
      { broadcastId: b.id, chatId: 104 },
    ]);
    expect(await sender.recoverInterrupted()).toBe(1);
    await sender.processBroadcasts();
    expect(recipients()).toEqual([103, 104]);
    const [interrupted] = await testDb.db
      .select()
      .from(schema.broadcastDeliveries)
      .where(
        and(
          eq(schema.broadcastDeliveries.broadcastId, b.id),
          eq(schema.broadcastDeliveries.chatId, 102),
        ),
      );
    expect(interrupted).toMatchObject({ status: 'failed', errorCode: 'interrupted' });
    expect(await load(b.id)).toMatchObject({
      status: 'completed_with_errors',
      sentCount: 3,
      failedCount: 1,
    });
  });

  it('an image with a caption is uploaded once, then sent by Telegram file_id', async () => {
    const b = await create({ mediaMode: 'caption' });
    await testDb.db.insert(schema.broadcastAttachments).values({
      broadcastId: b.id,
      position: 1,
      contentType: 'image/png',
      data: PNG,
      sizeBytes: PNG.length,
      width: 16,
      height: 16,
    });
    await sender.processBroadcasts();
    expect(telegram.sendPhoto).toHaveBeenCalledTimes(4);
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    const photos = telegram.sendPhoto.mock.calls.map(
      (c) => c[1] as { fileId?: string; bytes?: unknown },
    );
    expect(photos[0]!.bytes).toBeDefined();
    expect(photos.slice(1).every((p) => typeof p.fileId === 'string')).toBe(true);
    expect(telegram.sendPhoto.mock.calls[0]![2]).toBe('<b>Новое</b> в Зубрилке');
  });

  it('several images keep their order; the text goes separately when asked', async () => {
    const b = await create({ mediaMode: 'separate' });
    for (const position of [1, 2, 3]) {
      await testDb.db.insert(schema.broadcastAttachments).values({
        broadcastId: b.id,
        position,
        contentType: 'image/png',
        data: Buffer.concat([PNG, Buffer.from([position])]),
        sizeBytes: PNG.length + 1,
        width: 16,
        height: 16,
      });
    }
    await sender.processBroadcasts();
    const album = telegram.sendMediaGroup.mock.calls[0]![1] as {
      photo: { filename: string };
      caption?: string;
    }[];
    expect(album.map((p) => p.photo.filename)).toEqual([
      'image-1.png',
      'image-2.png',
      'image-3.png',
    ]);
    expect(album.every((p) => !p.caption)).toBe(true);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(4);
  });

  it('«Отправить себе» goes to the owners only and never to the audience', async () => {
    const b = await create({ status: 'draft', testStatus: 'pending', testRequestedAt: new Date() });
    await sender.processTests();
    expect(recipients()).toEqual([5000]);
    expect((await load(b.id)).testStatus).toBe('sent');
    await sender.processTests();
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
  });
});
