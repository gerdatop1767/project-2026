import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminRouter } from '../router.js';
import { StreaksPage } from './Streaks.js';

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const report = {
  period: {
    preset: '30d',
    from: '2026-03-01',
    to: '2026-03-30',
    days: 30,
    granularity: 'day',
    timezone: 'Europe/Moscow',
    previous: { from: '2026-01-30', to: '2026-02-28' },
  },
  today: '2026-03-30',
  historySince: '2026-01-05',
  totals: {
    trackedUsers: 4,
    activeStreaks: 3,
    averageCurrent: 22,
    medianCurrent: 5,
    longestCurrent: 60,
    longestEver: 61,
  },
  tiers: [
    { tier: 1, label: '1–4', users: 1 },
    { tier: 2, label: '5–14', users: 1 },
    { tier: 3, label: '15–29', users: 0 },
    { tier: 4, label: '30–39', users: 0 },
    { tier: 5, label: '40–59', users: 0 },
    { tier: 6, label: '60+', users: 1 },
  ],
  daily: [
    { day: '2026-03-29', active: 2, averageStreak: 30, fivePlus: 2 },
    { day: '2026-03-30', active: 3, averageStreak: 22, fivePlus: 2 },
  ],
  top: [{ id: 'u-1', name: 'Анна', current: 60, best: 61, lastActive: '2026-03-30' }],
};

describe('StreaksPage', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    window.history.replaceState(null, '', '/admin/streaks');
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderPage = () =>
    render(
      <AdminRouter>
        <StreaksPage />
      </AdminRouter>,
    );

  it('shows real totals, every tier range and the leaders', async () => {
    fetchMock.mockImplementation(() => json(200, report));
    renderPage();
    expect(await screen.findByText('С активной серией')).toBeInTheDocument();
    for (const label of ['1–4 дн.', '5–14 дн.', '15–29 дн.', '30–39 дн.', '40–59 дн.', '60+ дн.']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Анна' })).toHaveAttribute('href', '/admin/users/u-1');
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/v1/admin/streaks?period=30d');
  });

  it('no activity yet: an explanation, not zeros', async () => {
    fetchMock.mockImplementation(() =>
      json(200, {
        ...report,
        totals: { ...report.totals, trackedUsers: 0, activeStreaks: 0 },
        top: [],
      }),
    );
    renderPage();
    expect(await screen.findByText(/серий нет/)).toBeInTheDocument();
  });

  it('a server error shows a retry', async () => {
    fetchMock.mockImplementation(() => json(500, { error: 'internal_error' }));
    renderPage();
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });
});
