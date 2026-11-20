import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminRouter } from '../router.js';
import {
  MiniGamesPage,
  type GameTotals,
  type MiniGamesOverview,
  type MiniGamesReport,
} from './MiniGames.js';

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const totals: GameTotals = {
  launches: 4,
  guestLaunches: 1,
  players: 2,
  finished: 3,
  solved: 20,
  correct: 15,
  wrong: 5,
  correctPercent: 75,
  avgSeconds: 90,
  medianSeconds: 75,
  avgQuestions: 6.7,
  repeatPlayers: 1,
};
const compare = {
  launches: { previous: 2, changePercent: 100 },
  players: { previous: 2, changePercent: 0 },
  finished: { previous: 1, changePercent: 200 },
  solved: { previous: 10, changePercent: 100 },
  correct: { previous: 5, changePercent: 200 },
  avgSeconds: { previous: 80, changePercent: 12.5 },
  avgQuestions: { previous: 5, changePercent: 34 },
  correctPercent: { previous: 50, changePercent: 25 },
};
const series = [
  {
    bucket: '2026-03-29',
    launches: 2,
    finished: 1,
    players: 2,
    guestLaunches: 0,
    solved: 12,
    correct: 9,
    correctPercent: 75,
  },
  {
    bucket: '2026-03-30',
    launches: 2,
    finished: 2,
    players: 1,
    guestLaunches: 1,
    solved: 8,
    correct: 6,
    correctPercent: 75,
  },
];
const question = (itemId: string, text: string, correctPercent: number) => ({
  itemId,
  answered: 10,
  correct: correctPercent / 10,
  wrong: 10 - correctPercent / 10,
  retried: 1,
  stuckPlayers: 1,
  correctPercent,
  text,
  answer: 'тОрты',
});

const report: MiniGamesReport = {
  questionsSince: '2026-03-28 10:00:00+00',
  totals,
  compare,
  series,
  questions: {
    questionsInRange: 3,
    minAnswersForRank: 5,
    hardest: [question('q1', 'торты', 20)],
    easiest: [question('q2', 'звонит', 90)],
    mostMistakes: [question('q1', 'торты', 20)],
    struggling: [question('q3', 'кухонный', 40)],
  },
  period: {
    preset: '7d',
    from: '2026-03-24',
    to: '2026-03-30',
    days: 7,
    granularity: 'day',
    timezone: 'Europe/Moscow',
    previous: { from: '2026-03-17', to: '2026-03-23' },
  } as MiniGamesReport['period'],
  games: [{ id: 'stress', title: 'Ударения' }],
  gameId: 'stress',
  sessionsSince: '2026-03-01 10:00:00+00',
  answersSince: '2026-01-05 10:00:00+00',
  rounds: {
    launches: 4,
    guestLaunches: 1,
    players: 2,
    repeatPlayers: 1,
    repeatPlayersPercent: 50,
    launchesPerPlayer: 1.5,
    finished: 3,
    finishedPercent: 75,
    avgCorrect: 5.3,
    avgQuestions: 8.3,
    correctPercent: 63,
    avgSeconds: 90,
    medianSeconds: 75,
    results: [
      { label: '0–19%', rounds: 0 },
      { label: '20–39%', rounds: 1 },
      { label: '40–59%', rounds: 0 },
      { label: '60–79%', rounds: 0 },
      { label: '80–100%', rounds: 2 },
    ],
    modes: [{ mode: 'all', launches: 4, finished: 3 }],
  },
  answers: {
    players: 2,
    newPlayers: 1,
    answers: 6,
    correctPercent: 50,
    multiDayPlayers: 2,
    multiDayPercent: 100,
    returning: { cohort: 3, d1: 1, d1Percent: 33.3, eligible7: 2, d7: 1, d7Percent: 50 },
  },
  daily: [
    {
      day: '2026-03-29',
      launches: 2,
      finished: 1,
      sessionPlayers: 2,
      players: 2,
      answers: 2,
      correct: 1,
    },
    {
      day: '2026-03-30',
      launches: 1,
      finished: 1,
      sessionPlayers: 0,
      players: 1,
      answers: 1,
      correct: 1,
    },
  ],
};

const overview: MiniGamesOverview = {
  period: report.period,
  sessionsSince: report.sessionsSince,
  questionsSince: report.questionsSince,
  totals,
  compare,
  games: [
    { id: 'stress', title: 'Ударения', subjectId: 'russian', launchesChange: 100, ...totals },
    {
      id: 'nn',
      title: 'Н и НН',
      subjectId: 'russian',
      launchesChange: null,
      ...totals,
      launches: 0,
    },
  ],
  popular: [{ id: 'stress', title: 'Ударения', launches: 4, players: 2 }],
  bestSuccess: [{ id: 'stress', title: 'Ударения', correctPercent: 75, solved: 20 }],
  worstSuccess: [{ id: 'stress', title: 'Ударения', correctPercent: 75, solved: 20 }],
  minSolvedForRank: 20,
  series,
};

