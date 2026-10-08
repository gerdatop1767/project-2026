import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatisticsMobile } from './StatisticsMobile.js';
import { NavigationProvider } from '../../lib/navigation.js';
import * as api from '../../lib/api.js';

vi.mock('../../lib/api.js', () => ({
  getProgressSummary: vi.fn(),
  getProgressByTaskNumber: vi.fn(),
  getProgressByTopic: vi.fn(),
  getMistakes: vi.fn(),
  getRandomTask: vi.fn(() => new Promise(() => {})),
  getTaskNumberStatisticsDetail: vi.fn(() => new Promise(() => {})),
  getVariantProgress: vi.fn(() => Promise.resolve({ items: [] })),
}));

function renderWithNav() {
  return render(
    <NavigationProvider>
      <StatisticsMobile />
    </NavigationProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.getProgressSummary).mockResolvedValue({
    solvedTotal: 0,
    correctTotal: 0,
    incorrectTotal: 0,
    accuracyPercent: 0,
    bySubject: [],
    byTaskNumber: [],
    byTopic: [],
    timeBySubject: [],
  });
  vi.mocked(api.getProgressByTaskNumber).mockResolvedValue({ items: [] });
  vi.mocked(api.getProgressByTopic).mockResolvedValue({ items: [] });
  vi.mocked(api.getMistakes).mockResolvedValue([]);
});

describe('StatisticsMobile — subject filter', () => {
  it('opens a real subject picker from the header and refilters every real metric', async () => {
    vi.mocked(api.getProgressSummary).mockResolvedValue({
      solvedTotal: 20,
      correctTotal: 15,
      incorrectTotal: 5,
      accuracyPercent: 75,
      bySubject: [
        { subjectId: 'math', solved: 12, correct: 9, accuracyPercent: 75, uniqueSolved: 12 },
        { subjectId: 'russian', solved: 8, correct: 6, accuracyPercent: 75, uniqueSolved: 8 },
      ],
      byTaskNumber: [],
      byTopic: [],
      timeBySubject: [],
    });
    const user = userEvent.setup();
    renderWithNav();

    // Default subject is "Математика" — real data for it shows up.
    await waitFor(() => expect(screen.getByText('9 верных')).toBeInTheDocument());
    expect(vi.mocked(api.getProgressByTaskNumber)).toHaveBeenLastCalledWith({ subject: 'math' });

    await user.click(screen.getByRole('button', { name: /Математика/ }));
    await user.click(screen.getByRole('option', { name: /Русский язык/ }));

    // Switching subjects refetches the subject-scoped endpoints with the
    // new subject, and the headline figure switches to that subject's
    // real bySubject row — not the aggregate, not the previous subject.
    await waitFor(() =>
      expect(vi.mocked(api.getProgressByTaskNumber)).toHaveBeenLastCalledWith({
        subject: 'russian',
      }),
    );
    await waitFor(() => expect(screen.getByText('6 верных')).toBeInTheDocument());
    // /progress/summary and /mistakes are fetched once, not re-requested
    // per subject switch — they're filtered client-side instead.
    expect(vi.mocked(api.getProgressSummary)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.getMistakes)).toHaveBeenCalledTimes(1);
  });
});

