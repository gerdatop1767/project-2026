import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { SmartSetupResponse, SmartSetupSkill } from '@zybrilka/shared';
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
    getSmartSetup: vi.fn(),
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

const skill = (key: string, n: number, extra: Partial<SmartSetupSkill> = {}): SmartSetupSkill => ({
  key,
  examNumber: n,
  title: `Тема ${n}`,
  mastery: null,
  level: 'none',
  attempts: 0,
  availableTasks: 30,
  openMistakes: 0,
  problem: null,
  ...extra,
});
const SETUP: SmartSetupResponse = {
  subjectId: 'math',
  skills: [
    skill('math.expressions', 7),
    skill('math.logs', 8, { availableTasks: 4, mastery: 40, level: 'weak', attempts: 5 }),
    skill('math.probability-basic', 4, { availableTasks: 3 }),
  ],
  problemKeys: [],
  subjectTasks: 400,
};

beforeEach(() => {
  vi.mocked(api.listCollections).mockResolvedValue([]);
  vi.mocked(api.getProgressByTopic).mockResolvedValue(TOPICS);
  vi.mocked(api.getSmartSetup).mockReset().mockResolvedValue(SETUP);
  vi.mocked(api.startLearningSession).mockReset();
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

describe('Training — topics loading states', () => {
  it('shows a skeleton while topics load, never an "empty" message', async () => {
    vi.mocked(api.getProgressByTopic).mockReturnValue(new Promise(() => {}));
    renderTraining();
    expect(screen.getByRole('status', { name: 'Загрузка тем' })).toBeInTheDocument();
    expect(screen.queryByText(/нет тем/i)).not.toBeInTheDocument();
  });

  it('shows an error with «Повторить» on failure, and retrying loads the topics', async () => {
    vi.mocked(api.getProgressByTopic).mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    renderTraining();
    expect(await screen.findByText('Не удалось загрузить темы.')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Загрузка тем' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('Логарифмические уравнения')).toBeInTheDocument();
    expect(screen.queryByText('Не удалось загрузить темы.')).not.toBeInTheDocument();
  });
});

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

describe('Training — «Умная тренировка» с настройкой', () => {
  const SESSION = {
    sessionId: 'session-42',
    subject: 'math',
    status: 'active' as const,
    position: 1,
    total: 10,
    task: RANDOM_TASK,
  };

  async function openSmart() {
    const user = userEvent.setup();
    renderTraining();
    await user.click(screen.getByRole('button', { name: /Умная тренировка/ }));
    await screen.findByRole('radiogroup', { name: 'Тип тренировки' });
    return user;
  }

  it('defaults to «По моей статистике», 10 tasks; starts a real session and stores its id', async () => {
    vi.mocked(api.startLearningSession).mockResolvedValue(SESSION);
    const user = await openSmart();
    expect(screen.getByRole('radio', { name: /По моей статистике/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const summary = screen.getByRole('region', { name: 'Твоя тренировка' });
    expect(within(summary).getByText('все темы предмета')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() =>
      expect(api.startLearningSession).toHaveBeenCalledWith({
        subjectId: 'math',
        limit: 10,
        unseenOnly: false,
        smart: { mode: 'stats', difficulty: 'mixed' },
      }),
    );
    await waitFor(() => expect(screen.getByTestId('overlay')).toHaveTextContent('task:5'));
    expect(screen.getByTestId('session')).toHaveTextContent('active:session-42');
  });

  it('«Конкретные темы»: topics with mastery and task counts; only the chosen ones are sent', async () => {
    vi.mocked(api.startLearningSession).mockResolvedValue(SESSION);
    const user = await openSmart();
    await user.click(screen.getByRole('radio', { name: /Конкретные темы/ }));
    expect(screen.getByRole('button', { name: 'Начать тренировку' })).toBeDisabled();
    expect(screen.getByText('Выбери хотя бы одну тему.')).toBeInTheDocument();
    expect(screen.getByText(/освоение 40% · 4 задания/)).toBeInTheDocument();
    expect(screen.getAllByText(/ещё не решал/).length).toBe(2);
    await user.click(screen.getByRole('checkbox', { name: /№7 · Тема 7/ }));
    await user.click(screen.getByRole('checkbox', { name: /№8 · Тема 8/ }));
    await user.click(screen.getByRole('radio', { name: 'Лёгкие' }));
    await user.click(screen.getByRole('button', { name: 'Только нерешённые' }));
    const summary = screen.getByRole('region', { name: 'Твоя тренировка' });
    expect(within(summary).getByText('№7 · Тема 7, №8 · Тема 8')).toBeInTheDocument();
    expect(within(summary).getByText('ближе к лёгким')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() =>
      expect(api.startLearningSession).toHaveBeenCalledWith({
        subjectId: 'math',
        limit: 10,
        unseenOnly: true,
        smart: {
          mode: 'topics',
          skillKeys: ['math.expressions', 'math.logs'],
          difficulty: 'easy',
        },
      }),
    );
  });

  it('not enough tasks in the chosen topics: says so and offers what there is', async () => {
    vi.mocked(api.startLearningSession).mockResolvedValue(SESSION);
    const user = await openSmart();
    await user.click(screen.getByRole('radio', { name: /Конкретные темы/ }));
    await user.click(screen.getByRole('checkbox', { name: /№8 · Тема 8/ }));
    await user.click(screen.getByRole('checkbox', { name: /№4 · Тема 4/ }));
    expect(screen.getByText(/Доступно до 7 заданий/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Своё' }));
    await user.type(screen.getByRole('spinbutton'), '9');
    expect(screen.getByText('В выбранных темах доступно 7.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Выбрать 7' }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() =>
      expect(api.startLearningSession).toHaveBeenCalledWith(expect.objectContaining({ limit: 7 })),
    );
  });

  it('the server finds fewer tasks (e.g. shared between topics): «Начать с N» restarts with N', async () => {
    vi.mocked(api.startLearningSession)
      .mockRejectedValueOnce(new api.ApiError(409, { error: 'not_enough_tasks', available: 6 }))
      .mockResolvedValueOnce(SESSION);
    const user = await openSmart();
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    expect(await screen.findByText(/подходят только 6 заданий/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Начать с 6' }));
    await waitFor(() =>
      expect(api.startLearningSession).toHaveBeenLastCalledWith(
        expect.objectContaining({ limit: 6 }),
      ),
    );
  });

  it('«Проблемные темы» without problems: an honest empty state, no start', async () => {
    const user = await openSmart();
    await user.click(screen.getByRole('radio', { name: /Проблемные темы/ }));
    expect(screen.getByText(/Пока нет тем с заметными проблемами/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Начать тренировку' })).toBeDisabled();
  });

  it('«Проблемные темы»: the student’s own problem topics with the reasons', async () => {
    vi.mocked(api.getSmartSetup).mockResolvedValue({
      ...SETUP,
      skills: SETUP.skills.map((s) =>
        s.key === 'math.logs'
          ? { ...s, problem: { score: 70, reasons: ['точность 40%', 'не исправлено ошибок: 3'] } }
          : s,
      ),
      problemKeys: ['math.logs'],
    });
    vi.mocked(api.startLearningSession).mockResolvedValue(SESSION);
    const user = await openSmart();
    await user.click(screen.getByRole('radio', { name: /Проблемные темы/ }));
    expect(screen.getByText('точность 40% · не исправлено ошибок: 3')).toBeInTheDocument();
    // Only 4 tasks in that topic: the count follows.
    await user.click(screen.getByRole('button', { name: 'Выбрать 4' }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() =>
      expect(api.startLearningSession).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 4, smart: { mode: 'problems', difficulty: 'mixed' } }),
      ),
    );
  });

  it('shows an error and never fakes a session when no task fits', async () => {
    vi.mocked(api.startLearningSession).mockResolvedValue(null);
    const user = await openSmart();
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    expect(await screen.findByText(/Не нашлось подходящих заданий/)).toBeInTheDocument();
    expect(screen.getByTestId('session')).toHaveTextContent('none');
  });
});
