import type { Database } from '@zybrilka/db';
import {
  MINI_GAMES,
  miniGameFinishRequestSchema,
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
import {
  answerStress,
  finishStressSession,
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
  quizRound,
  quizSummaries,
} from './quiz.js';

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
    const [stress, quiz, stressTotal] = await Promise.all([
      userId ? stressSummary(db, userId) : null,
      userId ? quizSummaries(db, userId) : null,
      userId ? null : stressCount(db),
    ]);
    const games = await Promise.all(
      MINI_GAMES.map(async (g) => {
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
    return quizRound(db, userId, gameId, query.data.mode, query.data.size);
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
    const ok = await finishQuiz(
      db,
      userOf(request),
      gameId,
      body.data.sessionId,
      body.data.firstTryCorrect ?? null,
    );
    if (!ok) return reply.code(404).send({ error: 'session_not_found' });
    return reply.code(204).send();
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
    return stressRound(db, userId, query.data.mode, query.data.size);
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
    const ok = await finishStressSession(
      db,
      userOf(request),
      body.data.sessionId,
      body.data.firstTryCorrect ?? null,
    );
    if (!ok) return reply.code(404).send({ error: 'session_not_found' });
    return reply.code(204).send();
  });

  app.get('/games/stress/progress', async (request, reply) => {
    const userId = userOf(request);
    if (!userId) return reply.code(401).send({ error: 'unauthorized' });
    reply.header('cache-control', 'no-store');
    return stressProgress(db, userId);
  });
};
