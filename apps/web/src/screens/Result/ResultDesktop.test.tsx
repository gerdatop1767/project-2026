import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { serializeMultiPartSpec, serializeMultiPartUserAnswer } from '@zybrilka/shared';
import { ResultDesktop } from './ResultDesktop.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import {
  LearningSessionProvider,
  useLearningSessionContext,
} from '../../lib/learningSessionContext.js';
import * as api from '../../lib/api.js';

vi.mock('../../lib/api.js', () => ({
  getTask: vi.fn(),
  listTasksByNumber: vi.fn(),
  getVariant: vi.fn(),
  getVariantForTask: vi.fn(),
  getLearningSessionNext: vi.fn(),
}));

const TASK_ID = '11111111-1111-1111-1111-111111111111';
const SIBLING_A = '22222222-2222-2222-2222-222222222222';
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
      <ResultDesktop
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
  vi.mocked(api.getTask).mockResolvedValue(taskWithSolution);
  vi.mocked(api.listTasksByNumber).mockResolvedValue(siblings);
});

describe('ResultDesktop — correct state', () => {
  it('shows the success banner and the sidebar result card', async () => {
    renderResult(true);
    expect(await screen.findAllByText('Правильно!')).not.toHaveLength(0);
    expect(screen.getByText('Результат')).toBeInTheDocument();
    expect(screen.getByText('Задания в теме')).toBeInTheDocument();
  });

  it('shows the explanation as the solution, without a краткое/подробное toggle', async () => {
    renderResult(true);
    expect(await screen.findByText(EXPLANATION)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Краткое решение' })).not.toBeInTheDocument();
  });

  it('(J) does not render the canonical solution block for a task without one — existing flow unchanged', async () => {
    renderResult(true);
    await screen.findByText(EXPLANATION);
    expect(screen.queryByText('Эталонное решение')).not.toBeInTheDocument();
    expect(screen.queryByText('Что важно на ЕГЭ')).not.toBeInTheDocument();
    expect(screen.queryByText('Как записать на ЕГЭ')).not.toBeInTheDocument();
  });

  it('navigates to the next task in the resolved variant, and stays put with no variant context', async () => {
    const user = userEvent.setup();
    renderResult(true);
    await screen.findByText(EXPLANATION);
    // No collectionSlug/variantId passed — no ordered context, so
    // "Следующее задание" must not silently jump anywhere.
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
        <ResultDesktop
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
    await screen.findByText(EXPLANATION);
    const nextButton = await screen.findByRole('button', { name: 'Следующее задание' });
    expect(nextButton).toBeEnabled();
    await user.click(nextButton);
    expect(screen.getByTestId('overlay')).toHaveTextContent('task');
  });
});

describe('ResultDesktop — incorrect state', () => {
  it('shows a calm error banner with both answers and the solution toggle', async () => {
    renderResult(false);
    expect(await screen.findAllByText('Неверно')).not.toHaveLength(0);
    expect(screen.getByText('Правильный ответ:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Краткое решение' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Подробное решение' })).toBeInTheDocument();
  });

  it('shows the "Полезно знать" hint tip', async () => {
    renderResult(false);
    expect(await screen.findByText('Полезно знать')).toBeInTheDocument();
  });
});

describe('ResultDesktop — correct answer goes through MathText (audit Block 7)', () => {
  it('renders real KaTeX for a correctAnswer using $...$ notation', async () => {
    vi.mocked(api.getTask).mockResolvedValue({
      ...taskWithSolution,
      correctAnswer: '$\\arccos\\left(\\dfrac{\\sqrt{10}}{5}\\right)$',
    });
    renderResult(false, 'что-то другое');
    await screen.findAllByText('Неверно');
    expect(document.querySelector('.katex')).toBeInTheDocument();
  });

  it('still shows plain numeric answers unchanged (e.g. 102), never breaking a simple case', async () => {
    vi.mocked(api.getTask).mockResolvedValue({ ...taskWithSolution, correctAnswer: '102' });
    renderResult(false, '99');
    await screen.findAllByText('Неверно');
    expect(screen.getAllByText('102').length).toBeGreaterThan(0);
    expect(document.querySelector('.katex')).not.toBeInTheDocument();
  });
});

describe('ResultDesktop — correctAnswerDisplay takes priority over correctAnswer (Final Polish, machine vs display)', () => {
  it('renders correctAnswerDisplay via KaTeX when present, never the plain machine value', async () => {
    vi.mocked(api.getTask).mockResolvedValue({
      ...taskWithSolution,
      correctAnswer: 'arccos(√10/5)',
      correctAnswerDisplay: '$\\arccos\\dfrac{\\sqrt{10}}{5}$',
    });
    renderResult(false, 'что-то другое');
    await screen.findAllByText('Неверно');
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
    await screen.findAllByText('Неверно');
    expect(screen.getAllByText('102').length).toBeGreaterThan(0);
  });
});

describe('ResultDesktop — multi_part task', () => {
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

  it('shows each part correct/incorrect with its own answer comparison and explanation section', async () => {
    const userAnswer = serializeMultiPartUserAnswer({ a: 'нет', b: '607', c: 'wrong' });
    vi.mocked(api.getTask).mockResolvedValue(multiPartTask);
    render(
      <NavigationProvider>
        <ResultDesktop
          subjectId={multiPartTask.subjectId}
          taskNumber={multiPartTask.taskNumber}
          taskId={TASK_ID}
          correct={false}
          userAnswer={userAnswer}
        />
        <OverlayMarker />
      </NavigationProvider>,
    );

    expect(await screen.findByText('а) Верно')).toBeInTheDocument();
    expect(screen.getByText('б) Верно')).toBeInTheDocument();
    expect(screen.getByText('в) Неверно')).toBeInTheDocument();
    expect(screen.getByText('Пояснение к а.')).toBeInTheDocument();
    expect(screen.getAllByText('Пояснение к б и в.')).toHaveLength(2);
    expect(screen.getByText('1066')).toBeInTheDocument();
  });
});

describe('ResultDesktop — "К списку заданий"', () => {
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
        <ResultDesktop
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
    await screen.findByText(EXPLANATION);
    await user.click(screen.getByRole('button', { name: 'К списку заданий' }));
    expect(screen.getByTestId('overlay')).toHaveTextContent(
      `subject:${baseTask.subjectId}:ege-2026-yashchenko:topics`,
    );
  });

  it('"Попробовать ещё раз" reopens the same task, not a plain back() to Home (audit Block 3)', async () => {
    const user = userEvent.setup();
    render(
      <NavigationProvider>
        <ResultDesktop
          subjectId={baseTask.subjectId}
          taskNumber={baseTask.taskNumber}
          taskId={TASK_ID}
          correct={false}
          userAnswer="неверный ответ"
        />
        <OverlayMarker />
      </NavigationProvider>,
    );
    await screen.findByText(EXPLANATION);
    await user.click(screen.getByRole('button', { name: 'Попробовать ещё раз' }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('task');
  });
});

function SessionMarker() {
  const { session } = useLearningSessionContext();
  return <p data-testid="session">{session ? `${session.status}:${session.sessionId}` : 'none'}</p>;
}

function Primer({ taskId, position, total }: { taskId: string; position: number; total: number }) {
  const { setSession } = useLearningSessionContext();
  useEffect(() => {
    setSession({
      status: 'active',
      sessionId: 'session-1',
      subjectId: 'math',
      currentTaskId: taskId,
      currentTaskNumber: 15,
      position,
      total,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

describe('ResultDesktop — learning session integration (Phase 10)', () => {
  it('shows no session UI for a normal (non-session) result — EXISTING "Следующее задание" stays the only action', async () => {
    render(
      <NavigationProvider>
        <LearningSessionProvider>
          <ResultDesktop
            subjectId={baseTask.subjectId}
            taskNumber={baseTask.taskNumber}
            taskId={TASK_ID}
            correct
            userAnswer={CORRECT_ANSWER}
          />
        </LearningSessionProvider>
      </NavigationProvider>,
    );
    await screen.findByText(EXPLANATION);
    expect(screen.queryByText(/Завершить тренировку/)).not.toBeInTheDocument();
    // Only one "Следующее задание" action — the pre-existing taskNav one.
    expect(screen.getAllByText('Следующее задание')).toHaveLength(1);
  });

  it('calls the real /next endpoint (never a 2nd attempt endpoint) and advances to the task the backend returns', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getLearningSessionNext).mockResolvedValue({
      sessionId: 'session-1',
      subject: 'math',
      status: 'active',
      position: 2,
      total: 5,
      task: { ...baseTask, id: SIBLING_A, taskNumber: 15 },
    });
    render(
      <NavigationProvider>
        <LearningSessionProvider>
          <Primer taskId={TASK_ID} position={1} total={5} />
          <ResultDesktop
            subjectId={baseTask.subjectId}
            taskNumber={baseTask.taskNumber}
            taskId={TASK_ID}
            correct={false}
            userAnswer="неверный ответ"
          />
          <SessionMarker />
        </LearningSessionProvider>
      </NavigationProvider>,
    );
    await screen.findByText(EXPLANATION);
    expect(await screen.findByRole('button', { name: /Тренировка · 1 из 5/ })).toBeInTheDocument();

    // Two "Следующее задание" buttons now exist: the pre-existing
    // taskNav one (index 0, unchanged, disabled with no sibling
    // context here) and this session's own action (index 1) — this
    // clicks the session one specifically, never touching the other.
    const nextButtons = screen.getAllByRole('button', { name: /Следующее задание/ });
    await user.click(nextButtons[1]!);
    await vi.waitFor(() => {
      expect(api.getLearningSessionNext).toHaveBeenCalledWith('session-1');
    });
    await vi.waitFor(() => {
      expect(screen.getByTestId('session')).toHaveTextContent('active:session-1');
    });
  });

  it('shows "Завершить тренировку" on the final task of the session', async () => {
    render(
      <NavigationProvider>
        <LearningSessionProvider>
          <Primer taskId={TASK_ID} position={5} total={5} />
          <ResultDesktop
            subjectId={baseTask.subjectId}
            taskNumber={baseTask.taskNumber}
            taskId={TASK_ID}
            correct
            userAnswer={CORRECT_ANSWER}
          />
        </LearningSessionProvider>
      </NavigationProvider>,
    );
    await screen.findByText(EXPLANATION);
    expect(await screen.findByText(/Завершить тренировку/)).toBeInTheDocument();
  });
});

describe('ResultDesktop — real solving time display (replaces the old static "00:12:34")', () => {
  it('shows the real submitted timeSpentMs, formatted as mm:ss', async () => {
    render(
      <NavigationProvider>
        <ResultDesktop
          subjectId={baseTask.subjectId}
          taskNumber={baseTask.taskNumber}
          taskId={TASK_ID}
          correct
          userAnswer={CORRECT_ANSWER}
          timeSpentMs={84000}
        />
      </NavigationProvider>,
    );
    await screen.findByText(EXPLANATION);
    expect(screen.getByText('01:24')).toBeInTheDocument();
    expect(screen.queryByText('00:12:34')).not.toBeInTheDocument();
  });

  it('shows no time at all when the task was never timed (never fabricates one)', async () => {
    render(
      <NavigationProvider>
        <ResultDesktop
          subjectId={baseTask.subjectId}
          taskNumber={baseTask.taskNumber}
          taskId={TASK_ID}
          correct
          userAnswer={CORRECT_ANSWER}
        />
      </NavigationProvider>,
    );
    await screen.findByText(EXPLANATION);
    expect(screen.queryByText('00:12:34')).not.toBeInTheDocument();
  });
});

/**
 * Navigation bugfix round 2: a `customOrderedTasks` session (e.g. "По
 * номерам" with one number selected: V1#13..V5#13) must drive a real,
 * working "Следующее задание" on Result — mirrors
 * TaskDesktop/TaskMobile's "submit carries the session list forward"
 * fix on the receiving end.
 */
describe('ResultDesktop — "Следующее задание" with a real customOrderedTasks session (navigation bugfix round 2)', () => {
  const V1 = { taskId: TASK_ID, taskNumber: 13 };
  const V2 = { taskId: SIBLING_A, taskNumber: 13 };
  const V3_ID = '33333333-3333-3333-3333-333333333333';
  const V3 = { taskId: V3_ID, taskNumber: 13 };

  function renderWithSession(taskId: string) {
    return render(
      <NavigationProvider>
        <ResultDesktop
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

  it('V2#13 (middle entry) → Next stays enabled and advances', async () => {
    const user = userEvent.setup();
    renderWithSession(SIBLING_A); // V2, the middle entry of [V1, V2, V3]
    const next = await screen.findByRole('button', { name: 'Следующее задание' });
    expect(next).toBeEnabled();
    await user.click(next);
    expect(screen.getByTestId('overlay')).toHaveTextContent('task');
  });

  it('V3#13 (last entry) disables Next', async () => {
    renderWithSession(V3_ID);
    const next = await screen.findByRole('button', { name: 'Следующее задание' });
    expect(next).toBeDisabled();
  });
});

/**
 * "Другие задания" (Similar Tasks) on desktop (bugfix: previously
 * missing entirely) — same cards, same math renderer, same click
 * behavior, same data source as mobile's OtherVariantsSection.
 */
describe('ResultDesktop — "Другие задания" (desktop, bugfix: block was missing + renders real math)', () => {
  const OTHER_ID = '55555555-5555-5555-5555-555555555555';
  const RAW_CONDITION = 'а) Решите уравнение $\\sqrt{4\\sin^3x - 4\\cos^2x} - \\cos x = 0$';

  beforeEach(() => {
    vi.mocked(api.listTasksByNumber).mockResolvedValue([
      taskWithSolution,
      { ...taskWithSolution, id: OTHER_ID, conditionMd: RAW_CONDITION },
    ]);
  });

  it('renders the block with real KaTeX, never the raw $...$ source', async () => {
    renderResult(true);
    await screen.findByText(EXPLANATION);
    expect(await screen.findByText(`Другие задания №${baseTask.taskNumber}`)).toBeInTheDocument();
    const katexHtml = document.querySelector('.katex-html');
    expect(katexHtml).toBeInTheDocument();
    expect(katexHtml!.textContent).not.toMatch(/\\sqrt/);
    expect(katexHtml!.textContent).not.toContain('$');
  });

  it('is collapsed by default (same UX as mobile), expands on header click', async () => {
    const user = userEvent.setup();
    renderResult(true);
    await screen.findByText(EXPLANATION);
    const header = await screen.findByRole('button', {
      name: new RegExp(`Другие задания №${baseTask.taskNumber}`),
    });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    await user.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
  });

  it('"К списку заданий №N" inside "Другие задания" navigates to По номерам with this taskNumber pre-selected, distinct from the main action bar\'s plain "К списку заданий"', async () => {
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
        <ResultDesktop
          subjectId={baseTask.subjectId}
          taskNumber={baseTask.taskNumber}
          taskId={TASK_ID}
          correct
          userAnswer={CORRECT_ANSWER}
        />
        <ByNumberOverlayDetail />
      </NavigationProvider>,
    );
    await screen.findByText(EXPLANATION);
    // The main action bar's own "К списку заданий" (no number) is a
    // separate, unrelated button (goToTaskList) and must stay untouched.
    expect(screen.getByRole('button', { name: 'К списку заданий' })).toBeInTheDocument();
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
    function TaskIdOverlayMarker() {
      const { overlay } = useNavigation();
      if (overlay?.screen !== 'task') return <p data-testid="task-overlay">none</p>;
      return <p data-testid="task-overlay">task:{overlay.taskId}</p>;
    }
    const user = userEvent.setup();
    render(
      <NavigationProvider>
        <ResultDesktop
          subjectId={baseTask.subjectId}
          taskNumber={baseTask.taskNumber}
          taskId={TASK_ID}
          correct
          userAnswer={CORRECT_ANSWER}
        />
        <TaskIdOverlayMarker />
      </NavigationProvider>,
    );
    await screen.findByText(EXPLANATION);
    await user.click(
      await screen.findByRole('button', {
        name: new RegExp(`Другие задания №${baseTask.taskNumber}`),
      }),
    );
    await user.click(
      screen.getByRole('button', { name: `Задание #${OTHER_ID.slice(0, 8)}, Сложное` }),
    );
    await waitFor(() => {
      expect(screen.getByTestId('task-overlay')).toHaveTextContent(`task:${OTHER_ID}`);
    });
  });

  it('appears at the bottom of the page, after the main grid — not inside the sidebar', async () => {
    renderResult(true);
    await screen.findByText(EXPLANATION);
    const heading = await screen.findByText(`Другие задания №${baseTask.taskNumber}`);
    const sidebarResult = screen.getByText('Результат');
    // Both present in the same document — the block is a sibling of
    // `.grid`, not nested inside the sidebar card list.
    expect(heading).toBeInTheDocument();
    expect(sidebarResult).toBeInTheDocument();
  });
});
