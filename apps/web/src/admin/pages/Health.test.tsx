import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminRouter } from '../router.js';
import { HealthPage } from './Health.js';

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const health = {
  api: {
    status: 'ok',
    version: '1.4.2',
    processStartedAt: '2026-03-11T07:00:00.000Z',
    uptimeSeconds: 3 * 3600 + 120,
  },
  database: { status: 'ok', latencyMs: 1.7 },
  requests: {
    sinceStart: { total: 5400, serverErrors: 3 },
    lastHour: { total: 800, serverErrors: 2, errorRate: 0.0025 },
    latencyLast15m: { samples: 0, p50: null, p95: null },
    topErrors: [{ route: '/api/v1/tasks/:id/attempt', method: 'POST', status: 502, count: 2 }],
  },
  answerChecks: { lastHour: 120, rejected: 4, serverErrors: 2 },
  auth: { lastHour: 30, failed: 5, serverErrors: 0, vkRequests: 12, vkFailed: 1 },
  analytics: { lastEventAt: '2026-03-11 09:59:00+00' },
  content: { lastTaskUpdate: null },
  unknown: {
    worker: 'Нет данных: фоновый процесс не сообщает о себе в API',
    backups: 'Нет данных: резервные копии делаются вне приложения',
  },
};

const alerts = {
  alerts: [
    {
      type: 'error_rate',
      severity: 'critical',
      title: 'Рост ошибок API',
      detail: '2 из 10 запросов за час завершились ошибкой сервера.',
    },
    {
      type: 'solves_drop',
      severity: 'warning',
      title: 'Резкое падение решений',
      detail: 'За 24 часа 3 ответа.',
    },
  ],
  checkedAt: '2026-03-11T10:00:00.000Z',
  channels: { telegram: 'not_connected', email: 'not_connected' },
  notObservable: ['import_failure'],
};

function route(alertBody: unknown = alerts) {
  return (input: URL) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/admin/health')) return json(200, health);
    if (path.endsWith('/admin/alerts')) return json(200, alertBody);
    return json(404, { error: 'not_found' });
  };
}

const renderPage = () =>
  render(
    <AdminRouter>
      <HealthPage />
    </AdminRouter>,
  );

describe('HealthPage', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    window.history.replaceState(null, '', '/admin/health');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows status, unknowns as «Нет данных», alerts with severity, and nothing writable', async () => {
    fetchMock.mockImplementation(route());
    renderPage();
    expect(await screen.findByText('1.4.2')).toBeInTheDocument();
    expect(screen.getByText(/с момента запуска процесса API/)).toBeInTheDocument();
    expect(screen.getByText('3 ч 2 мин')).toBeInTheDocument();
    expect(screen.getByText('5 400')).toBeInTheDocument();
    expect(screen.getAllByText('нет данных').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('/api/v1/tasks/:id/attempt')).toBeInTheDocument();
    expect(screen.getByText(/фоновый процесс не сообщает/)).toBeInTheDocument();
    expect(await screen.findByText('Рост ошибок API')).toBeInTheDocument();
    expect(screen.getByText('Критично')).toBeInTheDocument();
    expect(screen.getByText('Внимание')).toBeInTheDocument();
    expect(screen.getByText(/Эти тревоги видны только здесь/)).toBeInTheDocument();
    expect(screen.getByText(/сбои импорта заданий/)).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).not.toContain('Перезапустить');
    expect(fetchMock.mock.calls.every((c) => (c[1] as RequestInit).method === 'GET')).toBe(true);
  });

  it('no alerts: «Сейчас всё спокойно»; refreshes every minute while visible', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockImplementation(route({ ...alerts, alerts: [] }));
    const { unmount } = renderPage();
    expect(await screen.findByText('Сейчас всё спокойно.')).toBeInTheDocument();
    const before = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock.mock.calls.length).toBe(before + 2);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(fetchMock.mock.calls.length).toBe(before + 2);
  });

  it('server error: retry button', async () => {
    fetchMock.mockImplementation(() => json(500, { error: 'internal_error' }));
    renderPage();
    expect((await screen.findAllByRole('button', { name: 'Повторить' })).length).toBe(2);
  });
});
