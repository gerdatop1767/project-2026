import type { VariantAttemptDetail, VariantAttemptTask } from '@zybrilka/shared';

export const attemptTask = (
  position: number,
  over: Partial<VariantAttemptTask> = {},
): VariantAttemptTask => ({
  position,
  taskId: `task-${position}`,
  taskNumber: position,
  topic: position % 2 ? 'Логарифмы' : null,
  outcome: 'correct',
  userAnswer: '5',
  correctAnswer: '5',
  explanationMd: `Разбор задания ${position}`,
  answers: 1,
  timeSpentMs: 60_000,
  ...over,
});

export const attemptDetail = (over: Partial<VariantAttemptDetail> = {}): VariantAttemptDetail => ({
  sessionId: '11111111-1111-4111-8111-111111111111',
  variantId: 'v1',
  variantNumber: 1,
  variantTitle: 'Вариант 1',
  subjectId: 'math',
  status: 'completed',
  startedAt: '2026-10-24T10:00:00.000Z',
  completedAt: '2026-10-24T11:00:00.000Z',
  attribution: 'exact',
  plannedCount: 4,
  correctCount: 2,
  incorrectCount: 1,
  skippedCount: 1,
  notReachedCount: 0,
  accuracyPercent: 67,
  totalTimeMs: 180_000,
  timedCount: 3,
  byTaskNumber: [
    { key: '1', correct: 1, total: 1 },
    { key: '2', correct: 1, total: 1 },
    { key: '3', correct: 0, total: 1 },
    { key: '4', correct: 0, total: 1 },
  ],
  byTopic: [{ key: 'Логарифмы', correct: 1, total: 2 }],
  tasks: [
    attemptTask(1),
    attemptTask(2),
    attemptTask(3, { outcome: 'incorrect', userAnswer: '7', answers: 2 }),
    attemptTask(4, { outcome: 'skipped', userAnswer: null, timeSpentMs: null }),
  ],
  toRepeat: [
    { taskId: 'task-3', taskNumber: 3, topic: 'Логарифмы' },
    { taskId: 'task-4', taskNumber: 4, topic: null },
  ],
  ...over,
});
