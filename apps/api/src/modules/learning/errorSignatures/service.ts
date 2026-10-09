import type { Database } from '@zybrilka/db';
import {
  detectErrorSignatures,
  gradeMultiPart,
  parseMultiPartSpec,
  parseMultiPartUserAnswer,
  type DetectErrorSignaturesInput,
  type UserErrorStatisticEntry,
} from '@zybrilka/shared';
import * as repo from './repo.js';

/**
 * Records every error signature `detectErrorSignatures` finds for one
 * attempt, incrementing each by 1. A correct answer detects zero
 * signatures and writes nothing. Called from the same transaction as
 * attempt creation (see `modules/tasks/service.ts`) — never a second,
 * independent write path.
 */
export async function recordErrorSignaturesForAttempt(
  db: Database,
  userId: string,
  input: DetectErrorSignaturesInput,
  occurredAt: Date,
): Promise<void> {
  const signatures = detectErrorSignatures(input);
  for (const sig of signatures) {
    await repo.incrementUserErrorStatistic(db, userId, sig.code, occurredAt);
  }
}

/**
 * Rebuilds `detectErrorSignaturesInput` for an attempt that was loaded
 * back from storage rather than built live during `submitAttempt` —
 * for `multi_part` this means re-parsing the stored JSON and re-running
 * `gradeMultiPart`, exactly like `submitAttempt` does when the attempt
 * is first created, so a rebuild reproduces identical signatures.
 */
/** Exported for Statistics 2.0's per-task-number error breakdown
 * (`apps/api/src/modules/progress/service.ts`), which re-runs detection
 * scoped to one task number instead of reading the global per-user
 * `user_error_statistics` table — same deterministic function, just a
 * narrower input set. */
export function buildDetectionInput(
  attempt: repo.AttemptForErrorDetection,
): DetectErrorSignaturesInput {
  if (attempt.answerType === 'multi_part') {
    const spec = parseMultiPartSpec(attempt.correctAnswer);
    const userAnswers = parseMultiPartUserAnswer(attempt.answerRaw);
    if (spec && userAnswers) {
      const grading = gradeMultiPart(spec, userAnswers);
      return {
        answerType: 'multi_part',
        isCorrect: attempt.isCorrect,
        answerRaw: attempt.answerRaw,
        correctAnswer: attempt.correctAnswer,
        multiPart: { grading, userAnswers },
      };
    }
    // Malformed stored JSON (shouldn't happen — submitAttempt validates
    // shape before writing) — fall through to the generic path so
    // rebuild never crashes on bad historical data.
    return {
      answerType: 'multi_part',
      isCorrect: attempt.isCorrect,
      answerRaw: attempt.answerRaw,
      correctAnswer: attempt.correctAnswer,
    };
  }

  // 'essay' attempts are never written — submitAttempt rejects them
  // before any attempt row is created (see EssayNotGradableError) — so
  // this is unreachable in practice. Guarded rather than widening
  // DetectableAnswerType, which every other error-detection rule is
  // written against.
  if (attempt.answerType === 'essay') {
    throw new Error('unreachable: no attempt should ever be stored for an essay task');
  }

  return {
    answerType: attempt.answerType,
    isCorrect: attempt.isCorrect,
    answerRaw: attempt.answerRaw,
    correctAnswer: attempt.correctAnswer,
  };
}

/**
 * Deterministic, idempotent recompute of one user's full error profile
 * straight from `attempts` — deletes the existing rows first, then
 * replays every historical attempt through the exact same detection
 * function `recordErrorSignaturesForAttempt` uses live. Running it
 * twice in a row with no new attempts in between produces identical
 * totals.
 */
export async function rebuildUserErrorStatistics(
  db: Database,
  userId: string,
): Promise<{ signaturesRecorded: number }> {
  await repo.deleteUserErrorStatistics(db, userId);

  const attempts = await repo.getAttemptsForErrorDetection(db, userId);
  let signaturesRecorded = 0;
  for (const attempt of attempts) {
    const input = buildDetectionInput(attempt);
    const signatures = detectErrorSignatures(input);
    for (const sig of signatures) {
      await repo.incrementUserErrorStatistic(db, userId, sig.code, attempt.createdAt);
      signaturesRecorded++;
    }
  }
  return { signaturesRecorded };
}

export async function getUserErrorStatistics(
  db: Database,
  userId: string,
): Promise<UserErrorStatisticEntry[]> {
  const rows = await repo.getUserErrorStatistics(db, userId);
  return rows.map((row) => ({
    errorSignature: row.errorSignature,
    count: row.count,
    lastOccurredAt: row.lastOccurredAt ? row.lastOccurredAt.toISOString() : null,
  }));
}
