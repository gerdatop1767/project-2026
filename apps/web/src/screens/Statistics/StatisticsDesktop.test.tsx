import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatisticsDesktop } from './StatisticsDesktop.js';
import { NavigationProvider } from '../../lib/navigation.js';
import * as api from '../../lib/api.js';
import { periodResponse } from '../../lib/periodStatsTestUtils.js';

vi.mock('../../lib/api.js', () => ({
  getLearningOverview: vi.fn(() => new Promise(() => {})),
  getLearningRecommendations: vi.fn(() => new Promise(() => {})),
  getDifficultyRating: vi.fn(() => new Promise(() => {})),
  rateTaskDifficulty: vi.fn(),
  getProgressSummary: vi.fn(),
  getProgressDaily: vi.fn(),
  getProgressPeriod: vi.fn(),
  getMistakes: vi.fn(),
  getProgressByTaskNumber: vi.fn(),
  getTaskNumberStatisticsDetail: vi.fn(),
  getVariantProgress: vi.fn(() => Promise.resolve({ items: [] })),
}));

function renderStatistics() {
  return render(
    <NavigationProvider>
      <StatisticsDesktop />
    </NavigationProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.getProgressPeriod).mockImplementation(async ({ period, subject }) =>
    periodResponse(period, { subjectId: subject }),
  );
  vi.mocked(api.getProgressSummary).mockResolvedValue({
    solvedTotal: 0,
    uniqueSolvedTotal: 0,
    correctTotal: 0,
    incorrectTotal: 0,
    accuracyPercent: 0,
    bySubject: [],
    byTaskNumber: [],
    byTopic: [],
    timeBySubject: [],
  });
  vi.mocked(api.getProgressDaily).mockResolvedValue({ items: [] });
  vi.mocked(api.getMistakes).mockResolvedValue([]);
  vi.mocked(api.getProgressByTaskNumber).mockResolvedValue({ items: [] });
});

/** The bars of "Активность по дням" — the chart renders once the daily
 * series has arrived (a skeleton stands in until then). */
async function expectBars(count: number) {
  await waitFor(() => {
    const chart = screen.getByRole('group', { name: /Решённые задания по дням/ });
    expect(chart.querySelector('[class*="bars"]')!.children).toHaveLength(count);
  });
}

/** A response whose numbers say which period and subject it belongs to. */
function tagged(period: Parameters<typeof periodResponse>[0], subject?: string) {
  const answers = { '7d': 7, '15d': 15, '30d': 30, '90d': 90, all: 400 }[period];
  return periodResponse(period, {
    subjectId: subject,
    totals: {
      answers,
      correct: answers - 2,
      wrong: 2,
      accuracyPercent: Math.round(((answers - 2) / answers) * 1000) / 10,
      solvedTasks: answers - 1,
      attemptedTasks: answers,
      activeDays: 3,
      timeSpentMs: answers * 60_000,
      averageTimeMs: 60_000,
      medianTimeMs: 60_000,
    },
    days: [{ date: '2026-11-19', answers: 4, correct: 3, solvedTasks: 5 }],
    firstActive: '2026-03-01',
    bySubject: [
      {
        subjectId: 'math',
        answers,
        correct: answers - 2,
        wrong: 2,
        accuracyPercent: 90,
        solvedTasks: answers - 1,
        attemptedTasks: answers,
        activeDays: 3,
        timeSpentMs: 0,
        averageTimeMs: null,
        medianTimeMs: null,
      },
    ],
  });
}

