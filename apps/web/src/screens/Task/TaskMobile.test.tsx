import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskMobile } from './TaskMobile.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import { StreakProvider } from '../../lib/streakContext.js';
import * as api from '../../lib/api.js';
import { resetFavoritesCacheForTests } from '../../lib/useFavorite.js';
import { resetCanvasStoreForTests } from '../../lib/canvasSessionStore.js';

vi.mock('../../lib/api.js', () => ({
  getTask: vi.fn(),
  listTasksByNumber: vi.fn(),
  submitAttempt: vi.fn(),
  getVariant: vi.fn(),
  getVariantForTask: vi.fn(),
  listFavoriteTaskIds: vi.fn(() => Promise.resolve({ taskIds: [] })),
  addFavorite: vi.fn(() => Promise.resolve()),
  removeFavorite: vi.fn(() => Promise.resolve()),
  getStreak: vi.fn(() =>
    Promise.resolve({ currentStreak: 0, lastActiveDate: null, isActiveToday: false }),
  ),
}));

const TASK_ID = '11111111-1111-1111-1111-111111111111';
const SIBLING_A = '22222222-2222-2222-2222-222222222222';
const SIBLING_B = '33333333-3333-3333-3333-333333333333';
const CORRECT_ANSWER = '(−∞; −1] ∪ [2; +∞)';
const CONDITION = 'Решите неравенство: log₂(x² − 3x − 4) ≥ 1';
const EXPLANATION = 'Приводим к общему основанию и решаем полученную систему.';
const TASK_CODE = `#${TASK_ID.slice(0, 8)}`;
const SIBLING_A_CODE = `#${SIBLING_A.slice(0, 8)}`;
const SIBLING_B_CODE = `#${SIBLING_B.slice(0, 8)}`;

const baseTask = {
  id: TASK_ID,
  subjectId: 'math',
  taskNumber: 15,
  topicId: null,
  topicName: 'Логарифмы',
  difficulty: 3 as const,
  conditionMd: CONDITION,
  imageUrl: null,
  hintMd: 'Проверь область допустимых значений перед возведением в квадрат.',
  answerType: 'short_answer' as const,
  answerParts: null,
  answerOptions: null,
  source: 'ФИПИ',
  sourceUrl: null,
  sourceYear: 2026,
  tags: [],
  status: 'published' as const,
};

const siblings = [
  baseTask,
  { ...baseTask, id: SIBLING_A, conditionMd: 'log₅(x − 1) ≤ 2' },
  { ...baseTask, id: SIBLING_B, conditionMd: 'log₃(x + 2) + log₃x ≥ 1' },
];

const COLLECTION_SLUG = 'ege-2026-yashchenko';
const VARIANT_ID = 'variant-1';
const NEXT_TASK_ID = '44444444-4444-4444-4444-444444444444';

const variantCollection = {
  id: 'c1',
  subjectId: 'math',
  slug: COLLECTION_SLUG,
  title: 'ЕГЭ 2026 Ященко',
  publisher: 'Ященко',
  year: 2026,
  description: null,
};

const variantMeta = {
  id: VARIANT_ID,
  collectionId: 'c1',
  variantNumber: 1,
  title: 'Вариант 1',
  year: 2026,
};

/** Two-task ordered variant — TASK_ID has a real "next" task to skip to. */
const twoTaskVariant = {
  variant: variantMeta,
  collection: variantCollection,
  tasks: [
    { position: 1, task: { ...baseTask, id: TASK_ID } },
    { position: 2, task: { ...baseTask, id: NEXT_TASK_ID, taskNumber: 16 } },
  ],
};

/** Single-task variant — TASK_ID is both first and last, no "next". */
const oneTaskVariant = {
  variant: variantMeta,
  collection: variantCollection,
  tasks: [{ position: 1, task: { ...baseTask, id: TASK_ID } }],
};