describe('StatisticsMobile', () => {
  it('shows the overview tab by default with real data, not a stub', () => {
    renderWithNav();
    expect(screen.getByText('Прогресс по заданиям')).toBeInTheDocument();
    expect(screen.queryByText('Экран в разработке — следующий блок.')).not.toBeInTheDocument();
  });

  it('По заданиям tab shows every real task number for the subject, not a hardcoded range', async () => {
    vi.mocked(api.getProgressByTaskNumber).mockResolvedValue({
      items: Array.from({ length: 19 }, (_, i) => ({
        subjectId: 'math',
        taskNumber: i + 1,
        total: 1,
        completed: 0,
        correct: 0,
        incorrect: 0,
        accuracyPercent: null,
      })),
    });
    const user = userEvent.setup();
    renderWithNav();
    await user.click(screen.getByRole('tab', { name: 'По заданиям' }));
    expect(screen.queryByText('Экран в разработке — следующий блок.')).not.toBeInTheDocument();
    for (let n = 1; n <= 19; n += 1) {
      await screen.findByText(`№${n}`);
    }
  });

  it('По темам tab shows a neutral empty state, not fake hash rows, when there is no topic data', async () => {
    const user = userEvent.setup();
    renderWithNav();
    await user.click(screen.getByRole('tab', { name: 'По темам' }));
    expect(screen.queryByText('Экран в разработке — следующий блок.')).not.toBeInTheDocument();
    expect(screen.getByText('Пока нет данных по темам.')).toBeInTheDocument();
    expect(screen.getByText('Пока нет данных об ошибках.')).toBeInTheDocument();
  });

  it('По темам tab shows real topics fetched from the API', async () => {
    vi.mocked(api.getProgressByTopic).mockResolvedValue({
      items: [{ topicId: 't1', topicName: 'Логарифмы', total: 4, completed: 2 }],
    });
    const user = userEvent.setup();
    renderWithNav();
    await user.click(screen.getByRole('tab', { name: 'По темам' }));
    await waitFor(() => expect(screen.getAllByText('Логарифмы').length).toBeGreaterThan(0));
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('Пробники tab shows the real Статистика вариантов empty state, never a fabricated "0 пробников решено"', async () => {
    const user = userEvent.setup();
    renderWithNav();
    await user.click(screen.getByRole('tab', { name: 'Пробники' }));
    expect(screen.queryByText('Экран в разработке — следующий блок.')).not.toBeInTheDocument();
    expect(screen.queryByText('0 пробников решено')).not.toBeInTheDocument();
    expect(screen.queryByText('пробные варианты ещё не поддерживаются')).not.toBeInTheDocument();
    expect(screen.getByText('Ты ещё не решал варианты')).toBeInTheDocument();
    expect(
      screen.getByText('Пройди полный вариант ЕГЭ — его результаты появятся здесь.'),
    ).toBeInTheDocument();
  });

  it('Пробники tab shows real completed variant sessions (same VariantHistoryCard/data as Общая)', async () => {
    vi.mocked(api.getVariantProgress).mockResolvedValue({
      items: [
        {
          sessionId: 'vs-1',
          variantId: 'v1',
          variantNumber: 3,
          variantTitle: 'Вариант 3',
          subjectId: 'math',
          status: 'completed',
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          plannedCount: 19,
          solvedCount: 19,
          correctCount: 17,
          incorrectCount: 2,
          accuracyPercent: 89,
          totalTimeMs: 3600000,
          keyErrors: [],
        },
      ],
    });
    const user = userEvent.setup();
    renderWithNav();
    await user.click(screen.getByRole('tab', { name: 'Пробники' }));
    expect(await screen.findByText('Вариант 3')).toBeInTheDocument();
    expect(screen.getByText('19 / 19 заданий')).toBeInTheDocument();
    expect(screen.queryByText('Ты ещё не решал варианты')).not.toBeInTheDocument();
  });

  it('every task-number card is a real tappable button', async () => {
    vi.mocked(api.getProgressByTaskNumber).mockResolvedValue({
      items: [{ subjectId: 'math', taskNumber: 1, total: 4, completed: 3, correct: 0, incorrect: 0, accuracyPercent: null }],
    });
    const user = userEvent.setup();
    renderWithNav();
    await user.click(screen.getByRole('tab', { name: 'По заданиям' }));
    const card = (await screen.findByText('№1')).closest('button');
    expect(card).toBeInTheDocument();
    // Should not throw when tapped.
    await user.click(card!);
  });

  it('shows a neutral dash for streak/average-time, never a fabricated number', () => {
    renderWithNav();
    expect(screen.getByText('Текущая серия')).toBeInTheDocument();
    expect(screen.getByText('Среднее время')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });
});

describe('StatisticsMobile — real progress data', () => {
  it('shows real per-task-number completion once the API responds, including untried numbers', async () => {
    vi.mocked(api.getProgressByTaskNumber).mockResolvedValue({
      items: [
        { subjectId: 'math', taskNumber: 1, total: 4, completed: 3, correct: 0, incorrect: 0, accuracyPercent: null },
        { subjectId: 'math', taskNumber: 2, total: 5, completed: 0, correct: 0, incorrect: 0, accuracyPercent: null },
      ],
    });
    const user = userEvent.setup();
    renderWithNav();
    await user.click(screen.getByRole('tab', { name: 'По заданиям' }));
    const grid = await screen.findByRole('list', { name: 'Прогресс по всем заданиям' });
    expect(within(grid).getByText('75%')).toBeInTheDocument();
    // Task numbers with no recorded attempt render as "не решалось",
    // not a fabricated percent.
    expect(within(grid).getAllByText('Не решалось').length).toBeGreaterThan(0);
  });

  it('the solvedTotal/accuracy headline tiles use real /progress/summary data for the selected subject', async () => {
    vi.mocked(api.getProgressSummary).mockResolvedValue({
      solvedTotal: 20,
      correctTotal: 15,
      incorrectTotal: 5,
      accuracyPercent: 75,
      bySubject: [{ subjectId: 'math', solved: 12, correct: 9, accuracyPercent: 75, uniqueSolved: 12 }],
      byTaskNumber: [],
      byTopic: [],
      timeBySubject: [],
    });
    renderWithNav();
    // The percent itself animates in (useCountUp) — assert the static,
    // non-animated delta label instead of racing the animation.
    await waitFor(() => expect(screen.getByText('9 верных')).toBeInTheDocument());
  });

  // Regression test for the mobile page flash: `solvedTotal`/
  // `accuracyPercent` used to collapse to a fake `0` while
  // `getProgressSummary` was still in flight, even though the
  // underlying `realProgress` state was already correctly
  // null-until-loaded. Must show an honest '···' placeholder.
  it('never shows a fake "0"/"0%" headline while /progress/summary is still loading', async () => {
    let resolveProgress!: (value: Awaited<ReturnType<typeof api.getProgressSummary>>) => void;
    vi.mocked(api.getProgressSummary).mockReturnValue(
      new Promise((resolve) => {
        resolveProgress = resolve;
      }),
    );
    renderWithNav();
    expect(screen.getAllByText('···').length).toBeGreaterThan(0);

    resolveProgress({
      solvedTotal: 20,
      correctTotal: 15,
      incorrectTotal: 5,
      accuracyPercent: 75,
      bySubject: [{ subjectId: 'math', solved: 12, correct: 9, accuracyPercent: 75, uniqueSolved: 12 }],
      byTaskNumber: [],
      byTopic: [],
      timeBySubject: [],
    });
    await waitFor(() => expect(screen.getByText('9 верных')).toBeInTheDocument());
  });

  it('the errors donut uses real /mistakes data, never the static sample set', async () => {
    vi.mocked(api.getMistakes).mockResolvedValue([
      {
        id: 'm1',
        taskId: 'task-1',
        subjectId: 'math',
        taskNumber: 5,
        topicName: 'Логарифмы',
        conditionMd: 'Условие',
        userAnswer: 'x',
        correctAnswer: 'y',
        timesWrong: 1,
        status: 'open',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    const user = userEvent.setup();
    renderWithNav();
    await user.click(screen.getByRole('tab', { name: 'По темам' }));
    await waitFor(() =>
      expect(screen.queryByText('Пока нет данных об ошибках.')).not.toBeInTheDocument(),
    );
  });
});

describe('StatisticsMobile — По номерам detail (Statistics 2.0)', () => {
  it('tapping a task number opens a full-screen detail with real data and a working back button', async () => {
    vi.mocked(api.getProgressByTaskNumber).mockResolvedValue({
      items: [{ subjectId: 'math', taskNumber: 5, total: 4, completed: 3, correct: 0, incorrect: 0, accuracyPercent: null }],
    });
    vi.mocked(api.getTaskNumberStatisticsDetail).mockResolvedValue({
      subjectId: 'math',
      taskNumber: 5,
      attempts: 4,
      uniqueTasksAttempted: 3,
      correctAttempts: 3,
      incorrectAttempts: 1,
      accuracy: 75,
      averageTimeMs: 12000,
      medianTimeMs: 11000,
      timedAttempts: 4,
      lastAttemptAt: new Date().toISOString(),
      taskType: 'Тригонометрические уравнения',
      errorBreakdown: [],
      skillBreakdown: [],
      recentAccuracy: null,
      previousAccuracy: null,
      recentAverageTimeMs: null,
      accuracyTrend: [],
      timeTrend: [],
      speedSignal: { value: null, baselineLevel: null, baselineMedianMs: null, sampleSize: 0 },
    });
    const user = userEvent.setup();
    renderWithNav();
    await user.click(screen.getByRole('tab', { name: 'По заданиям' }));
    await user.click(await screen.findByText('№5'));

    // The percent itself animates in (useCountUp) — assert the static,
    // non-animated delta label instead of racing the animation.
    expect(await screen.findByText('Тригонометрические уравнения')).toBeInTheDocument();
    expect(api.getTaskNumberStatisticsDetail).toHaveBeenCalledWith('math', 5);

    await user.click(screen.getByText('Статистика'));
    expect(screen.queryByText('Тригонометрические уравнения')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'По заданиям' })).toBeInTheDocument();
    // The grid card itself keeps showing the real completed/total count
    // (Block 3: "Всего заданий"/"Решено" must be real, not hidden) —
    // this is the same "3 из 4" the detail panel showed, now on the card.
    expect(screen.getByText('3 из 4')).toBeInTheDocument();
  });
});

describe('StatisticsMobile — Статистика вариантов', () => {
  it('shows an honest empty state when no variant has been started yet', async () => {
    vi.mocked(api.getVariantProgress).mockResolvedValue({ items: [] });
    renderWithNav();
    expect(
      await screen.findByText('Реши свой первый вариант в Тренировке — он появится здесь.'),
    ).toBeInTheDocument();
  });

  it('shows real variant history — completed and still-in-progress, never fabricated', async () => {
    vi.mocked(api.getVariantProgress).mockResolvedValue({
      items: [
        {
          sessionId: 's1',
          variantId: 'v1',
          variantNumber: 1,
          variantTitle: 'Вариант 1',
          subjectId: 'math',
          status: 'completed',
          startedAt: '2026-10-02T10:00:00.000Z',
          completedAt: '2026-10-02T11:42:00.000Z',
          plannedCount: 19,
          solvedCount: 19,
          correctCount: 17,
          incorrectCount: 2,
          accuracyPercent: 89,
          totalTimeMs: 6120000,
          keyErrors: [{ signature: 'incorrect_answer', count: 2 }],
        },
        {
          sessionId: 's2',
          variantId: 'v3',
          variantNumber: 3,
          variantTitle: 'Вариант 3',
          subjectId: 'math',
          status: 'active',
          startedAt: '2026-10-01T10:00:00.000Z',
          completedAt: null,
          plannedCount: 19,
          solvedCount: 12,
          correctCount: 8,
          incorrectCount: 4,
          accuracyPercent: 67,
          totalTimeMs: null,
          keyErrors: [],
        },
      ],
    });
    renderWithNav();

    expect(await screen.findByText('19 / 19 заданий')).toBeInTheDocument();
    expect(screen.getByText('17 правильных')).toBeInTheDocument();
    expect(screen.getByText('89%')).toBeInTheDocument();
    expect(screen.getByText('Время: 1 ч 42 мин')).toBeInTheDocument();
    expect(screen.getByText('Неверный ответ — 2')).toBeInTheDocument();

    // The still-active (abandoned) one shows its real partial progress,
    // never faked as finished.
    expect(screen.getByText('12 / 19 заданий')).toBeInTheDocument();
    expect(screen.getByText('67%')).toBeInTheDocument();
    expect(screen.getByText(/в процессе/)).toBeInTheDocument();
  });
});

describe('StatisticsMobile — Общая tab cleanup (no navigational clutter)', () => {
  it('never shows the "Решённые пробники"/"Мои ошибки"/"О проекте" cards on the main Общая tab', async () => {
    renderWithNav();
    await waitFor(() => expect(screen.getByText('Статистика вариантов')).toBeInTheDocument());
    expect(screen.queryByText('Решённые пробники')).not.toBeInTheDocument();
    expect(screen.queryByText('Мои ошибки')).not.toBeInTheDocument();
    expect(screen.queryByText('О проекте')).not.toBeInTheDocument();
    expect(screen.queryByText('0 пробников решено')).not.toBeInTheDocument();
  });
});
