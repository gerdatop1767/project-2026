import { randomUUID } from 'node:crypto';
import { broadcastAudienceSchema, type BroadcastAudienceInput } from '@zybrilka/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { audienceRowsSql, type AudienceRow } from './broadcastAudience.js';
import * as schema from './schema.js';
import { createSeededTestDb } from './testing.js';

// Moscow "today" = 2026-03-30.
const NOW = new Date('2026-03-30T09:00:00Z');
const daysAgo = (n: number, hour = 9) => new Date(Date.UTC(2026, 2, 30 - n, hour, 0, 0));

describe('broadcast audience (one SQL for preview and snapshot)', () => {
  let testDb: Awaited<ReturnType<typeof createSeededTestDb>>;
  const ids: Record<string, string> = {};
  let chatId = 5000;
  let mathTask: string;

  async function user(
    key: string,
    registeredDaysAgo: number,
    opts: { chat?: 'linked' | 'blocked' | 'none' } = {},
  ) {
    const [u] = await testDb.db
      .insert(schema.users)
      .values({ createdAt: daysAgo(registeredDaysAgo), displayName: key })
      .returning();
    await testDb.db.insert(schema.authIdentities).values({
      userId: u!.id,
      provider: 'telegram',
      providerUserId: `aud-${key}`,
      createdAt: daysAgo(registeredDaysAgo),
    });
    // Signing up creates a session: the first «activity».
    await testDb.db.insert(schema.authSessions).values({
      id: randomUUID(),
      userId: u!.id,
      expiresAt: new Date(NOW.getTime() + 86_400_000),
      createdAt: daysAgo(registeredDaysAgo),
    });
    const chat = opts.chat ?? 'linked';
    if (chat !== 'none') {
      await testDb.db.insert(schema.telegramBotChats).values({
        chatId: chatId++,
        userId: u!.id,
        blockedAt: chat === 'blocked' ? daysAgo(1) : null,
      });
    }
    ids[key] = u!.id;
    return u!.id;
  }

  async function rows(input: BroadcastAudienceInput, broadcastId: string | null = null) {
    const audience = broadcastAudienceSchema.parse(input);
    const result = (await testDb.db.execute(
      audienceRowsSql(audience, { now: NOW, broadcastId }),
    )) as unknown;
    const list = (
      Array.isArray(result) ? result : (result as { rows: AudienceRow[] }).rows
    ) as AudienceRow[];
    return new Map(
      list.map((r) => [
        Object.entries(ids).find(([, id]) => id === r.user_id)?.[0] ?? r.user_id,
        r,
      ]),
    );
  }

  beforeAll(async () => {
    testDb = await createSeededTestDb();
    const [task] = await testDb.db.select({ id: schema.tasks.id }).from(schema.tasks).limit(1);
    mathTask = task!.id;
    await user('fresh', 1); // too young for d3
    const d3 = await user('d3', 4);
    await user('d3NoChat', 4, { chat: 'none' });
    await user('d3Blocked', 5, { chat: 'blocked' });
    const off = await user('d3Off', 3);
    await testDb.db.insert(schema.reminderSettings).values({ userId: off, enabled: false });
    const on = await user('d3RemindersOn', 6);
    await testDb.db.insert(schema.reminderSettings).values({ userId: on, enabled: true });
    const d7 = await user('d7', 10);
    await user('d20', 25);
    // d3 solved one task yesterday and played a mini-game; chose math.
    await testDb.db.insert(schema.attempts).values({
      userId: d3,
      taskId: mathTask,
      isCorrect: true,
      answerRaw: 'x',
      createdAt: daysAgo(1),
    });
    await testDb.db
      .insert(schema.userDailyActivity)
      .values({ userId: d3, activityDate: '2026-03-29' });
    await testDb.db.insert(schema.miniGameAnswers).values({
      userId: d3,
      gameId: 'stress',
      itemId: randomUUID(),
      correct: true,
      answer: '1',
      clientAnswerId: randomUUID(),
      createdAt: daysAgo(1),
    });
    await testDb.db.insert(schema.userSubjectProfiles).values({ userId: d7, subjectId: 'russian' });
    // A pre-auth anonymous row never matches.
    await testDb.db.insert(schema.users).values({ createdAt: daysAgo(4) });
  });
  afterAll(async () => {
    await testDb.close();
  });

  it('the d3 window (3–6 days) — and why each matching user is in or out', async () => {
    const r = await rows({ accountAgeMinDays: 3, accountAgeMaxDays: 6, stage: 'd3' });
    expect([...r.keys()].sort()).toEqual(
      ['d3', 'd3Blocked', 'd3NoChat', 'd3Off', 'd3RemindersOn'].sort(),
    );
    expect(r.get('d3')!.state).toBe('ok');
    expect(r.get('d3RemindersOn')!.state).toBe('ok');
    expect(r.get('d3NoChat')!.state).toBe('no_bot_chat');
    expect(r.get('d3Blocked')!.state).toBe('no_bot_chat');
    expect(r.get('d3Off')!.state).toBe('notifications_off');
    expect(r.get('d3')!.solved).toBe(1);
    expect(r.get('d3')!.chat_id).not.toBeNull();
  });

  it('filters: activity, solved, subjects, mini-games, registration dates, exclusions', async () => {
    expect([...(await rows({ solvedMin: 1 })).keys()]).toEqual(['d3']);
    expect((await rows({ solvedMax: 0 })).has('d3')).toBe(false);
    expect([...(await rows({ activeDaysMin: 1, activityWindowDays: 7 })).keys()]).toEqual(['d3']);
    expect([...(await rows({ miniGames: 'played' })).keys()]).toEqual(['d3']);
    expect((await rows({ miniGames: 'not_played' })).has('d3')).toBe(false);
    expect([...(await rows({ subjects: ['russian'] })).keys()]).toEqual(['d7']);
    expect([
      ...(await rows({ registeredFrom: '2026-03-20', registeredTo: '2026-03-20' })).keys(),
    ]).toEqual(['d7']);
    // Last activity: d3 answered yesterday; d20's last activity is its sign-up 25 days ago.
    expect((await rows({ inactiveMinDays: 14 })).has('d20')).toBe(true);
    expect((await rows({ inactiveMinDays: 14 })).has('d3')).toBe(false);
    expect((await rows({ activeWithinDays: 2 })).has('d3')).toBe(true);
    expect((await rows({ activeWithinDays: 2 })).has('d7')).toBe(false);
    const excluded = await rows({
      accountAgeMinDays: 3,
      accountAgeMaxDays: 6,
      excludeUserIds: [ids.d3!],
    });
    expect(excluded.get('d3')!.state).toBe('excluded');
  });

  it('a stage already sent is not sent again — unless the admin allows a repeat', async () => {
    const [author] = await testDb.db.select({ id: schema.users.id }).from(schema.users).limit(1);
    const [earlier] = await testDb.db
      .insert(schema.broadcasts)
      .values({ authorUserId: author!.id, stage: 'd3', status: 'completed' })
      .returning();
    await testDb.db.insert(schema.broadcastDeliveries).values({
      broadcastId: earlier!.id,
      chatId: 1,
      userId: ids.d3!,
      status: 'sent',
    });
    // A failed delivery does not count as «got it».
    await testDb.db.insert(schema.broadcastDeliveries).values({
      broadcastId: earlier!.id,
      chatId: 2,
      userId: ids.d3RemindersOn!,
      status: 'failed',
    });
    const again = await rows({ accountAgeMinDays: 3, accountAgeMaxDays: 6, stage: 'd3' });
    expect(again.get('d3')!.state).toBe('stage_sent');
    expect(again.get('d3RemindersOn')!.state).toBe('ok');
    const repeat = await rows({
      accountAgeMinDays: 3,
      accountAgeMaxDays: 6,
      stage: 'd3',
      allowRepeat: true,
    });
    expect(repeat.get('d3')!.state).toBe('ok');
    // Another stage is not blocked by it; the broadcast itself never blocks its own recipients.
    expect(
      (await rows({ accountAgeMinDays: 3, accountAgeMaxDays: 6, stage: 'd7' })).get('d3')!.state,
    ).toBe('ok');
    expect(
      (await rows({ accountAgeMinDays: 3, accountAgeMaxDays: 6, stage: 'd3' }, earlier!.id)).get(
        'd3',
      )!.state,
    ).toBe('ok');
  });
});