describe('StatisticsDesktop — every number follows the period', () => {
  beforeEach(() => {
    vi.mocked(api.getProgressPeriod).mockImplementation(async ({ period, subject }) =>
      tagged(period, subject),
    );
  });

  it('30 days by default: tiles and chart from the same 30-day response', async () => {
    renderStatistics();
    await expectBars(30);
    expect(await screen.findByText('28 из 30')).toBeInTheDocument();
    expect(api.getProgressPeriod).toHaveBeenCalledWith(
      expect.objectContaining({ period: '30d', subject: 'math' }),
    );
  });

  it('every period changes the numbers AND the chart: 7, 15, 30, 90 days, all time', async () => {
    const user = userEvent.setup();
    renderStatistics();
    for (const [tab, bars, answers] of [
      ['7 дней', 7, 7],
      ['15 дней', 15, 15],
      ['30 дней', 30, 30],
      ['90 дней', 90, 90],
    ] as const) {
      await user.click(screen.getByRole('tab', { name: tab }));
      await expectBars(bars);
      expect(await screen.findByText(`${answers - 2} из ${answers}`)).toBeInTheDocument();
      expect(screen.getByText(`верно ${answers - 2} · неверно 2`)).toBeInTheDocument();
    }
    // All time since the first answer (1 March), drawn by weeks.
    await user.click(screen.getByRole('tab', { name: 'Всё время' }));
    expect(await screen.findByText('398 из 400')).toBeInTheDocument();
    expect(
      await screen.findByRole('group', { name: /Решённые задания по неделям/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/с 1 марта 2026 г\., по неделям/).length).toBeGreaterThan(0);
  });

  it('while another period loads, the old numbers are gone (skeletons), never mixed', async () => {
    const user = userEvent.setup();
    const pending: (() => void)[] = [];
    renderStatistics();
    expect(await screen.findByText('28 из 30')).toBeInTheDocument();
    vi.mocked(api.getProgressPeriod).mockImplementation(
      ({ period, subject }) =>
        new Promise((resolve) => {
          pending.push(() => resolve(tagged(period, subject)));
        }),
    );
    await user.click(screen.getByRole('tab', { name: '7 дней' }));
    expect(screen.queryByText('28 из 30')).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('Загрузка графика').length).toBeGreaterThan(0);
    pending.forEach((release) => release());
    expect(await screen.findByText('5 из 7')).toBeInTheDocument();
  });

  it('no activity in the period: dashes and an empty chart, no fake zeros as percentages', async () => {
    vi.mocked(api.getProgressPeriod).mockImplementation(async ({ period, subject }) =>
      periodResponse(period, { subjectId: subject }),
    );
    renderStatistics();
    await expectBars(30);
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.getAllByText('За этот период ответов нет.').length).toBeGreaterThan(0);
  });

  it('the subject switch asks for that subject’s period numbers', async () => {
    renderStatistics();
    await screen.findByText('28 из 30');
    expect(api.getProgressPeriod).toHaveBeenCalledWith(
      expect.objectContaining({ period: '30d', subject: 'math' }),
    );
    // The per-subject distribution is asked for all subjects of the same period.
    expect(api.getProgressPeriod).toHaveBeenCalledWith(
      expect.objectContaining({ period: '30d', subject: undefined }),
    );
  });

  it('the daily chart shows the real day: a bar for today with its exact count', async () => {
    const user = userEvent.setup();
    renderStatistics();
    const chart = await screen.findByRole('group', { name: /Решённые задания по дням/ });
    await waitFor(() =>
      expect(
        (
          chart.querySelector('[class*="bars"]')!.lastElementChild!.firstElementChild as HTMLElement
        ).style.getPropertyValue('--h'),
      ).toBe('1'),
    );
    chart.focus();
    await user.keyboard('{End}');
    expect(screen.getAllByText('Решено 5 заданий')[0]).toBeInTheDocument();
  });

  it('cumulative blocks are labelled «за всё время»', async () => {
    renderStatistics();
    expect(screen.getAllByText(/за всё время/).length).toBeGreaterThanOrEqual(2);
  });

  it('the errors donut and "Сложные темы" use real /mistakes data, showing an empty state with none', async () => {
    renderStatistics();
    expect((await screen.findAllByText('Пока нет данных об ошибках.')).length).toBeGreaterThan(0);
  });
});

