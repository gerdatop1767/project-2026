import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminRouter } from '../router.js';
import { MiniGamesPage, type MiniGamesReport } from './MiniGames.js';

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const report: MiniGamesReport = {
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

describe('MiniGamesPage', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    window.history.replaceState(null, '', '/admin/mini-games?period=7d');
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderPage = () =>
    render(
      <AdminRouter>
        <MiniGamesPage />
      </AdminRouter>,
    );

  it('asks for the game and period, shows the real numbers and where they come from', async () => {
    fetchMock.mockImplementation(() => json(200, report));
    renderPage();
    expect(await screen.findByText('Запуски', { selector: 'span' })).toBeInTheDocument();
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('/admin/mini-games');
    expect(url).toContain('period=7d');
    expect(url).toContain('game=stress');
    const kpi = (label: string) => screen.getByText(label, { selector: 'span' }).parentElement!;
    expect(within(kpi('Запуски')).getByText('4')).toBeInTheDocument();
    expect(within(kpi('Запуски')).getByText('из них гостей: 1')).toBeInTheDocument();
    expect(within(kpi('Правильных ответов')).getByText('63%')).toBeInTheDocument();
    expect(within(kpi('Среднее время раунда')).getByText('1 мин 30 с')).toBeInTheDocument();
    expect(within(kpi('Вернулись на след. день')).getByText('33,3%')).toBeInTheDocument();
    // Honest about the history: rounds are logged only from a date on.
    expect(screen.getByText(/ведётся с 01\.03\.2026/)).toBeInTheDocument();
    expect(screen.getByText(/не восстанавливаются/)).toBeInTheDocument();
    expect(screen.getByText('Тренировка')).toBeInTheDocument();
  });

  it('with no round log yet it says so instead of showing invented numbers', async () => {
    fetchMock.mockImplementation(() =>
      json(200, {
        ...report,
        sessionsSince: null,
        rounds: { ...report.rounds, avgSeconds: null, medianSeconds: null, finished: 0, modes: [] },
      }),
    );
    renderPage();
    expect(await screen.findByText(/он пока пуст/)).toBeInTheDocument();
    expect(screen.getByText('Завершённых раундов за период нет.')).toBeInTheDocument();
  });

  it('a second game appears as a switch that changes the query', async () => {
    fetchMock.mockImplementation(() =>
      json(200, { ...report, games: [...report.games, { id: 'terms', title: 'Термины' }] }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Термины' }));
    expect(window.location.search).toContain('game=terms');
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('game=terms');
  });
});
