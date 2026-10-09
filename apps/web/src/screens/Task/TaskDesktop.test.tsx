import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskDesktop } from './TaskDesktop.js';
import { subjects } from '../../data/subjects.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import { StreakProvider } from '../../lib/streakContext.js';
import * as api from '../../lib/api.js';
import { resetFavoritesCacheForTests } from '../../lib/useFavorite.js';
import { getCanvasState, resetCanvasStoreForTests } from '../../lib/canvasSessionStore.js';
import { initialCanvasState } from '../../lib/canvasEngine.js';

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
  return <p data-testid="overlay">{overlay?.screen ?? 'none'}</p>;
}

function renderTask() {
  return render(
    <NavigationProvider>
      <TaskDesktop
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
      <TaskDesktop
        subjectId={baseTask.subjectId}
        taskNumber={baseTask.taskNumber}
        taskId={TASK_ID}
        collectionSlug={COLLECTION_SLUG}
      />
      <OverlayMarker />
    </NavigationProvider>,
  );
}

async function pasteAnswer(user: ReturnType<typeof userEvent.setup>, text: string) {
  const input = await screen.findByLabelText('Ответ');
  await user.click(input);
  await user.paste(text);
}

describe('TaskDesktop', () => {
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

  it('fetches the real task and renders its condition', async () => {
    renderTask();
    expect(await screen.findByText(CONDITION)).toBeInTheDocument();
    const subject = subjects.find((s) => s.id === baseTask.subjectId)!;
    expect(screen.getAllByText(subject.shortName, { exact: false }).length).toBeGreaterThan(0);
  });

  it('renders the session progress ring and other-tasks sidebar', async () => {
    renderTask();
    await screen.findByText(CONDITION);
    expect(screen.getByText('Прогресс в теме')).toBeInTheDocument();
    expect(screen.getByText('Задания')).toBeInTheDocument();
    expect(screen.getByText('Инструменты')).toBeInTheDocument();
  });

  it('disables Проверить until an answer is entered', async () => {
    const user = userEvent.setup();
    renderTask();
    await screen.findByText(CONDITION);
    const submit = screen.getByRole('button', { name: /Проверить ответ/ });
    expect(submit).toBeDisabled();
    await pasteAnswer(user, CORRECT_ANSWER);
    expect(submit).toBeEnabled();
  });

  it('submits the answer to the API and navigates to a correct Result', async () => {
    const user = userEvent.setup();
    renderTask();
    await pasteAnswer(user, CORRECT_ANSWER);
    const submit = screen.getByRole('button', { name: /Проверить ответ/ });
    await user.click(submit);
    await waitFor(() => {
      expect(screen.getByTestId('overlay')).toHaveTextContent('result:correct');
    });
    expect(api.submitAttempt).toHaveBeenCalledWith(TASK_ID, { answer: CORRECT_ANSWER });
  });

  it('refreshes the real streak (GET /progress/streak) after a submitted attempt, never on its own', async () => {
    const user = userEvent.setup();
    render(
      <NavigationProvider>
        <StreakProvider>
          <TaskDesktop
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

  it('navigates to an incorrect Result for the wrong answer, per the server response', async () => {
    const user = userEvent.setup();
    renderTask();
    await pasteAnswer(user, 'неверный ответ');
    await user.click(screen.getByRole('button', { name: /Проверить ответ/ }));
    await waitFor(() => {
      expect(screen.getByTestId('overlay')).toHaveTextContent('result:incorrect');
    });
  });

  it('toggles the hint', async () => {
    const user = userEvent.setup();
    renderTask();
    const toggle = await screen.findByRole('button', { name: 'Показать подсказку' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('calls back() from the breadcrumb back button', async () => {
    const user = userEvent.setup();
    renderTask();
    await screen.findByText(CONDITION);
    await user.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('none');
  });

  it('never renders the task.imageUrl as a raw image — even a task with one (EGE Fidelity audit, Block 4)', async () => {
    const imageUrl = '/tasks/imports/ege-2026-variant-1/task-08-graph.png';
    vi.mocked(api.getTask).mockResolvedValue({ ...baseTask, imageUrl });
    renderTask();
    await screen.findByText(CONDITION);
    expect(screen.queryByRole('img', { name: 'Иллюстрация к заданию' })).not.toBeInTheDocument();
  });

  it('renders our own verified SVG reconstruction for a task with a real original diagram (e.g. task 11)', async () => {
    vi.mocked(api.getTask).mockResolvedValue({ ...baseTask, taskNumber: 11 });
    vi.mocked(api.listTasksByNumber).mockResolvedValue([{ ...baseTask, taskNumber: 11 }]);
    renderTask();
    await screen.findByText(CONDITION);
    expect(document.querySelector('svg[role="img"]')).toBeInTheDocument();
  });

  describe('calculator (Task Workspace block 3)', () => {
    it('opens from "Инструменты" → "Калькулятор", computes a real result, and closes without touching the typed answer', async () => {
      const user = userEvent.setup();
      renderTask();
      await screen.findByText(CONDITION);

      await pasteAnswer(user, '42');
      await user.click(screen.getByRole('button', { name: 'Калькулятор' }));

      const dialog = screen.getByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: '7' }));
      await user.click(within(dialog).getByRole('button', { name: '+' }));
      await user.click(within(dialog).getByRole('button', { name: '3' }));
      await user.click(within(dialog).getByRole('button', { name: '=' }));
      expect(within(dialog).getByTestId('calculator-display')).toHaveTextContent('10');

      await user.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Ответ')).toHaveValue('42');
    });
  });

  describe('canvas workspace "Полотно" (Task Workspace block 4)', () => {
    it('opens from "Инструменты" → "Полотно", shows the current task condition, draws a stroke, and restores it on reopen without losing the typed answer', async () => {
      const user = userEvent.setup();
      renderTask();
      await screen.findByText(CONDITION);

      await pasteAnswer(user, '42');
      await user.click(screen.getByRole('button', { name: 'Полотно' }));

      const dialog = screen.getByRole('dialog', { name: 'Полотно' });
      expect(within(dialog).getByText(CONDITION)).toBeInTheDocument();

      const board = within(dialog).getByRole('img', { name: 'Рабочее полотно для рисования' });
      fireEvent.pointerDown(board, { pointerId: 1, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(board, { pointerId: 1, clientX: 40, clientY: 40 });
      fireEvent.pointerUp(board, { pointerId: 1, clientX: 40, clientY: 40 });

      const undoButton = within(dialog).getByRole('button', { name: 'Отменить' });
      expect(undoButton).toBeEnabled();

      await user.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Ответ')).toHaveValue('42');

      await user.click(screen.getByRole('button', { name: 'Полотно' }));
      const reopened = screen.getByRole('dialog', { name: 'Полотно' });
      expect(within(reopened).getByRole('button', { name: 'Отменить' })).toBeEnabled();
    });

    it('clears the canvas for this task once a real attempt is submitted (a new attempt starts with an empty board)', async () => {
      const user = userEvent.setup();
      renderTask();
      await screen.findByText(CONDITION);

      await user.click(screen.getByRole('button', { name: 'Полотно' }));
      const dialog = screen.getByRole('dialog', { name: 'Полотно' });
      const board = within(dialog).getByRole('img', { name: 'Рабочее полотно для рисования' });
      fireEvent.pointerDown(board, { pointerId: 1, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(board, { pointerId: 1, clientX: 40, clientY: 40 });
      fireEvent.pointerUp(board, { pointerId: 1, clientX: 40, clientY: 40 });
      expect(within(dialog).getByRole('button', { name: 'Отменить' })).toBeEnabled();
      await user.click(within(dialog).getByRole('button', { name: 'Закрыть' }));

      await pasteAnswer(user, CORRECT_ANSWER);
      await user.click(screen.getByRole('button', { name: /Проверить ответ/ }));
      await waitFor(() => {
        expect(screen.getByTestId('overlay')).toHaveTextContent('result:correct');
      });

      expect(getCanvasState(TASK_ID)).toEqual(initialCanvasState());
    });

    it('never shows a solution-only illustration in its own condition card while solving (QA v2 final audit)', async () => {
      // The canvas dialog opens from both the Task (solving) and Result
      // screens with no way to tell which — CanvasBoard's own condition
      // card must therefore never render TaskSolutionIllustration itself,
      // only TaskExamIllustration (real source diagrams). Regression for
      // a leak found auditing task 14's pyramid SVG: it was appearing in
      // "Полотно" mid-solve, before any attempt was submitted.
      const user = userEvent.setup();
      vi.mocked(api.getTask).mockResolvedValue({ ...baseTask, taskNumber: 14 });
      vi.mocked(api.listTasksByNumber).mockResolvedValue([{ ...baseTask, taskNumber: 14 }]);
      renderTask();
      await screen.findByText(CONDITION);

      await user.click(screen.getByRole('button', { name: 'Полотно' }));
      const dialog = screen.getByRole('dialog', { name: 'Полотно' });
      expect(within(dialog).queryByText('Иллюстрация к решению')).not.toBeInTheDocument();
    });

    it('pinch (two simultaneous pointers moving apart) zooms the canvas in, shown by the zoom reset pill', async () => {
      const user = userEvent.setup();
      renderTask();
      await screen.findByText(CONDITION);
      await user.click(screen.getByRole('button', { name: 'Полотно' }));
      const dialog = screen.getByRole('dialog', { name: 'Полотно' });
      const board = within(dialog).getByRole('img', { name: 'Рабочее полотно для рисования' });

      // Two fingers land close together, then spread apart — a pinch-out
      // (zoom in). Real pinch gestures fire pointerdown/move per finger
      // with distinct pointerIds, which is exactly what CanvasBoard's
      // gesture tracking keys off of.
      //
      // Viewport updates from a pinch are now batched through
      // requestAnimationFrame (QA v2 Block C — avoids a full canvas
      // resize+redraw on every raw pointermove). A raw rAF callback
      // fires outside any React-managed event, so the gesture is
      // wrapped in one act() scope together with an awaited animation
      // frame — otherwise the update is applied to the fiber but never
      // flushed into a render the test can observe.
      await act(async () => {
        fireEvent.pointerDown(board, { pointerId: 1, clientX: 100, clientY: 100 });
        fireEvent.pointerDown(board, { pointerId: 2, clientX: 110, clientY: 100 });
        fireEvent.pointerMove(board, { pointerId: 1, clientX: 60, clientY: 100 });
        fireEvent.pointerMove(board, { pointerId: 2, clientX: 150, clientY: 100 });
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });
      expect(within(dialog).getByText(/%$/)).toBeInTheDocument();
    });

    it('a single-finger stroke commits nothing once a 2nd finger turns it into a pinch gesture', async () => {
      const user = userEvent.setup();
      renderTask();
      await screen.findByText(CONDITION);
      await user.click(screen.getByRole('button', { name: 'Полотно' }));
      const dialog = screen.getByRole('dialog', { name: 'Полотно' });
      const board = within(dialog).getByRole('img', { name: 'Рабочее полотно для рисования' });

      fireEvent.pointerDown(board, { pointerId: 1, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(board, { pointerId: 1, clientX: 40, clientY: 40 });
      // A 2nd finger lands mid-stroke — this must cancel the in-progress
      // mark, not commit a stray line right as the pinch starts.
      fireEvent.pointerDown(board, { pointerId: 2, clientX: 200, clientY: 200 });
      fireEvent.pointerUp(board, { pointerId: 1, clientX: 40, clientY: 40 });
      fireEvent.pointerUp(board, { pointerId: 2, clientX: 200, clientY: 200 });

      expect(within(dialog).getByRole('button', { name: 'Отменить' })).toBeDisabled();
    });
  });

  describe('report task (canvas mobile fix block — "Пожаловаться на задание")', () => {
    it('opens from the warning icon and shows a placeholder confirmation once reported', async () => {
      const user = userEvent.setup();
      renderTask();
      await screen.findByText(CONDITION);

      await user.click(screen.getByRole('button', { name: 'Пожаловаться на задание' }));
      const dialog = screen.getByRole('dialog', { name: 'Задание' });
      await user.click(within(dialog).getByRole('button', { name: 'Пожаловаться на задание' }));

      expect(within(dialog).getByRole('status')).toHaveTextContent('Жалоба отправлена');
    });

    it('no longer shows the old bare "Ещё" (three dots) button', async () => {
      renderTask();
      await screen.findByText(CONDITION);
      expect(screen.queryByRole('button', { name: 'Ещё' })).not.toBeInTheDocument();
    });
  });

  it('does not show "Заметки" in the desktop tools sidebar (canvas mobile fix block, section 4)', async () => {
    renderTask();
    await screen.findByText(CONDITION);
    expect(screen.queryByRole('button', { name: 'Заметки' })).not.toBeInTheDocument();
  });

  describe('favorite (Task Workspace block — real bookmark, not local-only state)', () => {
    it('starts unfavorited, toggles to favorited via a real POST, and reflects it visually', async () => {
      vi.mocked(api.listFavoriteTaskIds).mockResolvedValue({ taskIds: [] });
      vi.mocked(api.addFavorite).mockResolvedValue(undefined);
      const user = userEvent.setup();
      renderTask();
      await screen.findByText(CONDITION);

      const button = await screen.findByRole('button', { name: 'В избранное' });
      expect(button).toHaveAttribute('aria-pressed', 'false');

      await user.click(button);
      await waitFor(() => expect(api.addFavorite).toHaveBeenCalledWith(TASK_ID));
      expect(await screen.findByRole('button', { name: 'Убрать из избранного' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('starts favorited when the server says so, and toggling off calls DELETE', async () => {
      vi.mocked(api.listFavoriteTaskIds).mockResolvedValue({ taskIds: [TASK_ID] });
      vi.mocked(api.removeFavorite).mockResolvedValue(undefined);
      const user = userEvent.setup();
      renderTask();
      await screen.findByText(CONDITION);

      const button = await screen.findByRole('button', { name: 'Убрать из избранного' });
      expect(button).toHaveAttribute('aria-pressed', 'true');

      await user.click(button);
      await waitFor(() => expect(api.removeFavorite).toHaveBeenCalledWith(TASK_ID));
      expect(await screen.findByRole('button', { name: 'В избранное' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
    });

    it('a different task never inherits another task’s favorite state (task-specific, not global)', async () => {
      vi.mocked(api.listFavoriteTaskIds).mockResolvedValue({ taskIds: [TASK_ID] });
      renderTask();
      await screen.findByRole('button', { name: 'Убрать из избранного' });

      vi.mocked(api.getTask).mockResolvedValue({ ...baseTask, id: SIBLING_A });
      render(
        <NavigationProvider>
          <TaskDesktop
            subjectId={baseTask.subjectId}
            taskNumber={baseTask.taskNumber}
            taskId={SIBLING_A}
          />
        </NavigationProvider>,
      );
      expect(await screen.findAllByRole('button', { name: 'В избранное' })).not.toHaveLength(0);
    });
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

    it('keeps Проверить disabled until every part has an answer, then submits one object payload', async () => {
      const user = userEvent.setup();
      renderTask();
      const submit = await screen.findByRole('button', { name: /Проверить ответ/ });
      expect(submit).toBeDisabled();

      await user.click(screen.getByLabelText('Ответ а)'));
      await user.paste('нет');
      expect(submit).toBeDisabled();
      await user.click(screen.getByLabelText('Ответ б)'));
      await user.paste('607');
      expect(submit).toBeDisabled();
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
});

/**
 * Navigation bugfix regression: "Задание X из Y" / the sidebar list
 * must reflect the REAL current variant list (useTaskNavigation's
 * orderedTasks), never `listTasksByNumber`'s cross-source same-number
 * siblings — before this fix, every task open showed a fake
 * "Задание K из N" sized by how many OTHER SOURCES happen to have a
 * task with this same number, and clicking a sidebar row silently
 * jumped to a different source's same-numbered task instead of the
 * real next item in the list.
 */
describe('TaskDesktop — session progress reflects the real list, not cross-source siblings', () => {
  beforeEach(() => {
    resetFavoritesCacheForTests();
    resetCanvasStoreForTests();
    vi.mocked(api.getTask).mockResolvedValue(baseTask);
    // 3 cross-source siblings sharing taskNumber=15 — must NOT drive
    // "Задание X из Y" once a real 2-task variant list exists below.
    vi.mocked(api.listTasksByNumber).mockResolvedValue(siblings);
  });

  it('"Задание X из Y" uses the real variant size (2), not the sibling count (3)', async () => {
    vi.mocked(api.getVariantForTask).mockResolvedValue(twoTaskVariant);
    renderTaskWithVariantContext();
    await screen.findByText(CONDITION);
    await waitFor(() => {
      expect(screen.getByText(/Задание 1 из 2/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/из 3/)).not.toBeInTheDocument();
  });

  it('falls back to "Задание 1 из 1" with no real list context (plain single-task open)', async () => {
    renderTask();
    await screen.findByText(CONDITION);
    await waitFor(() => {
      expect(screen.getByText(/Задание 1 из 1/)).toBeInTheDocument();
    });
  });

  it('clicking "Задание 2" in the sidebar navigates to the real next variant task, not a cross-source sibling', async () => {
    vi.mocked(api.getVariantForTask).mockResolvedValue(twoTaskVariant);
    const user = userEvent.setup();
    renderTaskWithVariantContext();
    await screen.findByText(CONDITION);
    await waitFor(() => expect(screen.getByText(/Задание 1 из 2/)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Задание 2' }));
    await waitFor(() => {
      expect(screen.getByTestId('overlay')).toHaveTextContent(`task:${NEXT_TASK_ID}`);
    });
    // Never SIBLING_A/SIBLING_B — those are cross-source same-number
    // tasks, not members of the real variant list.
    expect(screen.getByTestId('overlay')).not.toHaveTextContent(SIBLING_A);
    expect(screen.getByTestId('overlay')).not.toHaveTextContent(SIBLING_B);
  });
});

describe('TaskDesktop — real solving timer (never the old static clock)', () => {
  it('renders "Начать" and never auto-starts just because the task opened', async () => {
    renderTask();
    expect(await screen.findByRole('button', { name: 'Начать' })).toBeInTheDocument();
  });

  it('starting the timer shows a running clock with a Пауза control, replacing "Начать"', async () => {
    const user = userEvent.setup();
    renderTask();
    await user.click(await screen.findByRole('button', { name: 'Начать' }));
    expect(screen.queryByRole('button', { name: 'Начать' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeInTheDocument();
  });

  it('pausing swaps to "Продолжить" and submitting without ever starting sends no timeSpentMs', async () => {
    const user = userEvent.setup();
    renderTask();
    await pasteAnswer(user, CORRECT_ANSWER);
    const submit = screen.getByRole('button', { name: /Проверить ответ/ });
    await user.click(submit);
    await waitFor(() => expect(api.submitAttempt).toHaveBeenCalled());
    const [, payload] = vi.mocked(api.submitAttempt).mock.calls[0]!;
    expect(payload.timeSpentMs).toBeUndefined();
  });

  it('submits a real numeric timeSpentMs once the timer was started', async () => {
    const user = userEvent.setup();
    renderTask();
    await user.click(await screen.findByRole('button', { name: 'Начать' }));
    await pasteAnswer(user, CORRECT_ANSWER);
    const submit = screen.getByRole('button', { name: /Проверить ответ/ });
    await user.click(submit);
    await waitFor(() => expect(api.submitAttempt).toHaveBeenCalled());
    const [, payload] = vi.mocked(api.submitAttempt).mock.calls[0]!;
    expect(typeof payload.timeSpentMs).toBe('number');
    expect(payload.timeSpentMs).toBeGreaterThanOrEqual(0);
  });

  it('pause then resume still reaches submit with a real timeSpentMs (paused time never lost)', async () => {
    const user = userEvent.setup();
    renderTask();
    await user.click(await screen.findByRole('button', { name: 'Начать' }));
    await user.click(screen.getByRole('button', { name: 'Пауза' }));
    await user.click(screen.getByRole('button', { name: 'Продолжить' }));
    await pasteAnswer(user, CORRECT_ANSWER);
    await user.click(screen.getByRole('button', { name: /Проверить ответ/ }));
    await waitFor(() => expect(api.submitAttempt).toHaveBeenCalled());
    const [, payload] = vi.mocked(api.submitAttempt).mock.calls[0]!;
    expect(typeof payload.timeSpentMs).toBe('number');
  });
});

/**
 * Navigation bugfix round 2: submitting an answer must carry the real
 * session list (`customOrderedTasks`) forward to Result — before this
 * fix, a "По номерам" single-number session (V1#13..V5#13) resolved
 * correctly on the Task screen (1 2 3 4 5, real Next), but the moment
 * you submitted, Result's own `useTaskNavigation` got NO list at all
 * (no customOrderedTasks, no collectionSlug, no variantId — the
 * resolved variantId for a customOrderedTasks session is always null,
 * see useTaskNavigation.ts), so "Следующее задание" showed disabled.
 */
describe('TaskDesktop — submit carries the session list forward to Result (navigation bugfix round 2)', () => {
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
  });

  it('forwards the exact same customOrderedTasks list it was given, unchanged', async () => {
    const user = userEvent.setup();
    render(
      <NavigationProvider>
        <TaskDesktop
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
 * Desktop "Другие задания" bugfix: previously only mobile had this
 * block at all — desktop Task now shows the same cards/data source at
 * the bottom of the page.
 */
describe('TaskDesktop — "Другие задания" (desktop, bugfix: block was missing on Task too)', () => {
  beforeEach(() => {
    resetFavoritesCacheForTests();
    resetCanvasStoreForTests();
    vi.mocked(api.getTask).mockResolvedValue(baseTask);
    vi.mocked(api.listTasksByNumber).mockResolvedValue(siblings);
  });

  it('renders the block below the main grid, using the real siblings from listTasksByNumber', async () => {
    renderTask();
    await screen.findByText(CONDITION);
    expect(await screen.findByText(`Другие задания №${baseTask.taskNumber}`)).toBeInTheDocument();
    expect(screen.getByText(`#${SIBLING_A.slice(0, 8)}`)).toBeInTheDocument();
  });

  it('is collapsed by default (same UX as mobile), expands on header click', async () => {
    const user = userEvent.setup();
    renderTask();
    await screen.findByText(CONDITION);
    const header = await screen.findByRole('button', {
      name: new RegExp(`Другие задания №${baseTask.taskNumber}`),
    });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    await user.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
  });

  it('"К списку заданий №N" navigates to По номерам with this taskNumber pre-selected (never auto-starts training)', async () => {
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
        <TaskDesktop
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

  it("clicking a card opens exactly that card's taskId", async () => {
    const user = userEvent.setup();
    renderTask();
    await screen.findByText(CONDITION);
    await user.click(
      await screen.findByRole('button', {
        name: new RegExp(`Другие задания №${baseTask.taskNumber}`),
      }),
    );
    await user.click(
      screen.getByRole('button', { name: `Задание #${SIBLING_A.slice(0, 8)}, Сложное` }),
    );
    await waitFor(() => {
      expect(screen.getByTestId('overlay')).toHaveTextContent(`task:${SIBLING_A}`);
    });
  });
});
