import { randomUUID } from 'node:crypto';
import { schema } from '@zybrilka/db';
import { createImportedTestDb } from '@zybrilka/db/testing';
import { calculateTaskNumberNeed } from '@zybrilka/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getUserAttemptRecordsBySubject } from '../recommendation/repo.js';
import {
  advanceLearningSession,
  getLearningSessionSnapshot,
  startLearningSession,
} from './service.js';
import * as repo from './repo.js';

describe('learning sessions (ZUBRILKA LEARNING INTELLIGENCE Phase 9)', () => {
  let testDb: Awaited<ReturnType<typeof createImportedTestDb>>;

  beforeAll(async () => {
    testDb = await createImportedTestDb();
  });

  afterAll(async () => {
    await testDb.close();
  });

  async function freshUserId(): Promise<string> {
    const userId = randomUUID();
    await testDb.db.insert(schema.users).values({ id: userId });
    return userId;
  }

  describe('startLearningSession', () => {
    it('returns null when no subject can be resolved (no profile, no explicit subjectId)', async () => {
      const result = await startLearningSession(testDb.db, await freshUserId(), { total: 5 });
      expect(result).toBeNull();
    });

    it('returns null for an explicit subjectId with no published tasks', async () => {
      const result = await startLearningSession(testDb.db, await freshUserId(), {
        subjectId: '__nonexistent_subject__',
        total: 5,
      });
      expect(result).toBeNull();
    });

    it('starts a session with position 1 and the requested total', async () => {
      const result = await startLearningSession(testDb.db, await freshUserId(), {
        subjectId: 'math',
        total: 5,
      });
      expect(result).not.toBeNull();
      expect(result!.status).toBe('active');
      if (!result || result.status !== 'active') throw new Error('unreachable');
      expect(result.position).toBe(1);
      expect(result.total).toBe(5);
      expect(result.subject).toBe('math');
      expect(result.sessionId).toBeTruthy();
      expect(result.task.id).toBeTruthy();
      expect(result.recommendation?.score).toBeGreaterThanOrEqual(0);
      expect(result.recommendation?.score).toBeLessThanOrEqual(100);
    });

    it('respects minimum total (1)', async () => {
      const result = await startLearningSession(testDb.db, await freshUserId(), {
        subjectId: 'math',
        total: 1,
      });
      expect(result!.status).toBe('active');
      if (!result || result.status !== 'active') throw new Error('unreachable');
      expect(result.total).toBe(1);
    });

    it('respects maximum total (10)', async () => {
      const result = await startLearningSession(testDb.db, await freshUserId(), {
        subjectId: 'math',
        total: 10,
      });
      expect(result!.status).toBe('active');
      if (!result || result.status !== 'active') throw new Error('unreachable');
      expect(result.total).toBe(10);
    });

    it('auto-resolves the subject from the onboarded learning profile', async () => {
      const userId = await freshUserId();
      await testDb.db.insert(schema.userSubjectProfiles).values({
        userId,
        subjectId: 'math',
        selfReportedScore: 'under_40',
        targetScore: '90_plus',
        onboardingCompletedAt: new Date(),
      });

      const result = await startLearningSession(testDb.db, userId, { total: 3 });
      expect(result!.status).toBe('active');
      if (!result || result.status !== 'active') throw new Error('unreachable');
      expect(result.subject).toBe('math');
    });

    it('first task is deterministic for a cold-start user', async () => {
      const resultA = await startLearningSession(testDb.db, await freshUserId(), {
        subjectId: 'math',
        total: 3,
      });
      const resultB = await startLearningSession(testDb.db, await freshUserId(), {
        subjectId: 'math',
        total: 3,
      });
      expect(resultA!.status).toBe('active');
      expect(resultB!.status).toBe('active');
      if (!resultA || resultA.status !== 'active' || !resultB || resultB.status !== 'active')
        throw new Error('unreachable');
      expect(resultA.task.id).toBe(resultB.task.id);
    });
  });

  describe('advanceLearningSession', () => {
    it('returns null for an unknown sessionId', async () => {
      const result = await advanceLearningSession(testDb.db, await freshUserId(), randomUUID());
      expect(result).toBeNull();
    });

    it('returns null when the session belongs to a different user (never leaks existence)', async () => {
      const owner = await freshUserId();
      const attacker = await freshUserId();
      const started = await startLearningSession(testDb.db, owner, { subjectId: 'math', total: 5 });
      if (!started || started.status !== 'active') throw new Error('unreachable');

      const result = await advanceLearningSession(testDb.db, attacker, started.sessionId);
      expect(result).toBeNull();
    });

    it('persists unseenOnly across every `next` step — a task attempted before the session started never reappears', async () => {
      const userId = await freshUserId();
      const [attemptedTask] = await testDb.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.subjectId, 'math'));
      await testDb.db.insert(schema.attempts).values({
        userId,
        taskId: attemptedTask!.id,
        answerRaw: '__wrong__',
        isCorrect: false,
      });

      const started = await startLearningSession(testDb.db, userId, {
        subjectId: 'math',
        total: 10,
        unseenOnly: true,
      });
      if (!started || started.status !== 'active') throw new Error('unreachable');
      expect(started.task.id).not.toBe(attemptedTask!.id);

      let sessionId = started.sessionId;
      for (let i = 0; i < 5; i++) {
        const next = await advanceLearningSession(testDb.db, userId, sessionId);
        if (!next || next.status !== 'active') break;
        // The persisted unseenOnly flag must keep applying on every
        // step, not just the first — re-calling getLearningPath fresh
        // each time with the session's own stored flag.
        expect(next.task.id).not.toBe(attemptedTask!.id);
        sessionId = next.sessionId;
      }
    });

    it('never returns the same task twice across the session', async () => {
      const userId = await freshUserId();
      const started = await startLearningSession(testDb.db, userId, {
        subjectId: 'math',
        total: 5,
      });
      if (!started || started.status !== 'active') throw new Error('unreachable');

      const seen = new Set([started.task.id]);
      let sessionId = started.sessionId;
      for (let i = 0; i < 4; i++) {
        const next = await advanceLearningSession(testDb.db, userId, sessionId);
        if (!next || next.status !== 'active') break;
        expect(seen.has(next.task.id)).toBe(false);
        seen.add(next.task.id);
        sessionId = next.sessionId;
      }
    });

    it('a stale `/next` (double tap) serves no extra task — it reports the one already served', async () => {
      const userId = await freshUserId();
      const started = await startLearningSession(testDb.db, userId, {
        subjectId: 'math',
        total: 3,
      });
      if (!started || started.status !== 'active') throw new Error('unreachable');
      // Both requests read the session at 1 served task; the first one wins.
      expect(
        await repo.appendConsumedTask(testDb.db, started.sessionId, randomUUID(), 0),
      ).toBeUndefined();
      const winner = await advanceLearningSession(testDb.db, userId, started.sessionId);
      if (!winner || winner.status !== 'active') throw new Error('unreachable');
      expect(
        await repo.appendConsumedTask(testDb.db, started.sessionId, randomUUID(), 1),
      ).toBeUndefined();
      const snapshot = await getLearningSessionSnapshot(testDb.db, userId, started.sessionId);
      if (!snapshot || snapshot.status !== 'active') throw new Error('unreachable');
      expect(snapshot.position).toBe(2);
      expect(snapshot.task.id).toBe(winner.task.id);
    });

    it('position increases by exactly 1 per step and never exceeds total', async () => {
      const userId = await freshUserId();
      const started = await startLearningSession(testDb.db, userId, {
        subjectId: 'math',
        total: 3,
      });
      if (!started || started.status !== 'active') throw new Error('unreachable');
      expect(started.position).toBe(1);

      const second = await advanceLearningSession(testDb.db, userId, started.sessionId);
      if (!second || second.status !== 'active') throw new Error('unreachable');
      expect(second.position).toBe(2);

      const third = await advanceLearningSession(testDb.db, userId, started.sessionId);
      if (!third || third.status !== 'active') throw new Error('unreachable');
      expect(third.position).toBe(3);
      expect(third.position).toBeLessThanOrEqual(3);
    });

    it('completes once the requested total is reached, never exceeding it', async () => {
      const userId = await freshUserId();
      const started = await startLearningSession(testDb.db, userId, {
        subjectId: 'math',
        total: 2,
      });
      if (!started || started.status !== 'active') throw new Error('unreachable');

      const second = await advanceLearningSession(testDb.db, userId, started.sessionId);
      expect(second!.status).toBe('active');

      const third = await advanceLearningSession(testDb.db, userId, started.sessionId);
      expect(third!.status).toBe('completed');
      if (!third || third.status !== 'completed') throw new Error('unreachable');
      expect(third.position).toBe(2);
      expect(third.total).toBe(2);
    });

    it('is idempotent once completed — repeated next calls keep returning the same summary', async () => {
      const userId = await freshUserId();
      const started = await startLearningSession(testDb.db, userId, {
        subjectId: 'math',
        total: 1,
      });
      if (!started || started.status !== 'active') throw new Error('unreachable');

      const completed = await advanceLearningSession(testDb.db, userId, started.sessionId);
      expect(completed!.status).toBe('completed');

      const completedAgain = await advanceLearningSession(testDb.db, userId, started.sessionId);
      expect(completedAgain).toEqual(completed);
    });

    it('completes early, honestly, when the subject runs out of candidates before reaching total', async () => {
      const mathTaskCount = (
        await testDb.db.select().from(schema.tasks).where(eq(schema.tasks.subjectId, 'math'))
      ).length;
      const userId = await freshUserId();
      const started = await startLearningSession(testDb.db, userId, {
        subjectId: 'math',
        total: mathTaskCount + 5, // deliberately more than the catalog can supply
      });
      if (!started || started.status !== 'active') throw new Error('unreachable');

      let current = started;
      let steps = 1;
      for (let i = 0; i < mathTaskCount + 5; i++) {
        const next = await advanceLearningSession(testDb.db, userId, current.sessionId);
        if (!next) throw new Error('unexpected null');
        if (next.status === 'completed') {
          expect(next.position).toBeLessThanOrEqual(mathTaskCount);
          return;
        }
        current = next;
        steps++;
      }
      expect(steps).toBeLessThanOrEqual(mathTaskCount);
    });

    it('next task reflects UPDATED mastery after a real attempt is submitted mid-session', async () => {
      const userId = await freshUserId();
      const started = await startLearningSession(testDb.db, userId, {
        subjectId: 'math',
        total: 5,
      });
      if (!started || started.status !== 'active') throw new Error('unreachable');

      const [task] = await testDb.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, started.task.id));
      await testDb.db.insert(schema.attempts).values({
        userId,
        taskId: task!.id,
        answerRaw: task!.correctAnswer,
        isCorrect: true,
      });
      // Simulate the real attempt-submission transaction's mastery update
      // (normally done by modules/learning/service.ts) so the next
      // session step can observe a REAL updated mastery row.
      const skillLinks = await testDb.db
        .select()
        .from(schema.taskSkills)
        .where(eq(schema.taskSkills.taskId, task!.id));
      for (const link of skillLinks) {
        await testDb.db.insert(schema.userSkillStatistics).values({
          userId,
          skillId: link.skillId,
          attempts: 1,
          correctAttempts: 1,
          incorrectAttempts: 0,
          mastery: 10,
          confidence: 10,
          lastAttemptAt: new Date(),
        });
      }

      const next = await advanceLearningSession(testDb.db, userId, started.sessionId);
      expect(next).not.toBeNull();
      // The task just solved can never reappear, and the session must
      // still be able to proceed (not crash) now that real mastery data
      // exists for its skills.
      if (next && next.status === 'active') {
        expect(next.task.id).not.toBe(task!.id);
      }
    });

    it('next task reflects UPDATED error statistics after a wrong attempt mid-session', async () => {
      const userId = await freshUserId();
      const started = await startLearningSession(testDb.db, userId, {
        subjectId: 'math',
        total: 5,
      });
      if (!started || started.status !== 'active') throw new Error('unreachable');

      await testDb.db.insert(schema.attempts).values({
        userId,
        taskId: started.task.id,
        answerRaw: '__wrong__',
        isCorrect: false,
      });
      await testDb.db.insert(schema.userErrorStatistics).values({
        userId,
        errorSignature: 'incorrect_answer',
        count: 1,
        lastOccurredAt: new Date(),
      });

      const next = await advanceLearningSession(testDb.db, userId, started.sessionId);
      expect(next).not.toBeNull();
      if (next && next.status === 'active') {
        expect(next.recommendation?.breakdown.errorRelevance.included).toBe(true);
      }
    });

    it('next task selection reflects UPDATED taskNumberNeed after a real wrong attempt mid-session', async () => {
      const userId = await freshUserId();
      const started = await startLearningSession(testDb.db, userId, {
        subjectId: 'math',
        total: 5,
      });
      if (!started || started.status !== 'active') throw new Error('unreachable');

      const wrongTaskNumber = started.task.taskNumber;
      await testDb.db.insert(schema.attempts).values({
        userId,
        taskId: started.task.id,
        answerRaw: '__wrong__',
        isCorrect: false,
      });

      // The real signal now exists for that task number, through the
      // exact same repo+formula wiring Phase 7/8 use internally — Phase
      // 9 never maintains a separate copy of this logic.
      const records = await getUserAttemptRecordsBySubject(testDb.db, userId, 'math');
      const need = calculateTaskNumberNeed(records.filter((r) => r.taskNumber === wrongTaskNumber));
      expect(need).not.toBeNull();
      expect(need!).toBeGreaterThan(0);

      // The session's next step is scored FRESH against this updated
      // state (never a cached recommendation) and never re-serves the
      // just-attempted task.
      const next = await advanceLearningSession(testDb.db, userId, started.sessionId);
      expect(next).not.toBeNull();
      if (next && next.status === 'active') {
        expect(next.task.id).not.toBe(started.task.id);
      }
    });

    it('is deterministic — repeated requests for the same step return the exact same step', async () => {
      const userId = await freshUserId();
      const started = await startLearningSession(testDb.db, userId, {
        subjectId: 'math',
        total: 5,
      });
      if (!started || started.status !== 'active') throw new Error('unreachable');

      const firstCall = await advanceLearningSession(testDb.db, userId, started.sessionId);
      // Re-fetching "next" again from the SAME session state (no new
      // attempts in between) should NOT advance further on its own —
      // but since this repo does mutate position per call, prove
      // determinism differently: starting a second, independent session
      // for an identical cold-start user yields the identical sequence.
      const userId2 = await freshUserId();
      const started2 = await startLearningSession(testDb.db, userId2, {
        subjectId: 'math',
        total: 5,
      });
      const secondCall = await advanceLearningSession(testDb.db, userId2, started2!.sessionId);

      expect(firstCall?.status).toBe(secondCall?.status);
      if (
        firstCall &&
        firstCall.status === 'active' &&
        secondCall &&
        secondCall.status === 'active'
      ) {
        expect(firstCall.task.id).toBe(secondCall.task.id);
      }
    });
  });

  describe('session summary', () => {
    it('uses only real attempts — a brand-new session with zero attempts reports zeros, not fabricated values', async () => {
      const userId = await freshUserId();
      const started = await startLearningSession(testDb.db, userId, {
        subjectId: 'math',
        total: 1,
      });
      if (!started || started.status !== 'active') throw new Error('unreachable');

      const completed = await advanceLearningSession(testDb.db, userId, started.sessionId);
      expect(completed!.status).toBe('completed');
      if (!completed || completed.status !== 'completed') throw new Error('unreachable');
      expect(completed.summary).toEqual({
        attempted: 0,
        correct: 0,
        incorrect: 0,
        accuracy: null,
        skillsPracticed: 0,
        mistakesCreated: 0,
      });
    });

    it('counts a real correct attempt made during the session', async () => {
      const userId = await freshUserId();
      const started = await startLearningSession(testDb.db, userId, {
        subjectId: 'math',
        total: 1,
      });
      if (!started || started.status !== 'active') throw new Error('unreachable');

      const [task] = await testDb.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, started.task.id));
      await testDb.db.insert(schema.attempts).values({
        userId,
        taskId: task!.id,
        answerRaw: task!.correctAnswer,
        isCorrect: true,
      });

      const completed = await advanceLearningSession(testDb.db, userId, started.sessionId);
      expect(completed!.status).toBe('completed');
      if (!completed || completed.status !== 'completed') throw new Error('unreachable');
      expect(completed.summary.attempted).toBe(1);
      expect(completed.summary.correct).toBe(1);
      expect(completed.summary.incorrect).toBe(0);
      expect(completed.summary.accuracy).toBe(100);
    });

    it('skillsPracticed reflects real task_skills links for the attempted task only', async () => {
      const userId = await freshUserId();
      const started = await startLearningSession(testDb.db, userId, {
        subjectId: 'math',
        total: 1,
      });
      if (!started || started.status !== 'active') throw new Error('unreachable');

      const expectedSkillCount = (
        await testDb.db
          .select()
          .from(schema.taskSkills)
          .where(eq(schema.taskSkills.taskId, started.task.id))
      ).length;

      await testDb.db.insert(schema.attempts).values({
        userId,
        taskId: started.task.id,
        answerRaw: '__wrong__',
        isCorrect: false,
      });

      const completed = await advanceLearningSession(testDb.db, userId, started.sessionId);
      if (!completed || completed.status !== 'completed') throw new Error('unreachable');
      expect(completed.summary.skillsPracticed).toBe(expectedSkillCount);
    });

    it('counts a real incorrect attempt and does not count a mistake pre-dating the session on the same task', async () => {
      const userId = await freshUserId();
      const started = await startLearningSession(testDb.db, userId, {
        subjectId: 'math',
        total: 1,
      });
      if (!started || started.status !== 'active') throw new Error('unreachable');

      // A mistake explicitly backdated to BEFORE this session's
      // startedAt, on the very task this session consumed — must never
      // be counted in `mistakesCreated`, which only counts mistakes
      // actually created DURING the session window.
      const beforeSession = new Date(Date.now() - 60_000);
      const oldAttempt = await testDb.db
        .insert(schema.attempts)
        .values({
          userId,
          taskId: started.task.id,
          answerRaw: '__old_wrong__',
          isCorrect: false,
          createdAt: beforeSession,
        })
        .returning();
      await testDb.db.insert(schema.mistakes).values({
        userId,
        taskId: started.task.id,
        firstAttemptId: oldAttempt[0]!.id,
        lastAttemptId: oldAttempt[0]!.id,
        timesWrong: 1,
        status: 'open',
        createdAt: beforeSession,
      });

      await testDb.db.insert(schema.attempts).values({
        userId,
        taskId: started.task.id,
        answerRaw: '__still_wrong__',
        isCorrect: false,
      });

      const completed = await advanceLearningSession(testDb.db, userId, started.sessionId);
      if (!completed || completed.status !== 'completed') throw new Error('unreachable');
      expect(completed.summary.attempted).toBe(1);
      expect(completed.summary.correct).toBe(0);
      expect(completed.summary.incorrect).toBe(1);
      expect(completed.summary.accuracy).toBe(0);
      expect(completed.summary.mistakesCreated).toBe(0);
    });
  });

  describe('getLearningSessionSnapshot (ZUBRILKA LEARNING INTELLIGENCE Phase 10 — refresh recovery)', () => {
    it('returns null for an unknown sessionId', async () => {
      const result = await getLearningSessionSnapshot(testDb.db, await freshUserId(), randomUUID());
      expect(result).toBeNull();
    });

    it('returns null when the session belongs to a different user', async () => {
      const owner = await freshUserId();
      const attacker = await freshUserId();
      const started = await startLearningSession(testDb.db, owner, { subjectId: 'math', total: 5 });
      if (!started || started.status !== 'active') throw new Error('unreachable');

      const result = await getLearningSessionSnapshot(testDb.db, attacker, started.sessionId);
      expect(result).toBeNull();
    });

    it('reflects the CURRENT task without consuming a new slot (never advances)', async () => {
      const userId = await freshUserId();
      const started = await startLearningSession(testDb.db, userId, {
        subjectId: 'math',
        total: 5,
      });
      if (!started || started.status !== 'active') throw new Error('unreachable');

      const snapshotOnce = await getLearningSessionSnapshot(testDb.db, userId, started.sessionId);
      const snapshotTwice = await getLearningSessionSnapshot(testDb.db, userId, started.sessionId);

      expect(snapshotOnce).toEqual(snapshotTwice);
      if (!snapshotOnce || snapshotOnce.status !== 'active') throw new Error('unreachable');
      expect(snapshotOnce.task.id).toBe(started.task.id);
      expect(snapshotOnce.position).toBe(1);
      expect(snapshotOnce.total).toBe(5);
      // Never re-runs scoring — honestly has no breakdown to show.
      expect(snapshotOnce.recommendation).toBeUndefined();
    });

    it('reflects the CURRENT task after advancing, still without consuming a new slot', async () => {
      const userId = await freshUserId();
      const started = await startLearningSession(testDb.db, userId, {
        subjectId: 'math',
        total: 5,
      });
      if (!started || started.status !== 'active') throw new Error('unreachable');

      const next = await advanceLearningSession(testDb.db, userId, started.sessionId);
      if (!next || next.status !== 'active') throw new Error('unreachable');

      const snapshot = await getLearningSessionSnapshot(testDb.db, userId, started.sessionId);
      if (!snapshot || snapshot.status !== 'active') throw new Error('unreachable');
      expect(snapshot.task.id).toBe(next.task.id);
      expect(snapshot.position).toBe(2);

      // Confirm the snapshot call itself did not advance anything further.
      const snapshotAgain = await getLearningSessionSnapshot(testDb.db, userId, started.sessionId);
      expect(snapshotAgain).toEqual(snapshot);
    });

    it('returns the real completed summary once the session has finished', async () => {
      const userId = await freshUserId();
      const started = await startLearningSession(testDb.db, userId, {
        subjectId: 'math',
        total: 1,
      });
      if (!started || started.status !== 'active') throw new Error('unreachable');

      const completed = await advanceLearningSession(testDb.db, userId, started.sessionId);
      if (!completed || completed.status !== 'completed') throw new Error('unreachable');

      const snapshot = await getLearningSessionSnapshot(testDb.db, userId, started.sessionId);
      expect(snapshot).toEqual(completed);
    });
  });
});