function OverlayMarker() {
  const { overlay } = useNavigation();
  if (overlay?.screen === 'result') {
    return <p data-testid="overlay">result:{overlay.correct ? 'correct' : 'incorrect'}</p>;
  }
  if (overlay?.screen === 'task') {
    return (
      <p data-testid="overlay">
        task:{overlay.taskId}:{overlay.collectionSlug ?? 'no-collection'}:
        {overlay.variantId ?? 'no-variant'}
      </p>
    );
  }
  if (overlay?.screen === 'subject') {
    return (
      <p data-testid="overlay">
        subject:{overlay.subjectId}:{overlay.initialMode ?? 'no-mode'}
      </p>
    );
  }
  return <p data-testid="overlay">{overlay?.screen ?? 'none'}</p>;
}

function renderTask() {
  return render(
    <NavigationProvider>
      <TaskMobile
        subjectId={baseTask.subjectId}
        taskNumber={baseTask.taskNumber}
        taskId={TASK_ID}
      />
      <OverlayMarker />
    </NavigationProvider>,
  );
}

function renderTaskWithVariantContext() {
  return render(
    <NavigationProvider>
      <TaskMobile
        subjectId={baseTask.subjectId}
        taskNumber={baseTask.taskNumber}
        taskId={TASK_ID}
        collectionSlug={COLLECTION_SLUG}
      />
      <OverlayMarker />
    </NavigationProvider>,
  );
}

/** userEvent.type() parses [ ] { } as key-modifier syntax, so answers
 * like "(−∞; −1] ∪ [2; +∞)" must be pasted in, not typed. */
async function pasteAnswer(user: ReturnType<typeof userEvent.setup>, text: string) {
  const input = await screen.findByLabelText('Ответ');
  await user.click(input);
  await user.paste(text);
}

