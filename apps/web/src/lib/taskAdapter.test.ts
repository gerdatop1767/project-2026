import { describe, expect, it } from 'vitest';
import {
  buildSessionProgress,
  explanationForPart,
  splitMultiPartExplanation,
  toSampleTask,
} from './taskAdapter.js';
import type { TaskWithSolution } from '@zybrilka/shared';

describe('splitMultiPartExplanation', () => {
  it('splits on ### headings, trimming heading and body', () => {
    const sections = splitMultiPartExplanation('### А\nТекст А.\n\n### Б и В\nТекст Б и В.');
    expect(sections).toEqual([
      { heading: 'А', text: 'Текст А.' },
      { heading: 'Б и В', text: 'Текст Б и В.' },
    ]);
  });

  it('keeps a multi-word heading intact, not truncated to its first character', () => {
    const sections = splitMultiPartExplanation('### Многословный заголовок\nТело.');
    expect(sections[0]!.heading).toBe('Многословный заголовок');
  });

  it('falls back to one unheaded section when there are no ### markers', () => {
    const sections = splitMultiPartExplanation('Обычное объяснение без частей.');
    expect(sections).toEqual([{ heading: '', text: 'Обычное объяснение без частей.' }]);
  });
});

describe('explanationForPart', () => {
  const sections = [
    { heading: 'А', text: 'Текст А.' },
    { heading: 'Б и В', text: 'Текст Б и В.' },
  ];

  it('matches a section whose heading contains the part label, case-insensitively', () => {
    expect(explanationForPart(sections, 'а')).toBe('Текст А.');
  });

  it('matches a shared heading for more than one part label', () => {
    expect(explanationForPart(sections, 'б')).toBe('Текст Б и В.');
    expect(explanationForPart(sections, 'в')).toBe('Текст Б и В.');
  });

  it('falls back to every section joined when no heading names the part', () => {
    expect(explanationForPart(sections, 'г')).toBe('Текст А.\n\nТекст Б и В.');
  });
});

/**
 * Navigation bugfix regression: `indexInSession`/`totalInSession`/
 * `sessionTasks` must come from the REAL current list
 * (useTaskNavigation's `orderedTasks`), never from `listTasksByNumber`'s
 * cross-source same-number siblings — see taskAdapter.ts's doc comment
 * and the nav bugfix report for the full story (every single task open
 * used to show a fake "Задание K из 5" the moment Вариант 5 landed,
 * since every task number then had exactly 5 same-numbered siblings
 * across sources).
 */
describe('buildSessionProgress', () => {
  it('reflects a real 5-task list — total is 5, not inflated to 19 or shrunk to 1', () => {
    const orderedTasks = [
      { taskId: 'a', taskNumber: 3 },
      { taskId: 'b', taskNumber: 17 },
      { taskId: 'c', taskNumber: 9 },
      { taskId: 'd', taskNumber: 2 },
      { taskId: 'e', taskNumber: 5 },
    ];
    const progress = buildSessionProgress('c', orderedTasks);
    expect(progress.totalInSession).toBe(5);
    expect(progress.indexInSession).toBe(3);
  });

  it('reflects a real 19-task list — total is 19, current index matches position', () => {
    const orderedTasks = Array.from({ length: 19 }, (_, i) => ({
      taskId: `task-${i + 1}`,
      taskNumber: i + 1,
    }));
    const progress = buildSessionProgress('task-13', orderedTasks);
    expect(progress.totalInSession).toBe(19);
    expect(progress.indexInSession).toBe(13);
  });

  it('the current task is never duplicated in place of the real sequence — sessionTasks has one entry per real list item', () => {
    const orderedTasks = [
      { taskId: 'a', taskNumber: 1 },
      { taskId: 'b', taskNumber: 2 },
      { taskId: 'c', taskNumber: 3 },
    ];
    const progress = buildSessionProgress('b', orderedTasks);
    expect(progress.sessionTasks).toEqual([
      { index: 1, status: 'pending' },
      { index: 2, status: 'current' },
      { index: 3, status: 'pending' },
    ]);
    // Exactly one 'current' entry — never every entry collapsing to
    // the same status/number.
    expect(progress.sessionTasks.filter((t) => t.status === 'current')).toHaveLength(1);
  });

  it('falls back to a single-item "1 of 1" when there is no real list (e.g. opened via Темы/Мои ошибки)', () => {
    const progress = buildSessionProgress('solo', []);
    expect(progress.indexInSession).toBe(1);
    expect(progress.totalInSession).toBe(1);
    expect(progress.sessionTasks).toEqual([{ index: 1, status: 'current' }]);
  });

  it('identifies the current task by taskId, never by taskNumber — two different tasks sharing a number are not confused', () => {
    const orderedTasks = [
      { taskId: 'v1-task7', taskNumber: 7 },
      { taskId: 'v2-task7', taskNumber: 7 },
    ];
    const progress = buildSessionProgress('v2-task7', orderedTasks);
    expect(progress.indexInSession).toBe(2);
    expect(progress.sessionTasks).toEqual([
      { index: 1, status: 'pending' },
      { index: 2, status: 'current' },
    ]);
  });
});

/**
 * Bugfix: `otherVariants[].preview` ("Другие задания" / Similar Tasks
 * card content) used to be `conditionMd.slice(0, 60)` — a fixed
 * character cut that can land mid-`$...$` span, leaving an unbalanced
 * `$` the math renderer can't tokenize, so it fell back to showing the
 * raw LaTeX source as plain text (confirmed in production: "a) Решите
 * уравнение $\sqrt{4\sin^3x - 4\cos^2x} - \cos x - \s"). It must now
 * carry the FULL condition — the card component clamps it visually
 * with CSS instead, after InlineMathText has rendered every `$...$`
 * span completely.
 */
describe('toSampleTask — otherVariants preview (Similar Tasks raw-LaTeX bugfix)', () => {
  const task: TaskWithSolution = {
    id: 'task-1',
    subjectId: 'math',
    taskNumber: 13,
    topicId: null,
    topicName: null,
    difficulty: 3,
    conditionMd: 'Условие основного задания.',
    imageUrl: null,
    hintMd: null,
    answerType: 'short_answer',
    answerOptions: null,
    answerParts: null,
    source: 'Ященко',
    sourceUrl: null,
    sourceYear: 2026,
    tags: [],
    status: 'published',
    correctAnswer: '42',
    correctAnswerDisplay: null,
    explanationMd: 'Объяснение.',
    solutionSteps: null,
  };

  const LONG_LATEX_CONDITION =
    'а) Решите уравнение $\\sqrt{4\\sin^3x - 4\\cos^2x} - \\cos x - \\sin x = 0$ на отрезке.';

  it('never truncates the sibling condition to a fixed character count', () => {
    const sibling = { ...task, id: 'task-2', conditionMd: LONG_LATEX_CONDITION };
    const sample = toSampleTask(task, [task, sibling]);
    expect(sample.otherVariants[0]!.preview).toBe(LONG_LATEX_CONDITION);
    expect(sample.otherVariants[0]!.preview.length).toBeGreaterThan(60);
  });

  it('keeps every $...$ span balanced (never cuts a LaTeX command mid-way)', () => {
    const sibling = { ...task, id: 'task-2', conditionMd: LONG_LATEX_CONDITION };
    const sample = toSampleTask(task, [task, sibling]);
    const dollarCount = (sample.otherVariants[0]!.preview.match(/\$/g) ?? []).length;
    expect(dollarCount % 2).toBe(0);
  });
});
