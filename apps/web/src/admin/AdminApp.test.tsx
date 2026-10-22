import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp } from './AdminApp.js';

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('AdminApp access gate (the server decides)', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    window.history.replaceState(null, '', '/admin');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('signed out (401): asks to sign in, shows no admin data', async () => {
    fetchMock.mockImplementation(() => json(401, { error: 'unauthorized' }));
    render(<AdminApp />);
    expect(await screen.findByRole('heading', { name: 'Вход в админку' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Разделы админки' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a regular account (403): no access, nothing else requested', async () => {
    fetchMock.mockImplementation(() => json(403, { error: 'forbidden' }));
    render(<AdminApp />);
    expect(await screen.findByRole('heading', { name: 'Нет доступа' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('the owner sees the sections and the overview with real numbers', async () => {
    fetchMock.mockImplementation((input: URL) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/admin/me')) return json(200, { userId: 'u', role: 'owner' });
      if (path.endsWith('/admin/complaints'))
        return json(200, { counts: { new: 2 }, items: [], total: 0 });
      if (path.endsWith('/admin/health'))
        return json(200, {
          database: { status: 'ok' },
          requests: { lastHour: { total: 10, serverErrors: 0, errorRate: 0 } },
        });
      if (path.endsWith('/admin/overview')) return json(200, overviewFixture);
      return json(404, { error: 'not_found' });
    });
    render(<AdminApp />);
    const nav = await screen.findByRole('navigation', { name: 'Разделы админки' });
    expect(nav).toHaveTextContent('Пользователи');
    expect(await screen.findByText('Всего пользователей')).toBeInTheDocument();
    expect(screen.getByText('1 234')).toBeInTheDocument();
    // A zero comparison base is never shown as 0% or ∞.
    expect(screen.getAllByText('нет базы для сравнения').length).toBeGreaterThan(0);
    // Guest numbers before tracking started are «нет данных», not 0.
    expect(screen.getByText(/собираются с/)).toBeInTheDocument();
    expect(await screen.findByLabelText('новых: 2')).toBeInTheDocument();
  });

  it('a server error shows a retry, not a blank page', async () => {
    fetchMock.mockImplementation(() => json(500, { error: 'internal_error' }));
    render(<AdminApp />);
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });
});

const cmp = (current: number, previous: number) => ({
  current,
  previous,
  changePercent: previous === 0 ? null : ((current - previous) / previous) * 100,
});

const overviewFixture = {
  period: {
    preset: '7d',
    from: '2026-03-05',
    to: '2026-03-11',
    days: 7,
    granularity: 'day',
    timezone: 'Europe/Moscow',
    previous: { from: '2026-02-26', to: '2026-03-04' },
  },
  trackingSince: '2026-03-09 12:00:00+00',
  guestData: 'partial',
  users: {
    totalRegistered: 1234,
    totalAtStart: 1200,
    registrations: cmp(34, 0),
    legacyAnonymousUsers: 0,
  },
  active: {
    dau: { registered: 50, guests: 10, from: '2026-03-11', to: '2026-03-11' },
    wau: { registered: 200, guests: 40, from: '2026-03-05', to: '2026-03-11' },
    mau: { registered: 600, guests: 90, from: '2026-02-10', to: '2026-03-11' },
  },
  activeInPeriod: { registered: cmp(200, 180), guests: cmp(40, 0) },
  training: {
    guestsStarted: cmp(30, 0),
    sessionsStarted: cmp(80, 70),
    sessionsCompleted: cmp(60, 50),
  },
  answers: {
    registered: cmp(5000, 4000),
    registeredCorrect: cmp(3000, 2500),
    guests: cmp(300, 0),
    guestsCorrect: cmp(100, 0),
    solvedTasks: cmp(2500, 2000),
    uniqueSolvers: cmp(200, 180),
  },
  tasks: { published: 600, needs_review: 3 },
  complaints: { inPeriod: cmp(2, 0), new: 2, inProgress: 0 },
  series: Array.from({ length: 7 }, (_, i) => ({
    bucket: [
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
      '2026-03-11',
    ][i]!,
    registrations: i,
    correct: 10,
    incorrect: 5,
    activeRegistered: 20,
    guestCorrect: 1,
    guestIncorrect: 1,
    activeGuests: 2,
  })),
  bySubject: [
    { subjectId: 'math', name: 'Математика', answers: 5000, correct: 3000, guestAnswers: 300 },
  ],
  bySource: [{ source: 'unknown', registrations: 34 }],
};
