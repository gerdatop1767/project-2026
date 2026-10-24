import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminRouter } from '../router.js';
import { GrowthPage } from './Growth.js';

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const period = {
  from: '2026-03-05',
  to: '2026-03-07',
  days: 3,
  granularity: 'day',
  timezone: 'Europe/Moscow',
  previous: { from: '2026-03-02', to: '2026-03-04' },
};

const point = (bucket: string, registrations: number, totalUsers: number) => ({
  bucket,
  registrations,
  totalUsers,
  activeRegistered: 4,
  returning: 1,
  firstTraining: 2,
  firstSolve: 1,
  activeGuests: 3,
  guestVisitors: 9,
});

const growth = {
  period,
  trackingSince: '2026-03-06 00:00:00+00',
  guestData: 'partial',
  totals: {
    registrations: 7,
    previousRegistrations: 0,
    growthPercent: null,
    totalUsersAtEnd: 1207,
    totalUsersAtStart: 1200,
    userBaseGrowthPercent: 0.58,
  },
  series: [
    point('2026-03-05', 2, 1202),
    point('2026-03-06', 3, 1205),
    point('2026-03-07', 2, 1207),
  ],
  byMethod: [
    { method: 'vk', registrations: 5 },
    { method: 'yandex', registrations: 3 },
    { method: 'telegram', registrations: 2 },
    { method: 'email', registrations: 1 },
    { method: 'unknown', registrations: 2 },
  ],
  bySource: [{ source: 'unknown', channel: null, registrations: 7 }],
  bySubject: [
    { subjectId: 'math', name: 'Математика', activeUsers: 6, answers: 40 },
    { subjectId: 'russian', name: 'Русский язык', activeUsers: 0, answers: 0 },
  ],
};

describe('GrowthPage', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    window.history.replaceState(null, '', '/admin/growth?period=7d&granularity=day');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows real totals, breakdowns and asks with the URL period', async () => {
    fetchMock.mockImplementation(() => json(200, growth));
    render(
      <AdminRouter>
        <GrowthPage />
      </AdminRouter>,
    );
    expect(await screen.findByText('Регистрации за период')).toBeInTheDocument();
    expect(screen.getByText('нет базы для сравнения')).toBeInTheDocument();
    expect(screen.getByText('1 207')).toBeInTheDocument();
    expect(screen.getByText('VK ID')).toBeInTheDocument();
    expect(screen.getByText('Яндекс ID')).toBeInTheDocument();
    expect(screen.queryByText('yandex')).not.toBeInTheDocument();
    expect(screen.getByText('Telegram')).toBeInTheDocument();
    expect(screen.getByText('Почта')).toBeInTheDocument();
    expect(screen.getByText('Неизвестно')).toBeInTheDocument();
    expect(screen.getByText('Математика')).toBeInTheDocument();
    expect(screen.queryByText('Русский язык')).not.toBeInTheDocument();
    expect(screen.getByText(/собираются с/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CSV' })).toHaveAttribute(
      'href',
      '/api/v1/admin/export/overview?period=7d&granularity=day',
    );
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.pathname).toBe('/api/v1/admin/growth');
    expect(url.searchParams.get('period')).toBe('7d');
    expect(url.searchParams.get('granularity')).toBe('day');
  });

  it('empty period: says there were no registrations or answers', async () => {
    fetchMock.mockImplementation(() =>
      json(200, {
        ...growth,
        guestData: 'none',
        byMethod: [],
        bySource: [],
        bySubject: growth.bySubject.map((x) => ({ ...x, activeUsers: 0, answers: 0 })),
      }),
    );
    render(
      <AdminRouter>
        <GrowthPage />
      </AdminRouter>,
    );
    expect(await screen.findAllByText('За период регистраций не было.')).toHaveLength(2);
    const card = screen.getByRole('heading', { name: 'По предметам' }).closest('section')!;
    expect(within(card).getByText('За период ответов не было.')).toBeInTheDocument();
  });

  it('server error: retry button', async () => {
    fetchMock.mockImplementation(() => json(500, { error: 'internal_error' }));
    render(
      <AdminRouter>
        <GrowthPage />
      </AdminRouter>,
    );
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });
});
