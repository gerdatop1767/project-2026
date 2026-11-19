import { schema, syncTaskSkills } from '@zybrilka/db';
import { createFullContentTestDb } from '@zybrilka/db/testing';
import { YASHCHENKO_2027_PROJECT_SOURCE } from '@zybrilka/shared';
import { and, eq, ne } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleUpdate } from '../bot/handleUpdate.js';
import { BotPhotos } from '../bot/photos.js';
import { TelegramApiError, type TelegramClient, type TelegramMessage } from '../telegram/client.js';
import { ProgressNotifier } from './progress.js';

const SITE = 'https://zybrilka.ru';
const logger = pino({ enabled: false });
const DAY = 86_400_000;
/** 16 Nov 2026, 17:00 MSK. */
const NOW = new Date('2026-11-16T14:00:00Z');
const TODAY = '2026-11-16';
const SKILL = 'math.equations-simple';

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

function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describe('progress notifications (Telegram)', () => {
  let testDb: Awaited<ReturnType<typeof createFullContentTestDb>>;
  let telegram: ReturnType<typeof fakeTelegram>;
  let tasks6: { id: string }[];
  let chat = 7000;
  let now = NOW;

  beforeAll(async () => {
    testDb = await createFullContentTestDb();
    await syncTaskSkills(testDb.db);
    tasks6 = await testDb.db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.subjectId, 'math'),
          eq(schema.tasks.taskNumber, 6),
          eq(schema.tasks.status, 'published'),
          ne(schema.tasks.source, YASHCHENKO_2027_PROJECT_SOURCE),
        ),
      );
  }, 120_000);
  afterAll(async () => {
    await testDb.close();
  });
  beforeEach(async () => {
    telegram = fakeTelegram();
    now = NOW;
    await testDb.db.update(schema.telegramBotChats).set({ blockedAt: new Date() });
  });

  const notifier = () =>
    new ProgressNotifier({
      db: testDb.db,
      telegram,
      logger,
      siteUrl: SITE,
      now: () => now,
      sleep: async () => {},
    });
  const texts = () => telegram.sendMessage.mock.calls.map((c) => c[1]);

  async function student() {
    const chatId = ++chat;
    const [u] = await testDb.db.insert(schema.users).values({}).returning();
    await testDb.db
      .insert(schema.authIdentities)
      .values({ userId: u!.id, provider: 'telegram', providerUserId: String(chatId) });
    await testDb.db.insert(schema.telegramBotChats).values({ chatId, userId: u!.id });
    return { userId: u!.id, chatId };
  }

  /** A week plan of №6 starting `startOffset` days from today. */
  async function weekPlan(userId: string, startOffset = 0, accuracy: number | null = 40) {
    const start = addDays(TODAY, startOffset);
    const [plan] = await testDb.db
      .insert(schema.learningPlans)
      .values({
        userId,
        subjectId: 'math',
        kind: 'week',
        startDate: start,
        timezone: 'Europe/Moscow',
        focus: [
          {
            skillKey: SKILL,
            subjectId: 'math',
            title: 'Простейшие уравнения',
            examNumber: 6,
            problem: 'computational',
            mastery: 40,
            accuracy,
            attempts: 6,
            availableTasks: 35,
          },
        ],
        createdAt: new Date(now.getTime() - 30 * DAY),
        updatedAt: now,
      })
      .returning();
    await testDb.db.insert(schema.learningPlanDays).values(
      Array.from({ length: 7 }, (_, i) => ({
        planId: plan!.id,
        dayIndex: i,
        date: addDays(start, i),
        skillKey: SKILL,
        activity: i === 6 ? 'progress_check' : 'practice',
        targetTasks: 3,
        difficulty: 2,
      })),
    );
    return plan!;
  }
  async function answers(userId: string, at: Date, results: boolean[], offset = 0) {
    await testDb.db.insert(schema.attempts).values(
      results.map((isCorrect, i) => ({
        userId,
        taskId: tasks6[(offset + i) % tasks6.length]!.id,
        answerRaw: 'x',
        isCorrect,
        createdAt: new Date(at.getTime() + i * 60_000),
      })),
    );
  }

  it('«Сегодня по плану»: once a day, after 16:00 local, never twice, with the task count', async () => {
    const s = await student();
    await weekPlan(s.userId, -1);
    now = new Date('2026-11-16T10:00:00Z'); // 13:00 MSK — too early for the reminder
    await notifier().run();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    now = NOW;
    await notifier().run();
    await notifier().run();
    await Promise.all([notifier().run(), notifier().run()]);
    expect(texts()).toEqual([
      '📚 Сегодня по твоему плану — тренировка по теме «Простейшие уравнения». Нужно решить 3 задания.',
    ]);
    const options = telegram.sendMessage.mock.calls[0]![2] as {
      replyMarkup: { inline_keyboard: { text: string }[][] };
    };
    expect(options.replyMarkup.inline_keyboard.flat().map((b) => b.text)).toEqual([
      'Открыть план',
      'Не присылать о прогрессе',
    ]);
  });

  it('a day already done gets no reminder; not at night', async () => {
    const s = await student();
    await weekPlan(s.userId, -1);
    await answers(s.userId, new Date('2026-11-16T07:00:00Z'), [true, true, true]);
    await notifier().run();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    const t = await student();
    await weekPlan(t.userId, -1);
    now = new Date('2026-11-16T20:00:00Z'); // 23:00 MSK
    await notifier().run();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('settings: off, plan reminders off, «only important», and a global «off»', async () => {
    const a = await student();
    await weekPlan(a.userId, -1);
    await testDb.db
      .insert(schema.notificationPreferences)
      .values({ userId: a.userId, progressEnabled: false, planRemindersEnabled: false });
    const b = await student();
    await weekPlan(b.userId, -1);
    await testDb.db.insert(schema.notificationPreferences).values({
      userId: b.userId,
      progressEnabled: true,
      planRemindersEnabled: true,
      frequency: 'important',
    });
    const c = await student();
    await weekPlan(c.userId, -1);
    await testDb.db.insert(schema.reminderSettings).values({ userId: c.userId, enabled: false });
    await notifier().run();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('the last day of the plan: «пора пройти контрольную тренировку», once', async () => {
    const s = await student();
    await weekPlan(s.userId, -6);
    await notifier().run();
    await notifier().run();
    expect(texts()).toEqual([
      '✅ Ты закончил недельный план. Пора пройти контрольную тренировку и проверить результат.',
    ]);
  });

  it('a finished plan: «ты выполнил недельную цель» with the real numbers, once', async () => {
    const s = await student();
    const plan = await weekPlan(s.userId, -8, 40);
    for (let i = 0; i < 7; i++) {
      await answers(
        s.userId,
        new Date(`${addDays(TODAY, -8 + i)}T09:00:00Z`),
        [true, true, i % 2 === 0],
        i * 3,
      );
    }
    await notifier().run();
    await notifier().run();
    expect(texts()).toHaveLength(1);
    expect(texts()[0]).toMatch(
      /^🎯 Ты выполнил недельную цель по теме «Простейшие уравнения»\. За неделю решено 21 задание, точность выросла на \d+%\.$/,
    );
    const [row] = await testDb.db
      .select({ status: schema.learningPlans.status })
      .from(schema.learningPlans)
      .where(eq(schema.learningPlans.id, plan.id));
    expect(row!.status).toBe('completed');
  });

  it('real improvement: «было X%, стало Y%», at most once a week per number', async () => {
    const s = await student();
    await answers(s.userId, new Date(NOW.getTime() - 25 * DAY), [false, false, true, false, false]);
    await answers(
      s.userId,
      new Date(NOW.getTime() - 3 * DAY),
      [true, true, true, true, true, true, true],
      5,
    );
    await notifier().run();
    expect(texts()).toHaveLength(1);
    expect(texts()[0]).toMatch(
      /^📈 Ты улучшил результат по математике №6: было \d+%, стало \d+%\./,
    );
    const m = /было (\d+)%, стало (\d+)%/.exec(texts()[0]!)!;
    expect(Number(m[2]) - Number(m[1])).toBeGreaterThanOrEqual(15);
    now = new Date(NOW.getTime() + DAY);
    await notifier().run();
    expect(texts()).toHaveLength(1);
  });

  it('no improvement message on too little data', async () => {
    const s = await student();
    await answers(s.userId, new Date(NOW.getTime() - DAY), [true, true, true]);
    await notifier().run();
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('at most two messages a day', async () => {
    const s = await student();
    await weekPlan(s.userId, -6); // control
    await answers(s.userId, new Date(NOW.getTime() - 25 * DAY), [false, false, true, false, false]);
    await answers(
      s.userId,
      new Date(NOW.getTime() - 3 * DAY),
      [true, true, true, true, true, true, true],
      5,
    );
    const [p2] = await testDb.db
      .insert(schema.learningPlans)
      .values({
        userId: s.userId,
        subjectId: 'russian',
        kind: 'week',
        startDate: addDays(TODAY, -6),
        focus: [],
        updatedAt: now,
      })
      .returning();
    await testDb.db.insert(schema.learningPlanDays).values({
      planId: p2!.id,
      dayIndex: 0,
      date: TODAY,
      skillKey: 'russian.09-root-vowels',
      activity: 'progress_check',
      targetTasks: 3,
      difficulty: 2,
    });
    await notifier().run();
    await notifier().run();
    expect(telegram.sendMessage).toHaveBeenCalledTimes(2);
  });

  /** Three messages are due today: two control trainings and an improvement. */
  async function busyDay(userId: string) {
    await weekPlan(userId, -6);
    await answers(userId, new Date(NOW.getTime() - 25 * DAY), [false, false, true, false, false]);
    await answers(
      userId,
      new Date(NOW.getTime() - 3 * DAY),
      [true, true, true, true, true, true, true],
      5,
    );
    const [p2] = await testDb.db
      .insert(schema.learningPlans)
      .values({
        userId,
        subjectId: 'russian',
        kind: 'week',
        startDate: addDays(TODAY, -6),
        focus: [],
        updatedAt: now,
      })
      .returning();
    await testDb.db.insert(schema.learningPlanDays).values({
      planId: p2!.id,
      dayIndex: 0,
      date: TODAY,
      skillKey: 'russian.09-root-vowels',
      activity: 'progress_check',
      targetTasks: 3,
      difficulty: 2,
    });
  }

  it('«Частота»: минимальная — 1 в день, обычная — 2, расширенная — 3', async () => {
    for (const [frequency, expected] of [
      ['important', 1],
      ['normal', 2],
      ['extended', 3],
    ] as const) {
      telegram = fakeTelegram();
      const s = await student();
      await busyDay(s.userId);
      await testDb.db
        .insert(schema.notificationPreferences)
        .values({ userId: s.userId, progressEnabled: true, planRemindersEnabled: true, frequency });
      await notifier().run();
      await notifier().run();
      expect(telegram.sendMessage, frequency).toHaveBeenCalledTimes(expected);
    }
  });

  it('«Расширенная»: the plan reminder already from 14:00; «Обычная» waits until 16:00; «Минимальная» never', async () => {
    now = new Date('2026-11-16T12:00:00Z'); // 15:00 MSK
    const ext = await student();
    await weekPlan(ext.userId, -1);
    await testDb.db.insert(schema.notificationPreferences).values({
      userId: ext.userId,
      progressEnabled: true,
      planRemindersEnabled: true,
      frequency: 'extended',
    });
    const norm = await student();
    await weekPlan(norm.userId, -1);
    await notifier().run();
    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(telegram.sendMessage.mock.calls[0]![0]).toBe(ext.chatId);
    now = NOW; // 17:00 MSK
    await notifier().run();
    expect(telegram.sendMessage.mock.calls.map((c) => c[0])).toEqual([ext.chatId, norm.chatId]);
  });

  it('«Расширенная» reports a smaller improvement (+10 points) that «Обычная» does not', async () => {
    const make = async (frequency: 'normal' | 'extended') => {
      const s = await student();
      // Mastery grows by more than 10 but less than 15 points.
      await answers(s.userId, new Date(NOW.getTime() - 25 * DAY), [
        true,
        false,
        true,
        false,
        true,
        false,
      ]);
      await answers(
        s.userId,
        new Date(NOW.getTime() - 3 * DAY),
        [true, true, true, false, true],
        6,
      );
      await testDb.db
        .insert(schema.notificationPreferences)
        .values({ userId: s.userId, progressEnabled: true, planRemindersEnabled: true, frequency });
      return s;
    };
    const n = await make('normal');
    const e = await make('extended');
    await notifier().run();
    const to = telegram.sendMessage.mock.calls.map((c) => c[0]);
    expect(to).not.toContain(n.chatId);
    expect(to).toContain(e.chatId);
    const m = /было (\d+)%, стало (\d+)%/.exec(texts()[to.indexOf(e.chatId)]!)!;
    const grew = Number(m[2]) - Number(m[1]);
    expect(grew).toBeGreaterThanOrEqual(10);
    expect(grew).toBeLessThan(15);
  });

  it('Telegram errors: a message that never arrived is retried, then sent once', async () => {
    const s = await student();
    await weekPlan(s.userId, -1);
    telegram.sendMessage.mockRejectedValueOnce(
      new TelegramApiError('sendMessage', 'network', null, 'down', null, {
        code: 'ECONNREFUSED',
        timeout: false,
        maybeDelivered: false,
      }),
    );
    await notifier().run();
    now = new Date(NOW.getTime() + 10 * 60_000);
    await notifier().run();
    await notifier().run();
    const rows = await testDb.db
      .select()
      .from(schema.progressNotifications)
      .where(eq(schema.progressNotifications.userId, s.userId));
    expect(rows.map((r) => [r.status, r.attempts, r.lastError])).toEqual([['sent', 2, null]]);
    expect(telegram.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('«Не присылать о прогрессе» switches progress messages off, the daily reminder untouched', async () => {
    const s = await student();
    await testDb.db.insert(schema.reminderSettings).values({ userId: s.userId, enabled: true });
    await handleUpdate(
      { db: testDb.db, telegram, photos: new BotPhotos(testDb.db), siteUrl: SITE, logger },
      {
        update_id: 1,
        callback_query: {
          id: 'cb',
          from: { id: s.chatId },
          data: 'progress_off',
          message: { message_id: 1, chat: { id: s.chatId, type: 'private' } },
        },
      },
    );
    const [p] = await testDb.db
      .select()
      .from(schema.notificationPreferences)
      .where(eq(schema.notificationPreferences.userId, s.userId));
    expect(p).toMatchObject({ progressEnabled: false, planRemindersEnabled: false });
    const [r] = await testDb.db
      .select()
      .from(schema.reminderSettings)
      .where(eq(schema.reminderSettings.userId, s.userId));
    expect(r!.enabled).toBe(true);
    expect(texts().at(-1)).toMatch(/отключены/);
  });
});
