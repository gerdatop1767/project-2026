import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { serializeMultiPartSpec, serializeMultiPartUserAnswer } from '@zybrilka/shared';
import { ResultMobile } from './ResultMobile.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import { resetFavoritesCacheForTests } from '../../lib/useFavorite.js';
import * as api from '../../lib/api.js';

vi.mock('../../lib/api.js', () => ({
  getTask: vi.fn(),
  listTasksByNumber: vi.fn(),
  getVariant: vi.fn(),
  getVariantForTask: vi.fn(),
  getProgressSummary: vi.fn(),
  listFavoriteTaskIds: vi.fn(() => Promise.resolve({ taskIds: [] })),
  addFavorite: vi.fn(() => Promise.resolve()),
  removeFavorite: vi.fn(() => Promise.resolve()),
}));

const TASK_ID = '11111111-1111-1111-1111-111111111111';
const SIBLING_A = '22222222-2222-2222-2222-222222222222';
const CORRECT_ANSWER = '(−∞; −1] ∪ [2; +∞)';
const CONDITION = 'Решите неравенство: log₂(x² − 3x − 4) ≥ 1';
const EXPLANATION = 'Приводим к общему основанию и решаем полученную систему.';
const TASK_NUMBER = 15;

const baseTask = {
  id: TASK_ID,
  subjectId: 'math',
  taskNumber: TASK_NUMBER,
  topicId: null,
  topicName: 'Логарифмы',
  difficulty: 3 as const,
  conditionMd: CONDITION,
  passage: null,
  imageUrl: null,
  hintMd: null,
  answerType: 'short_answer' as const,
  answerParts: null,
  answerOptions: null,
  source: 'ФИПИ',
  sourceUrl: null,
  sourceYear: 2026,
  tags: [],
  status: 'published' as const,
};

const taskWithSolution = {
  ...baseTask,
  correctAnswer: CORRECT_ANSWER,
  correctAnswerDisplay: null,
  explanationMd: EXPLANATION,
};
const siblings = [baseTask, { ...baseTask, id: SIBLING_A, conditionMd: 'log₅(x − 1) ≤ 2' }];

function OverlayMarker() {
  const { overlay } = useNavigation();
  if (overlay?.screen === 'subject') {
    return (
      <p data-testid="overlay">
        subject:{overlay.subjectId}:{overlay.collectionSlug ?? 'no-collection'}:
        {overlay.initialMode ?? 'no-mode'}
      </p>
    );
  }
  return <p data-testid="overlay">{overlay?.screen ?? 'none'}</p>;
}

function renderResult(correct: boolean, userAnswer = correct ? CORRECT_ANSWER : '(−∞; 2]') {
  return render(
    <NavigationProvider>
      <ResultMobile
        subjectId={baseTask.subjectId}
        taskNumber={baseTask.taskNumber}
        taskId={TASK_ID}
        correct={correct}
        userAnswer={userAnswer}
      />
      <OverlayMarker />
    </NavigationProvider>,
  );
}

beforeEach(() => {
  resetFavoritesCacheForTests();
  vi.mocked(api.getTask).mockResolvedValue(taskWithSolution);
  vi.mocked(api.listTasksByNumber).mockResolvedValue(siblings);
  vi.mocked(api.getProgressSummary).mockResolvedValue({
    solvedTotal: 42,
    correctTotal: 30,
    incorrectTotal: 12,
    accuracyPercent: 71.4,
    bySubject: [],
    byTaskNumber: [],
    byTopic: [],
    timeBySubject: [],
  });
});

