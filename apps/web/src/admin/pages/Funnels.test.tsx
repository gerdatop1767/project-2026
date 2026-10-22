import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminRouter } from '../router.js';
import { FunnelsPage } from './Funnels.js';

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const period = {
  from: '2026-03-05',
  to: '2026-03-11',
  days: 7,
  granularity: 'day',
  timezone: 'Europe/Moscow',
  previous: { from: '2026-02-26', to: '2026-03-04' },
};

const step = (key: string, label: string, count: number, prev: number | null, first: number) => ({
  key,
  label,
  count,
  fromPrevious: prev === null ? null : prev > 0 ? count / prev : null,
  fromStart: first > 0 ? count / first : null,
  dropOff: prev === null ? null : prev - count,
});

const funnels = {
  period,
  trackingSince: '2026-03-01 00:00:00+00',
  visitorData: 'full',
  visitors: [
    step('visit', 'Визит', 200, null, 200),
    step('subject', 'Выбрал предмет', 120, 200, 200),
    step('task', 'Открыл задание', 90, 120, 200),
  ],
  guests: { visitors: 150, answered: 60, returned: 12 },
  registered: [
    step('registered', 'Регистрация', 40, null, 40),
    step('subjects', 'Выбрал предметы', 30, 40, 40),
  ],
};

const thresholds = {
  period,
  thresholds: [1, 5, 10, 25, 50, 100].map((t) => ({
    threshold: t,
    inPeriod: 100 - t,
    ever: 1000 - t,
  })),
};

const retention = {
  basis: 'registration',
  cohortUnit: 'week',
  cohorts: [
    { cohort: '2026-02-23', size: 20, d1: 0.5, d7: 0.25, d30: null, week1: 0.3, month1: null },
  ],
};

function route(overrides: Record<string, () => Promise<Response>> = {}) {
  return (input: URL) => {
    const path = new URL(String(input)).pathname.replace('/api/v1/admin', '');
    if (overrides[path]) return overrides[path]();
    if (path === '/funnels') return json(200, funnels);
    if (path === '/thresholds') return json(200, thresholds);
    if (path === '/retention') return json(200, retention);
    return json(404, { error: 'not_found' });
  };
}

const renderPage = () =>
  render(
    <AdminRouter>
      <FunnelsPage />
    </AdminRouter>,
  );

describe('FunnelsPage', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    window.history.replaceState(null, '', '/admin/funnels?period=7d');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows both funnels, thresholds and cohorts; cohort controls go to the URL', async () => {
    fetchMock.mockImplementation(route());
    renderPage();
    const visitors = await screen.findByRole('table', { name: 'Воронка посетителей' });
    const row = within(visitors).getByText('Выбрал предмет').closest('tr')!;
    expect(row).toHaveTextContent('120');
    expect(row).toHaveTextContent('60%');
    expect(row).toHaveTextContent('80');
    expect(screen.getByRole('table', { name: 'Воронка зарегистрированных' })).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
    const th = await screen.findByRole('table', { name: 'Пороги решений' });
    expect(within(th).getByText('100+')).toBeInTheDocument();
    expect(within(th).getByText('999')).toBeInTheDocument();
    const ret = await screen.findByRole('table', { name: 'Удержание по когортам' });
    expect(within(ret).getByText('23.02.2026')).toBeInTheDocument();
    expect(within(ret).getByText('50%')).toBeInTheDocument();
    expect(within(ret).getAllByText('ещё рано')).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: 'По месяцам' }));
    await userEvent.click(screen.getByRole('button', { name: 'От первого ответа' }));
    expect(window.location.search).toContain('cohort=month');
    expect(window.location.search).toContain('basis=first_activity');
    const last = fetchMock.mock.calls
      .map((c) => new URL(String(c[0])))
      .filter((u) => u.pathname.endsWith('/retention'))
      .at(-1)!;
    expect(last.searchParams.get('cohort')).toBe('month');
    expect(last.searchParams.get('basis')).toBe('first_activity');
  });

  it('empty: no visitor data, no registrations, no cohorts', async () => {
    fetchMock.mockImplementation(
      route({
        '/funnels': () =>
          json(200, {
            ...funnels,
            trackingSince: null,
            visitorData: 'none',
            visitors: funnels.visitors.map((x) => ({ ...x, count: 0 })),
            registered: funnels.registered.map((x) => ({ ...x, count: 0 })),
          }),
        '/retention': () => json(200, { ...retention, cohorts: [] }),
      }),
    );
    renderPage();
    expect(
      await screen.findByText('Нет данных: события за период не собирались.'),
    ).toBeInTheDocument();
    expect(screen.getByText('За период регистраций не было.')).toBeInTheDocument();
    expect(screen.getAllByText('нет данных').length).toBeGreaterThanOrEqual(3);
    expect(await screen.findByText('Пока нет когорт за этот промежуток.')).toBeInTheDocument();
  });

  it('server error: retry button', async () => {
    fetchMock.mockImplementation(() => json(500, { error: 'internal_error' }));
    renderPage();
    expect((await screen.findAllByRole('button', { name: 'Повторить' })).length).toBe(3);
  });
});
