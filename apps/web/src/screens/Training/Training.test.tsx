import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Training } from './Training.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import {
  LearningSessionProvider,
  useLearningSessionContext,
} from '../../lib/learningSessionContext.js';
import * as api from '../../lib/api.js';

vi.mock('../../lib/api.js', () => {
  class MockApiError extends Error {
    constructor(
      public status: number,
      public body: unknown,
    ) {
      super(`API request failed with status ${status}`);
    }
  }
  return {
    listCollections: vi.fn(),
    getRandomTask: vi.fn(),
    getProgressByTopic: vi.fn(),
    startLearningSession: vi.fn(),
    startVariantSession: vi.fn(),
    ApiError: MockApiError,
  };
});

const COLLECTION = {
  collection: {
    id: 'c1',
    subjectId: 'math',
    slug: 'ege-2026-yashchenko',
    title: 'ЕГЭ 2026 Ященко',
    publisher: 'Ященко',
    year: 2026,
    description: null,
  },
  variants: [
    { id: 'v1', collectionId: 'c1', variantNumber: 1, title: 'Вариант 1', year: 2026 },
    { id: 'v2', collectionId: 'c1', variantNumber: 2, title: 'Вариант 2', year: 2026 },
  ],
};

const TOPICS = {
  items: [
    { topicId: 'topic-logs', topicName: 'Логарифмические уравнения', completed: 2, total: 5 },
    { topicId: 'topic-stereo', topicName: 'Стереометрия', completed: 0, total: 3 },
  ],
};

const RANDOM_TASK = {
  id: 'task-1',
  subjectId: 'math',
  taskNumber: 5,
  topicId: null,
  topicName: null,
  difficulty: 2 as const,
  conditionMd: 'Условие',
  passage: null,
  imageUrl: null,
  hintMd: null,
  answerType: 'short_answer' as const,
  answerOptions: null,
  answerParts: null,
  source: 'ФИПИ',
  sourceUrl: null,
  sourceYear: 2026,
  tags: [],
  status: 'published' as const,
};

function OverlayMarker() {
  const { overlay } = useNavigation();
  if (overlay?.screen === 'task') {
    return <p data-testid="overlay">task:{overlay.taskNumber}</p>;
  }
  return <p data-testid="overlay">{overlay?.screen ?? 'none'}</p>;
}

function SessionMarker() {
  const { session } = useLearningSessionContext();
  return <p data-testid="session">{session ? `${session.status}:${session.sessionId}` : 'none'}</p>;
}

function renderTraining() {
  return render(
    <NavigationProvider>
      <LearningSessionProvider>
        <Training />
        <OverlayMarker />
        <SessionMarker />
      </LearningSessionProvider>
    </NavigationProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.listCollections).mockResolvedValue([]);
  vi.mocked(api.getProgressByTopic).mockResolvedValue(TOPICS);
});

describe('Training — structure (no "Быстрый старт")', () => {
  it('renders Предмет → Режим тренировки, with no "Быстрый старт" block', () => {
    renderTraining();
    expect(screen.queryByText('Быстрый старт')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /По теме/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Мои ошибки/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Умная тренировка/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Вариант/ })).toBeInTheDocument();
    // "Повторение" had no real logic behind it and was dropped, not
    // kept as a dead placeholder.
    expect(screen.queryByText('Повторение')).not.toBeInTheDocument();
  });

  it('selects a training mode and shows clear selected-state feedback', async () => {
    const user = userEvent.setup();
    renderTraining();
    const topicMode = screen.getByRole('button', { name: /По теме/ });
    const mistakesMode = screen.getByRole('button', { name: /Мои ошибки/ });
    expect(topicMode).toHaveAttribute('aria-pressed', 'true');
    await user.click(mistakesMode);
    expect(mistakesMode).toHaveAttribute('aria-pressed', 'true');
    expect(topicMode).toHaveAttribute('aria-pressed', 'false');
  });

  it('navigates straight to the real Mistakes screen for "Мои ошибки", without fetching a task', async () => {
    const user = userEvent.setup();
    renderTraining();
    await user.click(screen.getByRole('button', { name: /Мои ошибки/ }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('mistakes');
    expect(api.getRandomTask).not.toHaveBeenCalled();
  });
});