describe('StatisticsDesktop — Statistics 2.0 ordering (additive, never replacing existing stats)', () => {
  it('places "По номерам" after the existing charts, never before them', () => {
    vi.mocked(api.getProgressByTaskNumber).mockResolvedValue({
      items: [
        {
          subjectId: 'math',
          taskNumber: 5,
          total: 4,
          completed: 3,
          correct: 0,
          incorrect: 0,
          accuracyPercent: null,
        },
      ],
    });
    renderStatistics();
    const headings = screen
      .getAllByText(/^(Активность по дням|Распределение по темам|По номерам)$/)
      .map((el) => el.textContent);
    expect(headings.indexOf('По номерам')).toBeGreaterThan(headings.indexOf('Активность по дням'));
    expect(headings.indexOf('По номерам')).toBeGreaterThan(
      headings.indexOf('Распределение по темам'),
    );
  });

  it('keeps the existing charts visible alongside "По номерам" (additive, not a replacement)', () => {
    renderStatistics();
    expect(screen.getByText('Активность по дням')).toBeInTheDocument();
    expect(screen.getByText('По номерам')).toBeInTheDocument();
  });
});

describe('StatisticsDesktop — По номерам detail (Statistics 2.0)', () => {
  it('clicking a real task number opens its detail, with a working back button', async () => {
    vi.mocked(api.getProgressByTaskNumber).mockResolvedValue({
      items: [
        {
          subjectId: 'math',
          taskNumber: 5,
          total: 4,
          completed: 3,
          correct: 0,
          incorrect: 0,
          accuracyPercent: null,
        },
      ],
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
    renderStatistics();
    await user.click(await screen.findByText('№5'));
    // The percent itself animates in (useCountUp) — assert the static,
    // non-animated delta label instead of racing the animation.
    expect(await screen.findByText('3 из 4')).toBeInTheDocument();
    expect(api.getTaskNumberStatisticsDetail).toHaveBeenCalledWith('math', 5);

    await user.click(screen.getByText('Назад к статистике'));
    expect(screen.queryByText('Назад к статистике')).not.toBeInTheDocument();
  });

  it('shows an honest empty state when the selected number has no attempts yet', async () => {
    vi.mocked(api.getProgressByTaskNumber).mockResolvedValue({
      items: [
        {
          subjectId: 'math',
          taskNumber: 7,
          total: 2,
          completed: 0,
          correct: 0,
          incorrect: 0,
          accuracyPercent: null,
        },
      ],
    });
    vi.mocked(api.getTaskNumberStatisticsDetail).mockResolvedValue({
      subjectId: 'math',
      taskNumber: 7,
      attempts: 0,
      uniqueTasksAttempted: 0,
      correctAttempts: 0,
      incorrectAttempts: 0,
      accuracy: null,
      averageTimeMs: null,
      medianTimeMs: null,
      timedAttempts: 0,
      lastAttemptAt: null,
      taskType: null,
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
    renderStatistics();
    await user.click(await screen.findByText('№7'));
    expect(await screen.findByText('Пока нет данных по №7.')).toBeInTheDocument();
  });
});

describe('StatisticsDesktop — Статистика вариантов', () => {
  it('shows an honest empty state when no variant has been started yet', async () => {
    vi.mocked(api.getVariantProgress).mockResolvedValue({ items: [] });
    renderStatistics();
    expect(
      await screen.findByText('Реши свой первый вариант в Тренировке — он появится здесь.'),
    ).toBeInTheDocument();
  });

  it('shows a real completed variant with real planned/solved/accuracy/time/errors', async () => {
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
          plannedCount: 24,
          solvedCount: 24,
          correctCount: 21,
          incorrectCount: 3,
          accuracyPercent: 87.5,
          totalTimeMs: 6120000,
          keyErrors: [
            { signature: 'incorrect_answer', count: 2 },
            { signature: 'blank_answer', count: 1 },
          ],
        },
      ],
    });
    renderStatistics();

    expect(await screen.findByText('24 / 24 заданий')).toBeInTheDocument();
    expect(screen.getByText('21 правильных')).toBeInTheDocument();
    expect(screen.getByText('87.5%')).toBeInTheDocument();
    expect(screen.getByText('Время: 1 ч 42 мин')).toBeInTheDocument();
    expect(screen.getByText('Неверный ответ — 2')).toBeInTheDocument();
    expect(screen.getByText('Пустой ответ — 1')).toBeInTheDocument();
  });
});