describe('TaskMobile', () => {
  beforeEach(() => {
    resetFavoritesCacheForTests();
    resetCanvasStoreForTests();
    vi.mocked(api.getTask).mockResolvedValue(baseTask);
    vi.mocked(api.listTasksByNumber).mockResolvedValue(siblings);
    vi.mocked(api.submitAttempt).mockImplementation((_taskId, { answer }) =>
      Promise.resolve(
        typeof answer === 'string' && answer.trim() === CORRECT_ANSWER
          ? {
              correct: true,
              correctAnswer: CORRECT_ANSWER,
              correctAnswerDisplay: null,
              explanation: EXPLANATION,
              attemptId: 'a1',
              mistakeId: null,
            }
          : {
              correct: false,
              correctAnswer: CORRECT_ANSWER,
              correctAnswerDisplay: null,
              explanation: EXPLANATION,
              attemptId: 'a2',
              mistakeId: 'm1',
            },
      ),
    );
  });

  it('renders the task condition and code', async () => {
    renderTask();
    expect(await screen.findByText(CONDITION)).toBeInTheDocument();
    expect(screen.getByText(TASK_CODE, { exact: false })).toBeInTheDocument();
  });

  it('renders the tools panel collapsed by default (04b variant)', async () => {
    renderTask();
    await screen.findByText(CONDITION);
    expect(screen.getByRole('button', { name: /Дополнительные инструменты/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('button', { name: 'Кальк.' })).not.toBeInTheDocument();
  });

  it('has no old keyboard shortcut button next to the answer field', async () => {
    renderTask();
    await screen.findByText(CONDITION);
    expect(screen.queryByRole('button', { name: 'Клавиатура' })).not.toBeInTheDocument();
  });

  it('opens the tools panel via the pencil icon, not a chevron', async () => {
    renderTask();
    await screen.findByText(CONDITION);
    const pencilButton = screen.getByRole('button', { name: 'Дополнительные инструменты' });
    expect(pencilButton.querySelector('svg.lucide-pencil')).toBeInTheDocument();
  });

  it('expands the tools panel to reveal the 5 tools', async () => {
    const user = userEvent.setup();
    renderTask();
    await screen.findByText(CONDITION);
    await user.click(screen.getByRole('button', { name: /Дополнительные инструменты/ }));
    expect(screen.getByRole('button', { name: 'Кальк.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Полотно' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Шаблоны' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Справочник' })).toBeInTheDocument();
  });

  it('opens the calculator from "Кальк.", computes a real result, closes without losing the typed answer (Task Workspace block 3)', async () => {
    const user = userEvent.setup();
    renderTask();
    await screen.findByText(CONDITION);
    await pasteAnswer(user, '(−∞; 2]');
    await user.click(screen.getByRole('button', { name: /Дополнительные инструменты/ }));
    await user.click(screen.getByRole('button', { name: 'Кальк.' }));

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '9' }));
    await user.click(within(dialog).getByRole('button', { name: '÷' }));
    await user.click(within(dialog).getByRole('button', { name: '3' }));
    await user.click(within(dialog).getByRole('button', { name: '=' }));
    expect(within(dialog).getByTestId('calculator-display')).toHaveTextContent('3');

    await user.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Ответ')).toHaveValue('(−∞; 2]');
  });

  it('opens the canvas workspace from "Полотно", shows the task condition, draws a stroke, closes without losing the typed answer, and restores the drawing on reopen (Task Workspace block 4)', async () => {
    const user = userEvent.setup();
    renderTask();
    await screen.findByText(CONDITION);
    await pasteAnswer(user, '(−∞; 2]');
    await user.click(screen.getByRole('button', { name: /Дополнительные инструменты/ }));
    await user.click(screen.getByRole('button', { name: 'Полотно' }));

    const dialog = screen.getByRole('dialog', { name: 'Полотно' });
    expect(within(dialog).getByText(CONDITION)).toBeInTheDocument();

    const board = within(dialog).getByRole('img', { name: 'Рабочее полотно для рисования' });
    fireEvent.pointerDown(board, { pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.pointerMove(board, { pointerId: 1, clientX: 30, clientY: 30 });
    fireEvent.pointerUp(board, { pointerId: 1, clientX: 30, clientY: 30 });
    expect(within(dialog).getByRole('button', { name: 'Отменить' })).toBeEnabled();

    await user.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Ответ')).toHaveValue('(−∞; 2]');

    await user.click(screen.getByRole('button', { name: 'Полотно' }));
    const reopened = screen.getByRole('dialog', { name: 'Полотно' });
    expect(within(reopened).getByRole('button', { name: 'Отменить' })).toBeEnabled();
  });

  it('opens "Пожаловаться на задание" from the header warning icon (canvas mobile fix block)', async () => {
    const user = userEvent.setup();
    renderTask();
    await screen.findByText(CONDITION);

    await user.click(screen.getByRole('button', { name: 'Пожаловаться на задание' }));
    const dialog = screen.getByRole('dialog', { name: 'Задание' });
    await user.click(within(dialog).getByRole('button', { name: 'Пожаловаться на задание' }));

    expect(within(dialog).getByRole('status')).toHaveTextContent('Жалоба отправлена');
  });

  it('renders "Другие задания" collapsed by default with real sibling tasks', async () => {
    const user = userEvent.setup();
    renderTask();
    await screen.findByText(CONDITION);
    expect(
      screen.queryByRole('button', { name: new RegExp(SIBLING_A_CODE) }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Другие задания/ }));
    expect(screen.getByRole('button', { name: new RegExp(SIBLING_A_CODE) })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(SIBLING_B_CODE) })).toBeInTheDocument();
  });

  it('disables Проверить until an answer is entered', async () => {
    const user = userEvent.setup();
    renderTask();
    const submit = await screen.findByRole('button', { name: /Проверить ответ/ });
    expect(submit).toBeDisabled();
    await pasteAnswer(user, CORRECT_ANSWER);
    expect(submit).toBeEnabled();
  });

  it('submits the answer and navigates to a correct Result', async () => {
    const user = userEvent.setup();
    renderTask();
    await pasteAnswer(user, CORRECT_ANSWER);
    const submit = screen.getByRole('button', { name: /Проверить ответ/ });
    await user.click(submit);
    await waitFor(() => {
      expect(screen.getByTestId('overlay')).toHaveTextContent('result:correct');
    });
  });

  it('refreshes the real streak (GET /progress/streak) after a submitted attempt, never on its own', async () => {
    const user = userEvent.setup();
    render(
      <NavigationProvider>
        <StreakProvider>
          <TaskMobile
            subjectId={baseTask.subjectId}
            taskNumber={baseTask.taskNumber}
            taskId={TASK_ID}
          />
        </StreakProvider>
        <OverlayMarker />
      </NavigationProvider>,
    );
    await waitFor(() => expect(api.getStreak).toHaveBeenCalledTimes(1)); // StreakProvider's own initial load
    await pasteAnswer(user, CORRECT_ANSWER);
    await user.click(screen.getByRole('button', { name: /Проверить ответ/ }));
    await waitFor(() => expect(api.getStreak).toHaveBeenCalledTimes(2));
  });

  it('navigates to an incorrect Result for the wrong answer', async () => {
    const user = userEvent.setup();
    renderTask();
    await pasteAnswer(user, 'нет такого ответа');
    await user.click(screen.getByRole('button', { name: /Проверить ответ/ }));
    await waitFor(() => {
      expect(screen.getByTestId('overlay')).toHaveTextContent('result:incorrect');
    });
  });

  it('toggles the hint', async () => {
    const user = userEvent.setup();
    renderTask();
    const toggle = await screen.findByRole('button', { name: 'Подсказка' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('inserts a math symbol into the answer field via the fx toggle', async () => {
    const user = userEvent.setup();
    renderTask();
    await screen.findByText(CONDITION);
    await user.click(screen.getByRole('button', { name: 'Математические символы' }));
    await user.click(screen.getByRole('button', { name: '∞' }));
    expect(screen.getByLabelText('Ответ')).toHaveValue('∞');
  });

  it('calls back() from the header back button', async () => {
    const user = userEvent.setup();
    renderTask();
    await screen.findByText(CONDITION);
    await user.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('none');
  });

  describe('multi_part task', () => {
    const multiPartTask = {
      ...baseTask,
      answerType: 'multi_part' as const,
      answerParts: [
        { id: 'a', label: 'а' },
        { id: 'b', label: 'б' },
        { id: 'c', label: 'в' },
      ],
    };

    beforeEach(() => {
      vi.mocked(api.getTask).mockResolvedValue(multiPartTask);
      vi.mocked(api.listTasksByNumber).mockResolvedValue([multiPartTask]);
    });

    it('renders one labeled input per part instead of the single answer field', async () => {
      renderTask();
      await screen.findByText(CONDITION);
      expect(screen.getByLabelText('Ответ а)')).toBeInTheDocument();
      expect(screen.getByLabelText('Ответ б)')).toBeInTheDocument();
      expect(screen.getByLabelText('Ответ в)')).toBeInTheDocument();
      expect(screen.queryByLabelText('Ответ')).not.toBeInTheDocument();
    });

    it('submits one object payload once every part is filled', async () => {
      const user = userEvent.setup();
      renderTask();
      const submit = await screen.findByRole('button', { name: /Проверить ответ/ });
      expect(submit).toBeDisabled();

      await user.click(screen.getByLabelText('Ответ а)'));
      await user.paste('нет');
      await user.click(screen.getByLabelText('Ответ б)'));
      await user.paste('607');
      await user.click(screen.getByLabelText('Ответ в)'));
      await user.paste('1066');
      expect(submit).toBeEnabled();

      await user.click(submit);
      await waitFor(() => {
        expect(api.submitAttempt).toHaveBeenCalledWith(TASK_ID, {
          answer: { a: 'нет', b: '607', c: '1066' },
        });
      });
    });
  });

  describe('essay task (развёрнутый ответ)', () => {
    const essayTask = {
      ...baseTask,
      answerType: 'essay' as const,
      correctAnswer: '',
      correctAnswerDisplay: null,
      explanationMd: 'Сочинение пишется по тексту Б. Критериев оценивания в источнике нет.',
      solutionSteps: null,
      canonicalSolution: undefined,
    };

    beforeEach(() => {
      vi.mocked(api.getTask).mockResolvedValue(essayTask);
      vi.mocked(api.listTasksByNumber).mockResolvedValue([essayTask]);
    });

    it('shows the explanation note instead of an answer field, with no Проверить ответ button', async () => {
      renderTask();
      await screen.findByText(CONDITION);
      expect(screen.queryByLabelText('Ответ')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Проверить ответ/ })).not.toBeInTheDocument();
      expect(screen.getByText('Задание с развёрнутым ответом (сочинение)')).toBeInTheDocument();
      expect(
        screen.getByText('Сочинение пишется по тексту Б. Критериев оценивания в источнике нет.'),
      ).toBeInTheDocument();
    });

    it('never calls submitAttempt for an essay task', async () => {
      renderTask();
      await screen.findByText(CONDITION);
      expect(api.submitAttempt).not.toHaveBeenCalled();
    });
  });

  describe('Пропустить (skip)', () => {
    it('skips from the first task to the next real task in the variant, using useTaskNavigation', async () => {
      vi.mocked(api.getVariantForTask).mockResolvedValue(twoTaskVariant);
      const user = userEvent.setup();
      renderTaskWithVariantContext();
      const skip = await screen.findByRole('button', { name: /Пропустить/ });
      await waitFor(() => expect(skip).toBeEnabled());
      await user.click(skip);
      await waitFor(() => {
        expect(screen.getByTestId('overlay')).toHaveTextContent(`task:${NEXT_TASK_ID}`);
      });
    });

    it('preserves the current source/collection when skipping', async () => {
      vi.mocked(api.getVariantForTask).mockResolvedValue(twoTaskVariant);
      const user = userEvent.setup();
      renderTaskWithVariantContext();
      const skip = await screen.findByRole('button', { name: /Пропустить/ });
      await waitFor(() => expect(skip).toBeEnabled());
      await user.click(skip);
      await waitFor(() => {
        expect(screen.getByTestId('overlay')).toHaveTextContent(COLLECTION_SLUG);
      });
    });

    it('preserves the resolved variant when skipping', async () => {
      vi.mocked(api.getVariantForTask).mockResolvedValue(twoTaskVariant);
      const user = userEvent.setup();
      renderTaskWithVariantContext();
      const skip = await screen.findByRole('button', { name: /Пропустить/ });
      await waitFor(() => expect(skip).toBeEnabled());
      await user.click(skip);
      await waitFor(() => {
        expect(screen.getByTestId('overlay')).toHaveTextContent(VARIANT_ID);
      });
    });

    it('does not submit an attempt (no correct/incorrect, no completion) when skipping', async () => {
      vi.mocked(api.getVariantForTask).mockResolvedValue(twoTaskVariant);
      const user = userEvent.setup();
      renderTaskWithVariantContext();
      const skip = await screen.findByRole('button', { name: /Пропустить/ });
      await waitFor(() => expect(skip).toBeEnabled());
      await user.click(skip);
      await waitFor(() => {
        expect(screen.getByTestId('overlay')).toHaveTextContent('task:');
      });
      expect(api.submitAttempt).not.toHaveBeenCalled();
    });

    it('disables Пропустить on the last task of the variant, so it never leaves the source boundary', async () => {
      vi.mocked(api.getVariantForTask).mockResolvedValue(oneTaskVariant);
      const user = userEvent.setup();
      renderTaskWithVariantContext();
      await screen.findByText(CONDITION);
      const skip = await screen.findByRole('button', { name: /Пропустить/ });
      await waitFor(() => expect(skip).toBeDisabled());
      await user.click(skip);
      expect(screen.getByTestId('overlay')).toHaveTextContent('none');
    });
  });

  describe('back-arrow return context (audit Block 3)', () => {
    it('returns to the given returnTo route instead of collapsing to Home', async () => {
      const user = userEvent.setup();
      render(
        <NavigationProvider>
          <TaskMobile
            subjectId={baseTask.subjectId}
            taskNumber={baseTask.taskNumber}
            taskId={TASK_ID}
            returnTo={{ screen: 'subject', subjectId: baseTask.subjectId, initialMode: 'topics' }}
          />
          <OverlayMarker />
        </NavigationProvider>,
      );
      await screen.findByText(CONDITION);
      await user.click(screen.getByRole('button', { name: 'Назад' }));
      expect(screen.getByTestId('overlay')).toHaveTextContent(
        `subject:${baseTask.subjectId}:topics`,
      );
    });

    it('falls back to the old back() behavior when no returnTo is given', async () => {
      const user = userEvent.setup();
      renderTask();
      await screen.findByText(CONDITION);
      await user.click(screen.getByRole('button', { name: 'Назад' }));
      expect(screen.getByTestId('overlay')).toHaveTextContent('none');
    });

    it('carries returnTo through Skip, so the parent context survives moving to a sibling task', async () => {
      vi.mocked(api.getVariantForTask).mockResolvedValue(twoTaskVariant);
      const user = userEvent.setup();
      render(
        <NavigationProvider>
          <TaskMobile
            subjectId={baseTask.subjectId}
            taskNumber={baseTask.taskNumber}
            taskId={TASK_ID}
            collectionSlug={COLLECTION_SLUG}
            returnTo={{ screen: 'mistakes' }}
          />
          <OverlayMarker />
        </NavigationProvider>,
      );
      const skip = await screen.findByRole('button', { name: /Пропустить/ });
      await waitFor(() => expect(skip).toBeEnabled());
      await user.click(skip);
      await waitFor(() => {
        expect(screen.getByTestId('overlay')).toHaveTextContent('task:');
      });
      await user.click(screen.getByRole('button', { name: 'Назад' }));
      expect(screen.getByTestId('overlay')).toHaveTextContent('mistakes');
    });
  });
});