describe('Training — "По теме" (real topics, independent 🎲/🔄, numbers, amount)', () => {
  it('lists real topics from GET /progress/by-topic, never a static/fake list', async () => {
    renderTraining();
    expect(
      await screen.findByRole('button', { name: 'Логарифмические уравнения' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Стереометрия' })).toBeInTheDocument();
  });

  it('requires a topic before starting', async () => {
    const user = userEvent.setup();
    renderTraining();
    await screen.findByRole('button', { name: 'Логарифмические уравнения' });
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    expect(await screen.findByText('Выбери тему, чтобы начать.')).toBeInTheDocument();
    expect(api.getRandomTask).not.toHaveBeenCalled();
  });

  it('starts an "∞ Без ограничения" single task for the selected topic by default', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getRandomTask).mockResolvedValue(RANDOM_TASK);
    renderTraining();
    await user.click(await screen.findByRole('button', { name: 'Логарифмические уравнения' }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() => {
      expect(api.getRandomTask).toHaveBeenCalledTimes(1);
      expect(api.getRandomTask).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'math', topic: 'topic-logs' }),
      );
    });
    await waitFor(() => expect(screen.getByTestId('overlay')).toHaveTextContent('task:5'));
  });

  it('🎲 and 🔄 are independent for topic training — both can be on at once', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getRandomTask).mockResolvedValue(RANDOM_TASK);
    renderTraining();
    await user.click(await screen.findByRole('button', { name: 'Логарифмические уравнения' }));
    await user.click(screen.getByRole('button', { name: 'Случайное' }));
    await user.click(screen.getByRole('button', { name: 'Только нерешённые' }));
    expect(screen.getByRole('button', { name: 'Случайное' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Только нерешённые' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() => {
      expect(api.getRandomTask).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'topic-logs', unseen: true }),
      );
    });
  });

  it('narrows to specific numbers within the topic, one real task per number', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getRandomTask).mockImplementation((params) =>
      Promise.resolve({
        ...RANDOM_TASK,
        id: `task-${params.taskNumber}`,
        taskNumber: params.taskNumber!,
      }),
    );
    renderTraining();
    await user.click(await screen.findByRole('button', { name: 'Логарифмические уравнения' }));
    await user.click(screen.getByRole('button', { name: '№13' }));
    await user.click(screen.getByRole('button', { name: '№15' }));
    await user.click(screen.getByRole('button', { name: 'Только нерешённые' }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));

    await waitFor(() => expect(api.getRandomTask).toHaveBeenCalledTimes(2));
    expect(api.getRandomTask).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ topic: 'topic-logs', taskNumber: 13, unseen: true }),
    );
    expect(api.getRandomTask).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ topic: 'topic-logs', taskNumber: 15, unseen: true }),
    );
  });

  it('hides the amount selector once specific numbers are picked (amount only applies without numbers)', async () => {
    const user = userEvent.setup();
    renderTraining();
    await user.click(await screen.findByRole('button', { name: 'Логарифмические уравнения' }));
    expect(screen.getByText('Количество заданий')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '№13' }));
    expect(screen.queryByText('Количество заданий')).not.toBeInTheDocument();
  });

  it('a fixed amount (e.g. 5) resolves that many real tasks for the topic', async () => {
    const user = userEvent.setup();
    let call = 0;
    vi.mocked(api.getRandomTask).mockImplementation(() => {
      call += 1;
      return Promise.resolve({ ...RANDOM_TASK, id: `task-${call}` });
    });
    renderTraining();
    await user.click(await screen.findByRole('button', { name: 'Логарифмические уравнения' }));
    await user.click(screen.getByRole('button', { name: '5' }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() => expect(api.getRandomTask).toHaveBeenCalledTimes(5));
  });

  it('"Своё число" validates a positive integer before starting', async () => {
    const user = userEvent.setup();
    renderTraining();
    await user.click(await screen.findByRole('button', { name: 'Логарифмические уравнения' }));
    await user.click(screen.getByRole('button', { name: 'Своё число' }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    expect(
      await screen.findByText('Количество заданий должно быть положительным числом.'),
    ).toBeInTheDocument();
    expect(api.getRandomTask).not.toHaveBeenCalled();
  });

  it('"Своё число" resolves exactly the typed amount of real tasks', async () => {
    const user = userEvent.setup();
    let call = 0;
    vi.mocked(api.getRandomTask).mockImplementation(() => {
      call += 1;
      return Promise.resolve({ ...RANDOM_TASK, id: `task-${call}` });
    });
    renderTraining();
    await user.click(await screen.findByRole('button', { name: 'Логарифмические уравнения' }));
    await user.click(screen.getByRole('button', { name: 'Своё число' }));
    await user.type(screen.getByLabelText('Сколько заданий'), '7');
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() => expect(api.getRandomTask).toHaveBeenCalledTimes(7));
  });

  it('shows an honest "no unseen tasks" message for the topic, never a silent fallback', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getRandomTask).mockRejectedValue(
      new api.ApiError(404, { error: 'no_unseen_tasks' }),
    );
    renderTraining();
    await user.click(await screen.findByRole('button', { name: 'Логарифмические уравнения' }));
    await user.click(screen.getByRole('button', { name: 'Только нерешённые' }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    expect(
      await screen.findByText(/Нерешённых заданий по этой теме больше нет/),
    ).toBeInTheDocument();
  });
});

