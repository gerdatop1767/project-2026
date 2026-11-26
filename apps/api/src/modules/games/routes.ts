import type { Database } from '@zybrilka/db';
import {
  DICTIONARY_GAME_ID,
  MINI_GAMES,
  dictionaryAnswerSchema,
  dictionaryReference,
  dictionaryTask,
  dictionaryRoundQuerySchema,
  miniGameFinishRequestSchema,
  miniGameRatingQuerySchema,
  miniGameSessionRequestSchema,
  quizAnswerRequestSchema,
  quizRoundQuerySchema,
  stressAnswerRequestSchema,
  stressRoundQuerySchema,
  type MiniGamesResponse,
} from '@zybrilka/shared';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  getMiniGameSettings,
  isMiniGame,
  saveMiniGameSettings,
  validRoundSize,
} from './settings.js';
import { NotEnoughQuestionsError, abandonSession } from './sessions.js';
import { miniGameRating } from './ratings.js';
import {
  answerDictionary,
  dictionaryHubProgress,
  dictionaryItemCount,
  dictionaryKnown,
  dictionaryResume,
  dictionaryRound,
  dictionarySummary,
  finishDictionary,
} from './dictionary.js';
import {
  answerStress,
  finishStressSession,
  stressResume,
  stressProgress,
  stressRound,
  stressSummary,
  stressWordCount as stressCount,
} from './stress.js';
import {
  answerQuiz,
  finishQuiz,
  isQuizGame,
  quizBank,
  quizProgress,
  quizResume,
  quizRound,
  quizSummaries,
} from './quiz.js';

const activeQuerySchema = z.object({ sessionId: z.uuid().optional() });

export interface MiniGamesRoutesOptions {
  db: Database;
}

/**
 * Mini-games (docs/MINI_GAMES.md). Playing is open to guests, like task
 * training: a guest's answers are checked but never recorded. Progress
 * and the personal modes («Мои ошибки», «Сложные слова») need an account.
 * Everything acts on the session's own account only.
 */