describe('MiniGamesPage', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) =>
      json(200, String(url).includes('/overview') ? overview : report),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderAt = (search: string) => {
    window.history.replaceState(null, '', `/admin/mini-games${search}`);
    return render(
      <AdminRouter>
        <MiniGamesPage />
      </AdminRouter>,
    );
  };
  const kpi = (label: string) => screen.getByText(label, { selector: 'span' }).parentElement!;

  it('overview: totals for every game with the previous period, charts, popular, all games', async () => {
    renderAt('?period=7d');
    expect(await screen.findByText('Все игры за период')).toBeInTheDocument();
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('/admin/mini-games/overview');
    expect(url).toContain('period=7d');
    expect(within(kpi('Запуски')).getByText('4')).toBeInTheDocument();
    expect(within(kpi('Запуски')).getByText(/было 2/)).toBeInTheDocument();
    expect(within(kpi('Решено вопросов')).getByText('20')).toBeInTheDocument();
    expect(within(kpi('Правильных ответов')).getByText('15')).toBeInTheDocument();
    expect(within(kpi('Доля правильных')).getByText('75%')).toBeInTheDocument();
    expect(
      within(kpi('Доля правильных')).getByText('+25 п.п. к прошлому периоду'),
    ).toBeInTheDocument();
    expect(within(kpi('Среднее время игры')).getByText('1 мин 30 с')).toBeInTheDocument();
    for (const chart of [
      'Запуски игр',
      'Активные пользователи',
      'Решённые вопросы',
      'Доля правильных ответов',
    ]) {
      expect(screen.getByLabelText(new RegExp(`^${chart}\\.`))).toBeInTheDocument();
    }
    expect(screen.getByText('Самые популярные')).toBeInTheDocument();
    expect(screen.getByText(/Данные по вопросам ведутся с 28\.03\.2026/)).toBeInTheDocument();
  });

  it('offers today, 7, 15, 30, 90 days and all time', async () => {
    renderAt('?period=7d');
    await screen.findByText('Все игры за период');
    const select = screen.getByLabelText('Период') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Сегодня',
      '7 дней',
      '15 дней',
      '30 дней',
      '90 дней',
      'Всё время',
    ]);
    const user = userEvent.setup();
    await user.selectOptions(select, 'all');
    expect(window.location.search).toContain('period=all');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('period=all');
  });

  it('a game opens its own page; back returns to the overview', async () => {
    const user = userEvent.setup();
    renderAt('?period=7d');
    await user.click(await screen.findByRole('button', { name: 'Ударения' }));
    expect(window.location.search).toContain('game=stress');
    expect(await screen.findByText('Главное за период')).toBeInTheDocument();
    const url = String(fetchMock.mock.calls.at(-1)![0]);
    expect(url).toContain('/admin/mini-games?');
    expect(url).toContain('game=stress');
    await user.click(screen.getByRole('button', { name: /Все мини-игры/ }));
    expect(window.location.search).not.toContain('game=');
  });

  it('a game page: its numbers, the comparison, hard / easy / mistakes / difficulties', async () => {
    renderAt('?period=7d&game=stress');
    expect(await screen.findByText('Главное за период')).toBeInTheDocument();
    expect(within(kpi('Запуски')).getByText('4')).toBeInTheDocument();
    expect(within(kpi('Повторные прохождения')).getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Самые сложные')).toBeInTheDocument();
    expect(screen.getAllByText('торты').length).toBeGreaterThan(0);
    expect(screen.getByText('звонит')).toBeInTheDocument();
    expect(screen.getByText('кухонный')).toBeInTheDocument();
    expect(screen.getByText('Вызывают затруднения')).toBeInTheDocument();
    // Honest about history.
    expect(screen.getByText(/не восстанавливаются/)).toBeInTheDocument();
    expect(screen.getByText('Тренировка')).toBeInTheDocument();
  });

  it('no round log yet: says so; no questions yet: says so', async () => {
    fetchMock.mockImplementation(() =>
      json(200, {
        ...report,
        sessionsSince: null,
        questionsSince: null,
        questions: {
          ...report.questions,
          hardest: [],
          easiest: [],
          mostMistakes: [],
          struggling: [],
        },
        rounds: { ...report.rounds, finished: 0, modes: [] },
      }),
    );
    renderAt('?period=7d&game=stress');
    expect(await screen.findByText(/он пока пуст/)).toBeInTheDocument();
    expect(screen.getByText(/Данные по вопросам начнут собираться/)).toBeInTheDocument();
    expect(screen.getAllByText('Пока мало ответов на вопросы.').length).toBe(2);
  });
});
