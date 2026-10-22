import type { TaskPublic, TaskWithSolution } from '@zybrilka/shared';
import type { RevealedAnswer } from './navigation.js';

/**
 * The server reveals a task's answer only to someone with an attempt on
 * record. A guest's answer is checked but never recorded, so re-fetching
 * the task gives no answer — the check response's own answer and
 * explanation (`revealed`, same server, one request earlier) fill it in.
 * A task that already carries its solution is left exactly as it is.
 */
export function withRevealedAnswer(
  task: TaskPublic | TaskWithSolution,
  revealed: RevealedAnswer | undefined,
): TaskPublic | TaskWithSolution {
  if (!revealed || 'correctAnswer' in task) return task;
  return {
    ...task,
    correctAnswer: revealed.correctAnswer,
    correctAnswerDisplay: revealed.correctAnswerDisplay,
    explanationMd: revealed.explanation,
    solutionSteps: null,
  };
}