export const miniGamesRoutes: FastifyPluginAsync<MiniGamesRoutesOptions> = async (app, { db }) => {
  const userOf = (request: FastifyRequest) => request.sessionUserId ?? null;
  const limit = (max: number) => ({
    rateLimit: {
      max,
      timeWindow: '1 minute',
      keyGenerator: (request: FastifyRequest) => request.sessionUserId ?? request.ip,
    },
  });

  app.get('/games', async (request, reply): Promise<MiniGamesResponse> => {
    const userId = userOf(request);
    const [stress, quiz, stressTotal, dictionary] = await Promise.all([
      userId ? stressSummary(db, userId) : null,
      userId ? quizSummaries(db, userId) : null,
      userId ? null : stressCount(db),
      userId ? dictionaryHubProgress(db, userId) : null,
    ]);
    const games = await Promise.all(
      MINI_GAMES.map(async (g) => {
        if (g.id === DICTIONARY_GAME_ID) {
          return { ...g, progress: dictionary, questionCount: dictionaryItemCount() };
        }
        if (!isQuizGame(g.id)) {
          return { ...g, progress: stress, questionCount: stress?.total ?? stressTotal ?? 0 };
        }
        const bank = await quizBank(db, g.id);
        return { ...g, progress: quiz?.get(g.id) ?? null, questionCount: bank.items.length };
      }),
    );
    reply.header('cache-control', 'no-store');
    return { games };
  });

  // A signed-in player's round size per game (a guest keeps it in the browser).
  app.get('/games/settings', async (request, reply) => {
    const userId = userOf(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    reply.header('cache-control', 'no-store');
    return getMiniGameSettings(db, userId);
  });

  app.put('/games/settings/:gameId', { config: limit(60) }, async (request, reply) => {
    const userId = userOf(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    const gameId = (request.params as { gameId?: string }).gameId ?? '';
    if (!isMiniGame(gameId)) return reply.code(404).send({ error: 'game_not_found' });
    const body = z.object({ roundSize: z.number().int() }).safeParse(request.body);
    if (!body.success || !validRoundSize(gameId, body.data.roundSize)) {
      return reply.code(400).send({ error: 'invalid_body' });
    }
    await saveMiniGameSettings(db, userId, gameId, body.data.roundSize);
    return { gameId, roundSize: body.data.roundSize };
  });

  // Quiz games (docs/MINI_GAMES.md § Игры-викторины): one set of routes for all.
  const quizId = (request: FastifyRequest) => {
    const id = (request.params as { gameId?: string }).gameId ?? '';
    return isQuizGame(id) ? id : null;
  };

  app.get('/games/quiz/:gameId/round', { config: limit(60) }, async (request, reply) => {
    const gameId = quizId(request);
    if (!gameId) return reply.code(404).send({ error: 'game_not_found' });
    const query = quizRoundQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_query' });
    const userId = userOf(request);
    if (query.data.mode !== 'all' && !userId) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    reply.header('cache-control', 'no-store');
    try {
      return await quizRound(db, userId, gameId, query.data.mode, query.data.size);
    } catch (error) {
      if (error instanceof NotEnoughQuestionsError) {
        return reply.code(409).send({ error: 'not_enough_questions', available: error.available });
      }
      throw error;
    }
  });

  // «Продолжить игру»: the signed-in player's round in progress (any
  // device), or a guest's own round by its id (?sessionId=).
  app.get('/games/quiz/:gameId/active', async (request, reply) => {
    const gameId = quizId(request);
    if (!gameId) return reply.code(404).send({ error: 'game_not_found' });
    const query = activeQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_query' });
    reply.header('cache-control', 'no-store');
    return {
      session: await quizResume(db, userOf(request), gameId, query.data.sessionId ?? null),
    };
  });

  app.post('/games/quiz/:gameId/abandon', { config: limit(60) }, async (request, reply) => {
    const gameId = quizId(request);
    if (!gameId) return reply.code(404).send({ error: 'game_not_found' });
    const body = miniGameSessionRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    await abandonSession(db, gameId, body.data.sessionId, userOf(request));
    return reply.code(204).send();
  });

  app.post('/games/quiz/:gameId/answer', { config: limit(120) }, async (request, reply) => {
    const gameId = quizId(request);
    if (!gameId) return reply.code(404).send({ error: 'game_not_found' });
    const body = quizAnswerRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const result = await answerQuiz(db, userOf(request), gameId, body.data);
    if (!result) return reply.code(404).send({ error: 'question_not_found' });
    return result;
  });

  app.post('/games/quiz/:gameId/finish', { config: limit(60) }, async (request, reply) => {
    const gameId = quizId(request);
    if (!gameId) return reply.code(404).send({ error: 'game_not_found' });
    const body = miniGameFinishRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    // The client's count is ignored: the server counts the round's first answers.
    const result = await finishQuiz(db, userOf(request), gameId, body.data.sessionId);
    if (!result) return reply.code(404).send({ error: 'session_not_found' });
    return result;
  });

  app.get('/games/quiz/:gameId/progress', async (request, reply) => {
    const gameId = quizId(request);
    if (!gameId) return reply.code(404).send({ error: 'game_not_found' });
    const userId = userOf(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    reply.header('cache-control', 'no-store');
    return quizProgress(db, userId, gameId);
  });

  app.get('/games/stress/round', { config: limit(60) }, async (request, reply) => {
    const query = stressRoundQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_query' });
    const userId = userOf(request);
    if (query.data.mode !== 'all' && !userId) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    reply.header('cache-control', 'no-store');
    try {
      return await stressRound(db, userId, query.data.mode, query.data.size);
    } catch (error) {
      if (error instanceof NotEnoughQuestionsError) {
        return reply.code(409).send({ error: 'not_enough_questions', available: error.available });
      }
      throw error;
    }
  });

  // A game's own ratings, all time: «Лучший результат» / «Всего очков».
  app.get('/games/:gameId/rating', { config: limit(120) }, async (request, reply) => {
    const gameId = (request.params as { gameId?: string }).gameId ?? '';
    if (!MINI_GAMES.some((g) => g.id === gameId)) {
      return reply.code(404).send({ error: 'game_not_found' });
    }
    const query = miniGameRatingQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_query' });
    reply.header('cache-control', 'no-store');
    return miniGameRating(db, gameId, query.data.kind, query.data.limit, userOf(request));
  });

  app.get('/games/stress/active', async (request, reply) => {
    const query = activeQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_query' });
    reply.header('cache-control', 'no-store');
    return { session: await stressResume(db, userOf(request), query.data.sessionId ?? null) };
  });

  app.post('/games/stress/abandon', { config: limit(60) }, async (request, reply) => {
    const body = miniGameSessionRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    await abandonSession(db, 'stress', body.data.sessionId, userOf(request));
    return reply.code(204).send();
  });

  app.post('/games/stress/answer', { config: limit(120) }, async (request, reply) => {
    const body = stressAnswerRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const result = await answerStress(db, userOf(request), body.data);
    if (!result) return reply.code(404).send({ error: 'word_not_found' });
    return result;
  });

  app.post('/games/stress/finish', { config: limit(60) }, async (request, reply) => {
    const body = miniGameFinishRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const result = await finishStressSession(db, userOf(request), body.data.sessionId);
    if (!result) return reply.code(404).send({ error: 'session_not_found' });
    return result;
  });

  app.get('/games/stress/progress', async (request, reply) => {
    const userId = userOf(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    reply.header('cache-control', 'no-store');
    return stressProgress(db, userId);
  });

  // «Словарные слова и исключения» (docs/DICTIONARY_GAME.md).
  app.get('/games/dictionary/summary', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    return dictionarySummary(db, userOf(request));
  });

  // «Справочник»: the words of a task — open to everyone, like the lists themselves.
  app.get('/games/dictionary/reference/:task', async (request, reply) => {
    const task = dictionaryTask(Number((request.params as { task?: string }).task));
    if (!task) return reply.code(404).send({ error: 'task_not_found' });
    reply.header('cache-control', 'public, max-age=3600');
    return dictionaryReference(task);
  });

  app.get('/games/dictionary/round', { config: limit(60) }, async (request, reply) => {
    const query = dictionaryRoundQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_query' });
    const known = dictionaryKnown(query.data.task, query.data.category);
    if (known !== 'ok') return reply.code(404).send({ error: `${known}_not_found` });
    const userId = userOf(request);
    if (query.data.mode !== 'all' && !userId) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    reply.header('cache-control', 'no-store');
    try {
      return await dictionaryRound(db, userId, query.data);
    } catch (error) {
      if (error instanceof NotEnoughQuestionsError) {
        return reply.code(409).send({ error: 'not_enough_questions', available: error.available });
      }
      throw error;
    }
  });

  app.get('/games/dictionary/active', async (request, reply) => {
    const query = activeQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_query' });
    reply.header('cache-control', 'no-store');
    return { session: await dictionaryResume(db, userOf(request), query.data.sessionId ?? null) };
  });

  app.post('/games/dictionary/abandon', { config: limit(60) }, async (request, reply) => {
    const body = miniGameSessionRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    await abandonSession(db, DICTIONARY_GAME_ID, body.data.sessionId, userOf(request));
    return reply.code(204).send();
  });

  app.post('/games/dictionary/answer', { config: limit(120) }, async (request, reply) => {
    const body = dictionaryAnswerSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const result = await answerDictionary(db, userOf(request), body.data);
    if (!result) return reply.code(404).send({ error: 'item_not_found' });
    return result;
  });

  app.post('/games/dictionary/finish', { config: limit(60) }, async (request, reply) => {
    const body = miniGameFinishRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    const result = await finishDictionary(db, userOf(request), body.data.sessionId);
    if (!result) return reply.code(404).send({ error: 'session_not_found' });
    return result;
  });
};