describe('ResultMobile — correct state', () => {
  it('shows the success feedback and the matched answer', async () => {
    renderResult(true);
    expect(await screen.findByText('Правильно!')).toBeInTheDocument();
    expect(screen.getAllByText(CORRECT_ANSWER).length).toBeGreaterThan(0);
  });

  it('shows the task condition (QA v3 Block 2 — the user should see what task this result is for)', async () => {
    renderResult(true);
    await screen.findByText('Правильно!');
    expect(screen.getByText(/Решите неравенство/)).toBeInTheDocument();
  });

  it('does not show the reference-answer row when correct', async () => {
    renderResult(true);
    await screen.findByText('Правильно!');
    expect(screen.queryByText('Правильный ответ:')).not.toBeInTheDocument();
  });

  it('reveals the solution explanation', async () => {
    const user = userEvent.setup();
    renderResult(true);
    await screen.findByText('Правильно!');
    await user.click(screen.getByRole('button', { name: /Показать решение/ }));
    expect(screen.getByText(EXPLANATION)).toBeInTheDocument();
  });

  it('(J) does not render the canonical solution block for a task without one — existing flow unchanged', async () => {
    const user = userEvent.setup();
    renderResult(true);
    await screen.findByText('Правильно!');
    await user.click(screen.getByRole('button', { name: /Показать решение/ }));
    expect(screen.queryByText('Эталонное решение')).not.toBeInTheDocument();
    expect(screen.queryByText('Что важно на ЕГЭ')).not.toBeInTheDocument();
    expect(screen.queryByText('Как записать на ЕГЭ')).not.toBeInTheDocument();
  });

  it('has no ordered context without a collection/variant, so "Следующее задание" stays inert', async () => {
    const user = userEvent.setup();
    renderResult(true);
    await screen.findByText('Правильно!');
    expect(screen.getByRole('button', { name: 'Следующее задание' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Следующее задание' }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('none');
  });

  it('navigates to the next task using the ordered variant context when known', async () => {
    const user = userEvent.setup();
    const nextTaskId = '33333333-3333-3333-3333-333333333333';
    vi.mocked(api.getVariant).mockResolvedValue({
      variant: {
        id: 'variant-1',
        collectionId: 'col-1',
        variantNumber: 1,
        title: 'Вариант 1',
        year: null,
      },
      collection: {
        id: 'col-1',
        subjectId: 'math',
        slug: 'ege-2026-yashchenko',
        title: 'Ященко',
        publisher: null,
        year: null,
        description: null,
      },
      tasks: [
        { position: 1, task: taskWithSolution },
        { position: 2, task: { ...taskWithSolution, id: nextTaskId, taskNumber: 16 } },
      ],
    });
    render(
      <NavigationProvider>
        <ResultMobile
          subjectId={baseTask.subjectId}
          taskNumber={baseTask.taskNumber}
          taskId={TASK_ID}
          correct
          userAnswer={CORRECT_ANSWER}
          variantId="variant-1"
        />
        <OverlayMarker />
      </NavigationProvider>,
    );
    await screen.findByText('Правильно!');
    const nextButton = await screen.findByRole('button', { name: 'Следующее задание' });
    expect(nextButton).toBeEnabled();
    await user.click(nextButton);
    expect(screen.getByTestId('overlay')).toHaveTextContent('task');
  });
});

describe('ResultMobile — passage on the result screen (critical fix: the result screen fetched the task but never rendered task.passage)', () => {
  const PASSAGE_BODY = '(1)Были у Татьяны Егоровны старинные часы.';
  const taskWithPassage = {
    ...taskWithSolution,
    passage: {
      id: 'passage-1',
      slug: 'text-b',
      title: null,
      bodyMd: PASSAGE_BODY,
      sourceAuthor: 'По М.А. Осоргину',
      sourceNote: null,
    },
  };

  it('shows the full condition AND the shared passage after checking (correct)', async () => {
    vi.mocked(api.getTask).mockResolvedValue(taskWithPassage);
    renderResult(true);
    expect(await screen.findByText(CONDITION)).toBeInTheDocument();
    expect(screen.getByText('Текст к заданию')).toBeInTheDocument();
    expect(screen.getByText(PASSAGE_BODY)).toBeInTheDocument();
  });

  it('shows the full condition AND the shared passage after checking (incorrect)', async () => {
    vi.mocked(api.getTask).mockResolvedValue(taskWithPassage);
    renderResult(false);
    expect(await screen.findByText(CONDITION)).toBeInTheDocument();
    expect(screen.getByText(PASSAGE_BODY)).toBeInTheDocument();
  });

  it('shows no passage block for a self-contained task (passage: null)', async () => {
    vi.mocked(api.getTask).mockResolvedValue(taskWithSolution);
    renderResult(true);
    await screen.findByText(CONDITION);
    expect(screen.queryByText('Текст к заданию')).not.toBeInTheDocument();
  });
});

describe('ResultMobile — incorrect state', () => {
  it('shows a calm error state with the correct answer', async () => {
    renderResult(false);
    expect(await screen.findByText('Неправильно!')).toBeInTheDocument();
    expect(screen.getByText('Правильный ответ:')).toBeInTheDocument();
    expect(screen.getAllByText(CORRECT_ANSWER).length).toBeGreaterThan(0);
  });

  it('shows the task number via the meta chip on the task chrome', async () => {
    renderResult(false);
    expect(await screen.findByText(`Задание №${TASK_NUMBER}`)).toBeInTheDocument();
  });
});

describe('ResultMobile — correct answer goes through MathText (audit Block 7)', () => {
  it('renders real KaTeX for a correctAnswer using $...$ notation', async () => {
    vi.mocked(api.getTask).mockResolvedValue({
      ...taskWithSolution,
      correctAnswer: '$\\arccos\\left(\\dfrac{\\sqrt{10}}{5}\\right)$',
    });
    renderResult(false, 'что-то другое');
    await screen.findByText('Неправильно!');
    expect(document.querySelector('.katex')).toBeInTheDocument();
  });

  it('still shows plain numeric answers unchanged (e.g. 102), never breaking a simple case', async () => {
    vi.mocked(api.getTask).mockResolvedValue({ ...taskWithSolution, correctAnswer: '102' });
    renderResult(false, '99');
    await screen.findByText('Неправильно!');
    expect(screen.getAllByText('102').length).toBeGreaterThan(0);
    expect(document.querySelector('.katex')).not.toBeInTheDocument();
  });
});

describe('ResultMobile — correctAnswerDisplay takes priority over correctAnswer (Final Polish, machine vs display)', () => {
  it('renders correctAnswerDisplay via KaTeX when present, never the plain machine value', async () => {
    vi.mocked(api.getTask).mockResolvedValue({
      ...taskWithSolution,
      correctAnswer: 'arccos(√10/5)',
      correctAnswerDisplay: '$\\arccos\\dfrac{\\sqrt{10}}{5}$',
    });
    renderResult(false, 'что-то другое');
    await screen.findByText('Неправильно!');
    expect(document.querySelector('.katex')).toBeInTheDocument();
    expect(screen.queryByText('arccos(√10/5)')).not.toBeInTheDocument();
  });

  it('falls back to the plain correctAnswer when correctAnswerDisplay is null', async () => {
    vi.mocked(api.getTask).mockResolvedValue({
      ...taskWithSolution,
      correctAnswer: '102',
      correctAnswerDisplay: null,
    });
    renderResult(false, '99');
    await screen.findByText('Неправильно!');
    expect(screen.getAllByText('102').length).toBeGreaterThan(0);
  });
});

describe('ResultMobile — multi_part task', () => {
  const multiPartTask = {
    ...baseTask,
    answerType: 'multi_part' as const,
    answerParts: [
      { id: 'a', label: 'а' },
      { id: 'b', label: 'б' },
      { id: 'c', label: 'в' },
    ],
    correctAnswer: serializeMultiPartSpec({
      parts: [
        { id: 'a', label: 'а', answerType: 'short_answer', correctAnswer: 'нет' },
        { id: 'b', label: 'б', answerType: 'short_answer', correctAnswer: '607' },
        { id: 'c', label: 'в', answerType: 'short_answer', correctAnswer: '1066' },
      ],
    }),
    explanationMd: '### А\nПояснение к а.\n\n### Б и В\nПояснение к б и в.',
    solutionSteps: null,
  };

  it('shows per-part answer rows and per-part explanation once revealed', async () => {
    const user = userEvent.setup();
    const userAnswer = serializeMultiPartUserAnswer({ a: 'нет', b: '607', c: 'wrong' });
    vi.mocked(api.getTask).mockResolvedValue(multiPartTask);
    render(
      <NavigationProvider>
        <ResultMobile
          subjectId={multiPartTask.subjectId}
          taskNumber={multiPartTask.taskNumber}
          taskId={TASK_ID}
          correct={false}
          userAnswer={userAnswer}
        />
        <OverlayMarker />
      </NavigationProvider>,
    );

    await screen.findByText('Неправильно!');
    expect(screen.getByText('а) Твой ответ:')).toBeInTheDocument();
    expect(screen.getByText('1066')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Показать решение/ }));
    expect(screen.getByText('Пояснение к а.')).toBeInTheDocument();
    expect(screen.getAllByText('Пояснение к б и в.')).toHaveLength(2);
  });
});

describe('ResultMobile — shared chrome', () => {
  it('keeps tools and other-variants collapsed by default', async () => {
    renderResult(true);
    await screen.findByText('Правильно!');
    expect(screen.getByRole('button', { name: /Дополнительные инструменты/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('button', { name: /Другие задания/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});

describe('ResultMobile — "К списку заданий"', () => {
  it('goes to the Subject screen in "Темы" mode, not Home, preserving the source', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getVariantForTask).mockResolvedValue({
      variant: {
        id: 'variant-1',
        collectionId: 'col-1',
        variantNumber: 1,
        title: 'Вариант 1',
        year: null,
      },
      collection: {
        id: 'col-1',
        subjectId: 'math',
        slug: 'ege-2026-yashchenko',
        title: 'Ященко',
        publisher: null,
        year: null,
        description: null,
      },
      tasks: [{ position: 1, task: taskWithSolution }],
    });
    render(
      <NavigationProvider>
        <ResultMobile
          subjectId={baseTask.subjectId}
          taskNumber={baseTask.taskNumber}
          taskId={TASK_ID}
          correct
          userAnswer={CORRECT_ANSWER}
          collectionSlug="ege-2026-yashchenko"
        />
        <OverlayMarker />
      </NavigationProvider>,
    );
    await screen.findByText('Правильно!');
    await user.click(screen.getByRole('button', { name: 'К списку заданий' }));
    expect(screen.getByTestId('overlay')).toHaveTextContent(
      `subject:${baseTask.subjectId}:ege-2026-yashchenko:topics`,
    );
  });
});

describe('ResultMobile — solution-only illustration (QA v2 Block H)', () => {
  it('shows task 14\'s "Иллюстрация к решению" pyramid diagram once the result screen loads', async () => {
    const task14 = { ...taskWithSolution, taskNumber: 14 };
    vi.mocked(api.getTask).mockResolvedValue(task14);
    vi.mocked(api.listTasksByNumber).mockResolvedValue([task14]);

    render(
      <NavigationProvider>
        <ResultMobile
          subjectId={task14.subjectId}
          taskNumber={task14.taskNumber}
          taskId={TASK_ID}
          correct={false}
          userAnswer="test"
        />
      </NavigationProvider>,
    );

    expect(await screen.findByText('Иллюстрация к решению')).toBeInTheDocument();
  });
});

describe('ResultMobile — real solving time display (replaces the old static "Время 1:24")', () => {
  it('shows the real submitted timeSpentMs, formatted as mm:ss', async () => {
    render(
      <NavigationProvider>
        <ResultMobile
          subjectId={baseTask.subjectId}
          taskNumber={baseTask.taskNumber}
          taskId={TASK_ID}
          correct
          userAnswer={CORRECT_ANSWER}
          timeSpentMs={84000}
        />
      </NavigationProvider>,
    );
    await screen.findByText('Правильно!');
    expect(screen.getByText((_, node) => node?.textContent === 'Время 01:24')).toBeInTheDocument();
    expect(
      screen.queryByText((_, node) => node?.textContent === 'Время 1:24'),
    ).not.toBeInTheDocument();
  });

  it('shows no time chip at all when the task was never timed (never fabricates one)', async () => {
    render(
      <NavigationProvider>
        <ResultMobile
          subjectId={baseTask.subjectId}
          taskNumber={baseTask.taskNumber}
          taskId={TASK_ID}
          correct
          userAnswer={CORRECT_ANSWER}
        />
      </NavigationProvider>,
    );
    await screen.findByText('Правильно!');
    expect(screen.queryByText('Время 1:24')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Время /)).not.toBeInTheDocument();
  });
});

/**
 * Navigation bugfix round 2: a `customOrderedTasks` session (e.g. "По
 * номерам" with one number selected: V1#13..V5#13) must drive a real,
 * working "Следующее задание" on Result — mirrors
 * TaskDesktop/TaskMobile's "submit carries the session list forward"
 * fix on the receiving end.
 */
describe('ResultMobile — "Следующее задание" with a real customOrderedTasks session (navigation bugfix round 2)', () => {
  const V1 = { taskId: TASK_ID, taskNumber: 13 };
  const V2 = { taskId: SIBLING_A, taskNumber: 13 };
  const V3_ID = '33333333-3333-3333-3333-333333333333';
  const V3 = { taskId: V3_ID, taskNumber: 13 };

  function renderWithSession(taskId: string) {
    return render(
      <NavigationProvider>
        <ResultMobile
          subjectId="math"
          taskNumber={13}
          taskId={taskId}
          correct
          userAnswer={CORRECT_ANSWER}
          customOrderedTasks={[V1, V2, V3]}
        />
        <OverlayMarker />
      </NavigationProvider>,
    );
  }

  beforeEach(() => {
    vi.mocked(api.getTask).mockImplementation((id) =>
      Promise.resolve({ ...taskWithSolution, id, taskNumber: 13 }),
    );
  });

  it('V1#13 → Next → V2#13 (never a 1-of-1 fallback)', async () => {
    const user = userEvent.setup();
    renderWithSession(TASK_ID);
    const next = await screen.findByRole('button', { name: 'Следующее задание' });
    expect(next).toBeEnabled();
    await user.click(next);
    expect(screen.getByTestId('overlay')).toHaveTextContent('task');
  });

  it('V5#13 (last entry) disables Next', async () => {
    renderWithSession(V3_ID);
    const next = await screen.findByRole('button', { name: 'Следующее задание' });
    expect(next).toBeDisabled();
  });
});

/**
 * "Другие задания" (Similar Tasks) preview bugfix: the preview must go
 * through the real math renderer (InlineMathText/KaTeX), never raw
 * `$...$`/`\sqrt`/`\cdot` text — and clicking a card opens exactly that
 * card's real taskId.
 */
describe('ResultMobile — "Другие задания" preview renders real math, not raw LaTeX (bugfix)', () => {
  const OTHER_ID = '55555555-5555-5555-5555-555555555555';
  const RAW_CONDITION = 'а) Решите уравнение $\\sqrt{4\\sin^3x - 4\\cos^2x} - \\cos x = 0$';

  beforeEach(() => {
    vi.mocked(api.listTasksByNumber).mockResolvedValue([
      taskWithSolution,
      { ...taskWithSolution, id: OTHER_ID, conditionMd: RAW_CONDITION },
    ]);
  });

  it('renders real KaTeX for the similar-task preview, never the raw $...$ source', async () => {
    const user = userEvent.setup();
    renderResult(true);
    await screen.findByText('Правильно!');
    await user.click(screen.getByRole('button', { name: /Другие задания/ }));
    expect(await screen.findByText(/Решите уравнение/)).toBeInTheDocument();
    // `.katex-mathml` legitimately holds the raw TeX source (sr-only,
    // same as every other math span in the app) — the bug was the
    // VISIBLE rendering showing it as plain text, so the check is on
    // `.katex-html` (what's actually on screen) only.
    const katexHtml = document.querySelector('.katex-html');
    expect(katexHtml).toBeInTheDocument();
    expect(katexHtml!.textContent).not.toMatch(/\\sqrt/);
    expect(katexHtml!.textContent).not.toMatch(/\\cos/);
    expect(katexHtml!.textContent).not.toContain('$');
  });

  it("clicking the preview card opens exactly that card's taskId, never a random or the current one", async () => {
    function TaskIdOverlayMarker() {
      const { overlay } = useNavigation();
      if (overlay?.screen !== 'task') return <p data-testid="task-overlay">none</p>;
      return <p data-testid="task-overlay">task:{overlay.taskId}</p>;
    }
    const user = userEvent.setup();
    render(
      <NavigationProvider>
        <ResultMobile
          subjectId={baseTask.subjectId}
          taskNumber={baseTask.taskNumber}
          taskId={TASK_ID}
          correct
          userAnswer={CORRECT_ANSWER}
        />
        <TaskIdOverlayMarker />
      </NavigationProvider>,
    );
    await screen.findByText('Правильно!');
    await user.click(screen.getByRole('button', { name: /Другие задания/ }));
    await screen.findByText(/Решите уравнение/);
    await user.click(screen.getByText(/Решите уравнение/));
    await waitFor(() => {
      expect(screen.getByTestId('task-overlay')).toHaveTextContent(`task:${OTHER_ID}`);
    });
  });
});

/**
 * "К списку заданий №N" (UX bugfix round 3 — restored as a real
 * action): opens "Другие задания", clicks the button, confirms it
 * navigates to TrainingByNumber with this task's real subject/number
 * pre-selected — never auto-starting training.
 */
describe('ResultMobile — "К списку заданий №N" (navigation to По номерам, bugfix round 3)', () => {
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
        <ResultMobile
          subjectId={baseTask.subjectId}
          taskNumber={baseTask.taskNumber}
          taskId={TASK_ID}
          correct
          userAnswer={CORRECT_ANSWER}
        />
        <ByNumberOverlayDetail />
      </NavigationProvider>,
    );
    await screen.findByText('Правильно!');
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