function variantSessionResponse(variantId: string, variantNumber: number) {
  return {
    sessionId: `session-${variantId}`,
    subject: 'math',
    status: 'active' as const,
    position: 1,
    total: 1,
    task: RANDOM_TASK,
    variant: { variantId, variantNumber, variantTitle: `Вариант ${variantNumber}` },
  };
}

describe('Training — "Вариант" (compact independent 🎲/🔄)', () => {
  it('starts a manually picked variant as a real backend session when both toggles are off', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listCollections).mockResolvedValue([COLLECTION]);
    vi.mocked(api.startVariantSession).mockResolvedValue(variantSessionResponse('v1', 1));
    renderTraining();

    await user.click(screen.getByRole('button', { name: /^Вариант/ }));
    const collectionTrigger = await screen.findByRole('button', { name: /Все источники/ });
    await user.click(collectionTrigger);
    await user.click(await screen.findByRole('option', { name: 'ЕГЭ 2026 Ященко' }));
    await user.click(await screen.findByRole('button', { name: 'Вариант 1' }));

    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() => {
      expect(screen.getByTestId('overlay')).toHaveTextContent('task:5');
    });
    expect(api.startVariantSession).toHaveBeenCalledWith('v1');
    expect(screen.getByTestId('session')).toHaveTextContent('active:session-v1');
  });

  it('requires a manual pick when both 🎲 and 🔄 are off', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listCollections).mockResolvedValue([COLLECTION]);
    renderTraining();
    await user.click(screen.getByRole('button', { name: /^Вариант/ }));
    const collectionTrigger = await screen.findByRole('button', { name: /Все источники/ });
    await user.click(collectionTrigger);
    await user.click(await screen.findByRole('option', { name: 'ЕГЭ 2026 Ященко' }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    expect(await screen.findByText('Выбери вариант, чтобы начать.')).toBeInTheDocument();
  });

  it('🎲 "Случайный вариант" picks one of the real variants automatically', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listCollections).mockResolvedValue([COLLECTION]);
    vi.mocked(api.startVariantSession).mockResolvedValue(variantSessionResponse('v1', 1));
    renderTraining();
    await user.click(screen.getByRole('button', { name: /^Вариант/ }));
    const collectionTrigger = await screen.findByRole('button', { name: /Все источники/ });
    await user.click(collectionTrigger);
    await user.click(await screen.findByRole('option', { name: 'ЕГЭ 2026 Ященко' }));
    await user.click(screen.getByRole('button', { name: 'Случайный вариант' }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() => expect(api.startVariantSession).toHaveBeenCalled());
  });

  it('🔄 "Только нерешённые" skips a variant whose tasks are all already attempted', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listCollections).mockResolvedValue([COLLECTION]);
    vi.mocked(api.getRandomTask).mockImplementation((params) =>
      params.variant === 'v1'
        ? Promise.reject(new api.ApiError(404, { error: 'no_unseen_tasks' }))
        : Promise.resolve(RANDOM_TASK),
    );
    vi.mocked(api.startVariantSession).mockResolvedValue(variantSessionResponse('v2', 2));
    renderTraining();
    await user.click(screen.getByRole('button', { name: /^Вариант/ }));
    const collectionTrigger = await screen.findByRole('button', { name: /Все источники/ });
    await user.click(collectionTrigger);
    await user.click(await screen.findByRole('option', { name: 'ЕГЭ 2026 Ященко' }));
    await user.click(screen.getByRole('button', { name: 'Только нерешённые' }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() => expect(api.startVariantSession).toHaveBeenCalledWith('v2'));
  });

  it('shows an honest message when every variant is fully solved', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listCollections).mockResolvedValue([COLLECTION]);
    vi.mocked(api.getRandomTask).mockRejectedValue(
      new api.ApiError(404, { error: 'no_unseen_tasks' }),
    );
    renderTraining();
    await user.click(screen.getByRole('button', { name: /^Вариант/ }));
    const collectionTrigger = await screen.findByRole('button', { name: /Все источники/ });
    await user.click(collectionTrigger);
    await user.click(await screen.findByRole('option', { name: 'ЕГЭ 2026 Ященко' }));
    await user.click(screen.getByRole('button', { name: 'Только нерешённые' }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    expect(await screen.findByText(/Нет вариантов с нерешёнными заданиями/)).toBeInTheDocument();
    expect(api.startVariantSession).not.toHaveBeenCalled();
  });
});