describe('TaskMobile — solution-only illustration never leaks into the solving state (QA v2 Block H)', () => {
  beforeEach(() => {
    resetFavoritesCacheForTests();
    resetCanvasStoreForTests();
  });

  it('renders no "Иллюстрация к решению" label for task 14 (a text-only proof with a solving-aid SVG)', async () => {
    const task14 = { ...baseTask, id: TASK_ID, taskNumber: 14 };
    vi.mocked(api.getTask).mockResolvedValue(task14);
    vi.mocked(api.listTasksByNumber).mockResolvedValue([task14]);

    render(
      <NavigationProvider>
        <TaskMobile subjectId={task14.subjectId} taskNumber={task14.taskNumber} taskId={TASK_ID} />
      </NavigationProvider>,
    );
    await screen.findByText(CONDITION);

    expect(screen.queryByText('Иллюстрация к решению')).not.toBeInTheDocument();
  });
});

describe('TaskMobile — real solving timer (compact, top of screen)', () => {
  it('renders "Начать" and never auto-starts just because the task opened', async () => {
    renderTask();
    expect(await screen.findByRole('button', { name: 'Начать' })).toBeInTheDocument();
  });

  it('starting the timer shows a running clock with a Пауза control', async () => {
    const user = userEvent.setup();
    renderTask();
    await user.click(await screen.findByRole('button', { name: 'Начать' }));
    expect(screen.queryByRole('button', { name: 'Начать' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeInTheDocument();
  });

  it('submitting without ever starting sends no timeSpentMs', async () => {
    const user = userEvent.setup();
    renderTask();
    await pasteAnswer(user, CORRECT_ANSWER);
    await user.click(screen.getByRole('button', { name: /Проверить ответ/ }));
    await waitFor(() => expect(api.submitAttempt).toHaveBeenCalled());
    const [, payload] = vi.mocked(api.submitAttempt).mock.calls[0]!;
    expect(payload.timeSpentMs).toBeUndefined();
  });

  it('submits a real numeric timeSpentMs once the timer was started', async () => {
    const user = userEvent.setup();
    renderTask();
    await user.click(await screen.findByRole('button', { name: 'Начать' }));
    await pasteAnswer(user, CORRECT_ANSWER);
    await user.click(screen.getByRole('button', { name: /Проверить ответ/ }));
    await waitFor(() => expect(api.submitAttempt).toHaveBeenCalled());
    const [, payload] = vi.mocked(api.submitAttempt).mock.calls[0]!;
    expect(typeof payload.timeSpentMs).toBe('number');
  });
});

/**
 * Navigation bugfix round 2: submitting an answer must carry the real
 * session list (`customOrderedTasks`) forward to Result — see
 * TaskDesktop.test.tsx's matching describe block for the full root
 * cause. Mobile's handleCheck had the exact same gap.
 */
describe('TaskMobile — submit carries the session list forward to Result (navigation bugfix round 2)', () => {
  const V1 = { taskId: TASK_ID, taskNumber: 13 };
  const V2 = { taskId: SIBLING_A, taskNumber: 13 };
  const V3 = { taskId: SIBLING_B, taskNumber: 13 };

  function OverlayResultDetail() {
    const { overlay } = useNavigation();
    if (overlay?.screen !== 'result') return <p data-testid="result-detail">none</p>;
    return (
      <p data-testid="result-detail">
        session:{(overlay.customOrderedTasks ?? []).map((t) => t.taskId).join(',')}
      </p>
    );
  }

  beforeEach(() => {
    resetFavoritesCacheForTests();
    resetCanvasStoreForTests();
    vi.mocked(api.getTask).mockResolvedValue({ ...baseTask, taskNumber: 13 });
    vi.mocked(api.listTasksByNumber).mockResolvedValue(siblings);
    vi.mocked(api.submitAttempt).mockResolvedValue({
      correct: true,
      correctAnswer: CORRECT_ANSWER,
      correctAnswerDisplay: null,
      explanation: EXPLANATION,
      attemptId: 'a1',
      mistakeId: null,
    });
  });

  it('forwards the exact same customOrderedTasks list it was given, unchanged', async () => {
    const user = userEvent.setup();
    render(
      <NavigationProvider>
        <TaskMobile
          subjectId="math"
          taskNumber={13}
          taskId={TASK_ID}
          customOrderedTasks={[V1, V2, V3]}
        />
        <OverlayResultDetail />
      </NavigationProvider>,
    );
    await pasteAnswer(user, CORRECT_ANSWER);
    await user.click(screen.getByRole('button', { name: /Проверить ответ/ }));
    await waitFor(() => {
      expect(screen.getByTestId('result-detail')).toHaveTextContent(
        `session:${TASK_ID},${SIBLING_A},${SIBLING_B}`,
      );
    });
  });
});

/**
 * "К списку заданий №N" (UX bugfix round 3 — restored as a real
 * action): opens "Другие задания", clicks the button, confirms it
 * navigates to TrainingByNumber with this task's real subject/number
 * pre-selected — never auto-starting training.
 */
describe('TaskMobile — "К списку заданий №N" (navigation to По номерам, bugfix round 3)', () => {
  beforeEach(() => {
    resetFavoritesCacheForTests();
    resetCanvasStoreForTests();
    vi.mocked(api.getTask).mockResolvedValue(baseTask);
    vi.mocked(api.listTasksByNumber).mockResolvedValue(siblings);
  });

  it('navigates to По номерам with this taskNumber pre-selected', async () => {
    function ByNumberOverlayDetail() {
      const { overlay } = useNavigation();
      if (overlay?.screen !== 'trainingByNumber') return <p data-testid="by-number">none</p>;
      return (
        <p data-testid="by-number">
          byNumber:{overlay.subjectId}:{overlay.initialTaskNumber}
        </p>
      );
    }
    const user = userEvent.setup();
    render(
      <NavigationProvider>
        <TaskMobile
          subjectId={baseTask.subjectId}
          taskNumber={baseTask.taskNumber}
          taskId={TASK_ID}
        />
        <ByNumberOverlayDetail />
      </NavigationProvider>,
    );
    await screen.findByText(CONDITION);
    await user.click(
      await screen.findByRole('button', {
        name: new RegExp(`Другие задания №${baseTask.taskNumber}`),
      }),
    );
    await user.click(
      screen.getByRole('button', { name: `К списку заданий №${baseTask.taskNumber}` }),
    );
    expect(screen.getByTestId('by-number')).toHaveTextContent(
      `byNumber:${baseTask.subjectId}:${baseTask.taskNumber}`,
    );
  });
});
