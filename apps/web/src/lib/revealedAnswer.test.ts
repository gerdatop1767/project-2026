import { describe, expect, it } from 'vitest';
import type { TaskPublic, TaskWithSolution } from '@zybrilka/shared';
import { withRevealedAnswer } from './revealedAnswer.js';

const base = { id: 't1', conditionMd: 'x' } as unknown as TaskPublic;

describe('withRevealedAnswer (a guest sees the answer of the check they just did)', () => {
  it("fills a public task's answer and explanation from the check response", () => {
    const task = withRevealedAnswer(base, {
      correctAnswer: '-2/3',
      correctAnswerDisplay: null,
      explanation: 'Разбор',
    });
    expect(task).toMatchObject({
      correctAnswer: '-2/3',
      explanationMd: 'Разбор',
      solutionSteps: null,
    });
  });

  it('never overrides a task that already carries its solution (signed-in users)', () => {
    const full = {
      ...base,
      correctAnswer: '5',
      correctAnswerDisplay: null,
      explanationMd: 'A',
    } as unknown as TaskWithSolution;
    expect(
      withRevealedAnswer(full, {
        correctAnswer: '9',
        correctAnswerDisplay: null,
        explanation: 'B',
      }),
    ).toBe(full);
    expect(withRevealedAnswer(base, undefined)).toBe(base);
  });
});
