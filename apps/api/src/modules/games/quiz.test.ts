import { randomUUID } from 'node:crypto';
import { importStressDictionary, schema, syncTaskSkills } from '@zybrilka/db';
import { createFullContentTestDb } from '@zybrilka/db/testing';
import {
  MATCH_SEPARATOR,
  checkQuizAnswer,
  MINI_GAMES,
  type MiniGamesResponse,
  type QuizAnswerResponse,
  type QuizItem,
  type QuizProgressResponse,
  type QuizRoundResponse,
} from '@zybrilka/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { QUIZ_GAME_IDS, quizBank, resetQuizBanks, warmQuizBanks } from './quiz.js';

/** The answer a player gives to get `item` right, in the form the screen sends. */
function rightAnswer(item: QuizItem): string {
  if (item.kind === 'words') return item.display;
  if (item.kind === 'input') return item.display;
  return item.correct;
}

/**
 * Quiz mini-games on the REAL content (math ЕГЭ-2026, Ященко-2027,
 * Дощинский-2027 Russian): every question of every game, then rounds,
 * answers and progress through the API.
 */
describe('mini-games — quizzes (real content)', () => {
  let testDb: Awaited<ReturnType<typeof createFullContentTestDb>>;
  let app: ReturnType<typeof buildApp>;

  beforeAll(async () => {
    testDb = await createFullContentTestDb();
    await syncTaskSkills(testDb.db);
    await importStressDictionary(testDb.db);
    resetQuizBanks();
    app = buildApp({
      version: 'test',
      db: testDb.db,
      authConfig: loadConfig({ NODE_ENV: 'test', WEB_BASE_URL: 'https://zybrilka.test' }),
    });
  }, 300_000);
  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  async function player() {
    const [user] = await testDb.db.insert(schema.users).values({}).returning();
    const id = randomUUID();
    await testDb.db
      .insert(schema.authSessions)
      .values({ id, userId: user!.id, expiresAt: new Date(Date.now() + 3_600_000) });
    return { id: user!.id, cookie: `session_id=${id}` };
  }
  const get = (url: string, cookie?: string) =>
    app.inject({ method: 'GET', url: `/api/v1${url}`, headers: cookie ? { cookie } : {} });
  const post = (url: string, payload: object, cookie?: string) =>
    app.inject({
      method: 'POST',
      url: `/api/v1${url}`,
      headers: cookie ? { cookie } : {},
      payload,
    });

  it('banks: warmed once, served from memory, a stale one served at once and rebuilt behind', async () => {
    resetQuizBanks();
    await warmQuizBanks(testDb.db);
    const warm = await quizBank(testDb.db, 'nn');
    expect(warm.items.length).toBeGreaterThan(0);
    expect(await quizBank(testDb.db, 'nn')).toBe(warm);
    // Ten minutes later: the old bank is returned immediately (no wait)…
    const later = Date.now() + 10 * 60 * 1000;
    expect(await quizBank(testDb.db, 'nn', later)).toBe(warm);
    // …while a fresh one is built in the background and then served.
    await vi.waitFor(async () => expect(await quizBank(testDb.db, 'nn')).not.toBe(warm));
    expect((await quizBank(testDb.db, 'nn')).items.length).toBe(warm.items.length);
  });

  it('every one of the 18 quiz games has questions; every question is answerable by its own key', async () => {
    expect(QUIZ_GAME_IDS).toHaveLength(18);
    for (const gameId of QUIZ_GAME_IDS) {
      const bank = await quizBank(testDb.db, gameId);
      expect(bank.items.length, gameId).toBeGreaterThan(0);
      expect(new Set(bank.items.map((i) => i.id)).size, gameId).toBe(bank.items.length);
      for (const item of bank.items) {
        const where = `${gameId} ${item.key}`;
        if (item.kind === 'choice') {
          expect(item.options, where).toContain(item.correct);
          expect(new Set(item.options).size, where).toBe(item.options!.length);
        }
        if (item.kind === 'slots') {
          expect(
            [...item.correct].every((d) => item.slots!.includes(Number(d))),
            where,
          ).toBe(true);
        }
        expect(checkQuizAnswer(item, rightAnswer(item)), where).toBe(true);
        // An option that is not a key of the source is never right.
        if (item.kind === 'choice') {
          const keys = [item.correct, ...(item.accepted ?? [])];
          for (const o of item.options!)
            expect(checkQuizAnswer(item, o), where).toBe(keys.includes(o));
          expect(
            (item.accepted ?? []).every((a) => item.options!.includes(a)),
            where,
          ).toBe(true);
        }
        // An explanation always says where it comes from; automatic ones are
        // only the key-based notes: «Ни одной из этих ошибок», «здесь верно»
        // of a one-word №5/№7 question, and the computed «Вычисления».
        if (item.explanation) {
          const auto =
            (gameId === 'grammar-detective' && item.correct === 'Ни одной из этих ошибок') ||
            (item.key.includes(':w:') && item.correct === 'Да') ||
            item.key.startsWith('drill:');
          expect(item.explanationSource, where).toBe(
            gameId === 'theory-practice' ? 'author' : auto ? 'auto' : 'task',
          );
          expect(item.explanation, where).not.toMatch(/не подда[её]тся надёжн/i);
        }
        expect(item.text.length, where).toBeGreaterThan(0);
      }
    }
  });

  it('the hub lists all 19 games with their real number of questions', async () => {
    const hub = (await get('/games')).json() as MiniGamesResponse;
    expect(hub.games.map((g) => g.id)).toEqual(MINI_GAMES.map((g) => g.id));
    for (const g of hub.games) {
      if (g.id === 'stress') continue;
      expect(g.questionCount, g.id).toBe((await quizBank(testDb.db, g.id)).items.length);
      expect(g.progress).toBeNull(); // a guest
    }
  });

  it('a round: 10 questions without the key; the first answer counts; a resend counts once', async () => {
    const { id: userId, cookie } = await player();
    const round = (await get('/games/quiz/nn/round', cookie)).json() as QuizRoundResponse;
    expect(round.questions).toHaveLength(10);
    expect(new Set(round.questions.map((q) => q.itemId)).size).toBe(10);
    expect(JSON.stringify(round.questions)).not.toMatch(/"correct"|"display"|"explanation"/);
    const bank = await quizBank(testDb.db, 'nn');
    const [q1, q2] = round.questions;
    const item1 = bank.byId.get(q1!.itemId)!;
    const wrong1 = item1.options!.find((o) => o !== item1.correct)!;
    const clientAnswerId = randomUUID();
    const first = (
      await post(
        '/games/quiz/nn/answer',
        { itemId: q1!.itemId, answer: wrong1, clientAnswerId, sessionId: round.sessionId },
        cookie,
      )
    ).json() as QuizAnswerResponse;
    expect(first).toMatchObject({ correct: false, correctOption: item1.correct, recorded: true });
    expect(first.taskId).toBe(item1.taskId);
    // The same answer re-sent, then a second answer to the same question: not recorded.
    const again = (
      await post(
        '/games/quiz/nn/answer',
        { itemId: q1!.itemId, answer: wrong1, clientAnswerId, sessionId: round.sessionId },
        cookie,
      )
    ).json() as QuizAnswerResponse;
    expect(again.recorded).toBe(false);
    const retry = (
      await post(
        '/games/quiz/nn/answer',
        {
          itemId: q1!.itemId,
          answer: item1.correct,
          clientAnswerId: randomUUID(),
          sessionId: round.sessionId,
        },
        cookie,
      )
    ).json() as QuizAnswerResponse;
    expect(retry).toMatchObject({ correct: true, recorded: false });
    const item2 = bank.byId.get(q2!.itemId)!;
    await post(
      '/games/quiz/nn/answer',
      {
        itemId: q2!.itemId,
        answer: item2.correct,
        clientAnswerId: randomUUID(),
        sessionId: round.sessionId,
      },
      cookie,
    );
    const answers = await testDb.db
      .select()
      .from(schema.miniGameAnswers)
      .where(eq(schema.miniGameAnswers.userId, userId));
    expect(answers).toHaveLength(2);
    const [session] = await testDb.db
      .select()
      .from(schema.miniGameSessions)
      .where(eq(schema.miniGameSessions.id, round.sessionId!));
    expect(session).toMatchObject({ answeredCount: 2, correctCount: 1 });

    // Finished round → best score; progress; «Мои ошибки» has exactly the miss.
    expect(
      (
        await post(
          '/games/quiz/nn/finish',
          { sessionId: round.sessionId, firstTryCorrect: 1 },
          cookie,
        )
      ).statusCode,
    ).toBe(204);
    const progress = (await get('/games/quiz/nn/progress', cookie)).json() as QuizProgressResponse;
    expect(progress).toMatchObject({
      answers: 2,
      correct: 1,
      mistakes: 1,
      bestScore: 10,
      rounds: 1,
      bankSize: bank.items.length,
    });
    const mistakes = (
      await get('/games/quiz/nn/round?mode=mistakes', cookie)
    ).json() as QuizRoundResponse;
    expect(mistakes.questions.map((q) => q.itemId)).toEqual([q1!.itemId]);
  });

  it('a perfect round scores 10 per question +20, and replaying keeps the best', async () => {
    const { cookie } = await player();
    const bank = await quizBank(testDb.db, 'gap-word');
    const play = async (rightCount: number) => {
      const round = (
        await get('/games/quiz/gap-word/round?size=5', cookie)
      ).json() as QuizRoundResponse;
      for (const [i, q] of round.questions.entries()) {
        const item = bank.byId.get(q.itemId)!;
        await post(
          '/games/quiz/gap-word/answer',
          {
            itemId: q.itemId,
            answer: i < rightCount ? rightAnswer(item) : 'zzz',
            clientAnswerId: randomUUID(),
            sessionId: round.sessionId,
          },
          cookie,
        );
      }
      await post(
        '/games/quiz/gap-word/finish',
        { sessionId: round.sessionId, firstTryCorrect: rightCount },
        cookie,
      );
    };
    await play(5);
    await play(2);
    const progress = (
      await get('/games/quiz/gap-word/progress', cookie)
    ).json() as QuizProgressResponse;
    expect(progress).toMatchObject({ bestScore: 70, rounds: 2 });
  });

  it('a guest plays without saving; personal modes and progress need an account', async () => {
    const round = (await get('/games/quiz/commas/round')).json() as QuizRoundResponse;
    expect(round.questions.length).toBeGreaterThan(0);
    const bank = await quizBank(testDb.db, 'commas');
    const item = bank.byId.get(round.questions[0]!.itemId)!;
    const res = (
      await post('/games/quiz/commas/answer', {
        itemId: item.id,
        answer: item.correct,
        clientAnswerId: randomUUID(),
        sessionId: round.sessionId,
      })
    ).json() as QuizAnswerResponse;
    expect(res).toMatchObject({ correct: true, recorded: false });
    expect((await get('/games/quiz/commas/round?mode=mistakes')).statusCode).toBe(401);
    expect((await get('/games/quiz/commas/progress')).statusCode).toBe(401);
    expect((await get('/games/quiz/nope/round')).statusCode).toBe(404);
  });

  it('games never touch ЕГЭ attempts, mistakes, XP or learning sessions', async () => {
    const { id: userId, cookie } = await player();
    for (const gameId of ['probability-blitz', 'find-in-text', 'grammar-detective']) {
      const round = (
        await get(`/games/quiz/${gameId}/round?size=5`, cookie)
      ).json() as QuizRoundResponse;
      const bank = await quizBank(testDb.db, gameId);
      for (const q of round.questions) {
        await post(
          `/games/quiz/${gameId}/answer`,
          {
            itemId: q.itemId,
            answer: rightAnswer(bank.byId.get(q.itemId)!),
            clientAnswerId: randomUUID(),
            sessionId: round.sessionId,
          },
          cookie,
        );
      }
    }
    for (const table of [
      schema.attempts,
      schema.mistakes,
      schema.xpEvents,
      schema.learningSessions,
    ] as const) {
      const rows = await testDb.db.select().from(table).where(eq(table.userId, userId));
      expect(rows).toHaveLength(0);
    }
    const answers = await testDb.db
      .select()
      .from(schema.miniGameAnswers)
      .where(eq(schema.miniGameAnswers.userId, userId));
    expect(answers.length).toBeGreaterThan(0);
  });

  it('a `words` answer works as the screen sends it (tapped words in text order)', async () => {
    const bank = await quizBank(testDb.db, 'find-in-text');
    for (const item of bank.items) {
      const text = item.text.toLowerCase();
      for (const w of item.display.split(' ')) expect(text, item.key).toContain(w);
      expect(checkQuizAnswer(item, item.display), item.key).toBe(true);
    }
  });

  it('«Грамматические нормы»: the key-based note is labelled automatic in the answer', async () => {
    const bank = await quizBank(testDb.db, 'grammar-detective');
    const none = bank.items.find((i) => i.correct === 'Ни одной из этих ошибок')!;
    const round = (
      await get('/games/quiz/grammar-detective/round?size=5')
    ).json() as QuizRoundResponse;
    const res = (
      await post('/games/quiz/grammar-detective/answer', {
        itemId: none.id,
        answer: 'Ни одной из этих ошибок',
        clientAnswerId: randomUUID(),
        sessionId: round.sessionId,
      })
    ).json() as QuizAnswerResponse;
    expect(res).toMatchObject({ correct: true, explanationSource: 'auto' });
    expect(res.explanation).toMatch(/Других ошибок ключ не проверяет/);
  });

  it('the chosen round size is the real length of the round, capped by the bank', async () => {
    const r30 = (await get('/games/quiz/nn/round?size=30')).json() as QuizRoundResponse;
    expect(r30.questions).toHaveLength(30);
    const r3 = (await get('/games/quiz/nn/round?size=3')).json() as QuizRoundResponse;
    expect(r3.questions).toHaveLength(3);
    // A bank smaller than the request: every question once, never a repeat.
    const bank = await quizBank(testDb.db, 'probability-blitz');
    expect(bank.items.length).toBeLessThan(80);
    const small = (
      await get(`/games/quiz/probability-blitz/round?size=50`)
    ).json() as QuizRoundResponse;
    expect(small.questions).toHaveLength(Math.min(50, bank.items.length));
    expect(new Set(small.questions.map((q) => q.itemId)).size).toBe(small.questions.length);
    expect((await get('/games/quiz/nn/round?size=51')).statusCode).toBe(400);
    expect((await get('/games/quiz/nn/round?size=2')).statusCode).toBe(400);
    const stress = (await get('/games/stress/round?size=60')).json() as { questions: unknown[] };
    expect(stress.questions).toHaveLength(60);
  });

  it('a question just answered is not served again while the bank has others', async () => {
    const { cookie } = await player();
    const first = (await get('/games/quiz/nn/round?size=10', cookie)).json() as QuizRoundResponse;
    for (const q of first.questions) {
      await post(
        '/games/quiz/nn/answer',
        { itemId: q.itemId, answer: 'Н', clientAnswerId: randomUUID(), sessionId: first.sessionId },
        cookie,
      );
    }
    const second = (await get('/games/quiz/nn/round?size=10', cookie)).json() as QuizRoundResponse;
    const seen = new Set(first.questions.map((q) => q.itemId));
    expect(second.questions.filter((q) => seen.has(q.itemId))).toHaveLength(0);
  });

  it('round size settings: saved per game for the account, validated, private', async () => {
    const a = await player();
    const b = await player();
    const put = (gameId: string, payload: object, cookie?: string) =>
      app.inject({
        method: 'PUT',
        url: `/api/v1/games/settings/${gameId}`,
        headers: cookie ? { cookie } : {},
        payload,
      });
    expect((await get('/games/settings')).statusCode).toBe(401);
    expect((await put('nn', { roundSize: 15 })).statusCode).toBe(401);
    expect((await put('nn', { roundSize: 15 }, a.cookie)).statusCode).toBe(200);
    expect((await put('stress', { roundSize: 70 }, a.cookie)).statusCode).toBe(200);
    expect((await put('nn', { roundSize: 70 }, a.cookie)).statusCode).toBe(400);
    expect((await put('nn', { roundSize: 2 }, a.cookie)).statusCode).toBe(400);
    expect((await put('no-such-game', { roundSize: 10 }, a.cookie)).statusCode).toBe(404);
    expect((await put('nn', { roundSize: 25 }, a.cookie)).statusCode).toBe(200);
    expect((await get('/games/settings', a.cookie)).json()).toEqual({
      settings: { nn: { roundSize: 25 }, stress: { roundSize: 70 } },
    });
    expect((await get('/games/settings', b.cookie)).json()).toEqual({ settings: {} });
  });

  it('«Вычисления» and «Вероятность»: bigger banks, every question answerable', async () => {
    const expr = await quizBank(testDb.db, 'expressions-blitz');
    const prob = await quizBank(testDb.db, 'probability-blitz');
    expect(expr.items.filter((i) => i.key.startsWith('drill:')).length).toBeGreaterThan(100);
    expect(prob.items.length).toBeGreaterThan(40);
    for (const item of [...expr.items, ...prob.items]) {
      expect(checkQuizAnswer(item, item.display), item.key).toBe(true);
    }
  });

  it('«Теория на практике»: a match question — shuffled right column, all pairs needed', async () => {
    const bank = await quizBank(testDb.db, 'theory-practice');
    expect(bank.items.length).toBeGreaterThanOrEqual(80);
    const match = bank.items.find((i) => i.kind === 'match')!;
    // Rounds hand out the right column shuffled, never in answer order every time.
    const orders = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const round = (
        await get('/games/quiz/theory-practice/round?size=50')
      ).json() as QuizRoundResponse;
      const q = round.questions.find((x) => x.itemId === match.id);
      if (q) {
        expect(q.left).toEqual(match.left);
        orders.add(q.options!.join('|'));
      }
    }
    expect(orders.size).toBeGreaterThan(1);
    const round = (
      await get('/games/quiz/theory-practice/round?size=5')
    ).json() as QuizRoundResponse;
    const right = match.correct.split(MATCH_SEPARATOR);
    const swapped = [right[1]!, right[0]!, ...right.slice(2)].join(MATCH_SEPARATOR);
    const wrong = (
      await post('/games/quiz/theory-practice/answer', {
        itemId: match.id,
        answer: swapped,
        clientAnswerId: randomUUID(),
        sessionId: round.sessionId,
      })
    ).json() as QuizAnswerResponse;
    expect(wrong).toMatchObject({
      correct: false,
      correctPairs: right,
      explanationSource: 'author',
    });
    const ok = (
      await post('/games/quiz/theory-practice/answer', {
        itemId: match.id,
        answer: match.correct,
        clientAnswerId: randomUUID(),
      })
    ).json() as QuizAnswerResponse;
    expect(ok.correct).toBe(true);
  });

  it('per-round first answers: a guest re-sending an answer counts the question once', async () => {
    const round = (await get('/games/quiz/nn/round?size=3')).json() as QuizRoundResponse;
    const q = round.questions[0]!;
    const body = {
      itemId: q.itemId,
      answer: 'Н',
      clientAnswerId: randomUUID(),
      sessionId: round.sessionId,
    };
    await post('/games/quiz/nn/answer', body);
    await post('/games/quiz/nn/answer', body);
    const rows = await testDb.db
      .select()
      .from(schema.miniGameRoundAnswers)
      .where(eq(schema.miniGameRoundAnswers.sessionId, round.sessionId!));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ itemId: q.itemId, attempts: 2, userId: null });
    const { cookie, id } = await player();
    const mine = (await get('/games/quiz/nn/round?size=3', cookie)).json() as QuizRoundResponse;
    const answer = {
      itemId: mine.questions[0]!.itemId,
      answer: 'НН',
      clientAnswerId: randomUUID(),
      sessionId: mine.sessionId,
    };
    await post('/games/quiz/nn/answer', answer, cookie);
    await post('/games/quiz/nn/answer', answer, cookie); // the same answer again
    // Someone else's round id: nothing is recorded for it.
    await post(
      '/games/quiz/nn/answer',
      { ...answer, clientAnswerId: randomUUID(), sessionId: round.sessionId },
      cookie,
    );
    const own = await testDb.db
      .select()
      .from(schema.miniGameRoundAnswers)
      .where(eq(schema.miniGameRoundAnswers.sessionId, mine.sessionId!));
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ userId: id, attempts: 1 });
    const guestRound = await testDb.db
      .select()
      .from(schema.miniGameRoundAnswers)
      .where(eq(schema.miniGameRoundAnswers.sessionId, round.sessionId!));
    expect(guestRound).toHaveLength(1);
  });
});