describe('Training — "Умная тренировка" (Phase 10: real backend learning session, unchanged)', () => {
  it('starts a real session via the API and stores the real sessionId, never a fake one', async () => {
    const user = userEvent.setup();
    vi.mocked(api.startLearningSession).mockResolvedValue({
      sessionId: 'session-42',
      subject: 'math',
      status: 'active',
      position: 1,
      total: 5,
      task: RANDOM_TASK,
    });
    renderTraining();

    await user.click(screen.getByRole('button', { name: /Умная тренировка/ }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));

    await waitFor(() => {
      expect(api.startLearningSession).toHaveBeenCalledWith(
        expect.objectContaining({ subjectId: 'math', limit: 5 }),
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('overlay')).toHaveTextContent('task:5');
    });
    expect(screen.getByTestId('session')).toHaveTextContent('active:session-42');
  });

  it('passes the 🎲/🔄 toggles through to startLearningSession, independent of each other', async () => {
    const user = userEvent.setup();
    vi.mocked(api.startLearningSession).mockResolvedValue({
      sessionId: 'session-42',
      subject: 'math',
      status: 'active',
      position: 1,
      total: 5,
      task: RANDOM_TASK,
    });
    renderTraining();

    await user.click(screen.getByRole('button', { name: /Умная тренировка/ }));
    await user.click(screen.getByRole('button', { name: 'Случайное' }));
    await user.click(screen.getByRole('button', { name: 'Только нерешённые' }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));

    await waitFor(() => {
      expect(api.startLearningSession).toHaveBeenCalledWith(
        expect.objectContaining({
          subjectId: 'math',
          limit: 5,
          randomizeTopTier: true,
          unseenOnly: true,
        }),
      );
    });
  });

  it('shows an error and never fakes a session when the backend can find no candidate task', async () => {
    const user = userEvent.setup();
    vi.mocked(api.startLearningSession).mockResolvedValue(null);
    renderTraining();

    await user.click(screen.getByRole('button', { name: /Умная тренировка/ }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));

    expect(
      await screen.findByText(/Не нашлось подходящих заданий для умной тренировки/),
    ).toBeInTheDocument();
    expect(screen.getByTestId('session')).toHaveTextContent('none');
    expect(screen.getByTestId('overlay')).not.toHaveTextContent('task');
  });
});
