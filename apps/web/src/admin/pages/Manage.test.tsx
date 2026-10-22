import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminRouter } from '../router.js';
import { compactDetails, ManagePage } from './Manage.js';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function renderAt(url: string) {
  window.history.replaceState(null, '', url);
  return render(
    <AdminRouter>
      <ManagePage />
    </AdminRouter>,
  );
}

const ACTOR = 'aaaaaaaa-1111-4111-8111-111111111111';
const CAMPAIGN = 'cccccccc-2222-4222-8222-222222222222';

const auditPage = (items: unknown[]) => ({ total: items.length, page: 1, pageSize: 50, items });

const defaults = {
  quality: {
    minSample: 30,
    lowAccuracy: 0.15,
    accuracyDrop: 0.25,
    complaints: 2,
    abandonment: 0.6,
  },
  alerts: {
    solvesDropShare: 0.5,
    solvesMinDaily: 20,
    errorRate: 0.05,
    errorMinRequests: 50,
    complaintsFactor: 3,
    complaintsMin: 5,
    accuracyShift: 0.15,
    accuracyMinAnswers: 50,
    authFailureRate: 0.3,
    authMinRequests: 20,
  },
};
const settingsResponse = {
  settings: { ...defaults, quality: { ...defaults.quality, minSample: 40, lowAccuracy: 0.2 } },
  defaults,
  channels: { telegram: 'not_connected', email: 'not_connected' },
  integrations: { yandexWebmaster: 'not_connected', googleSearchConsole: 'not_connected' },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ManagePage — audit', () => {
  it('renders audit rows with Russian labels and object links, filters go to the URL', async () => {
    const fetchMock = vi.fn(async () =>
      json(
        auditPage([
          {
            id: '1',
            actorUserId: ACTOR,
            action: 'campaign.status_changed',
            objectType: 'campaign',
            objectId: CAMPAIGN,
            result: 'ok',
            details: { from: 'active', to: 'disabled' },
            createdAt: '2026-10-21 12:00:00.5+00',
          },
          {
            id: '2',
            actorUserId: null,
            action: 'admin.access_denied',
            objectType: null,
            objectId: null,
            result: 'denied',
            details: null,
            createdAt: '2026-10-21 11:00:00+00',
          },
        ]),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/admin/manage?objectType=campaign');
    expect(
      await screen.findByRole('cell', { name: 'Статус кампании изменён' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Отказ в доступе' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'aaaaaaaa' })).toHaveAttribute(
      'href',
      `/admin/users/${ACTOR}`,
    );
    expect(screen.getByRole('link', { name: 'cccccccc' })).toHaveAttribute(
      'href',
      `/admin/campaigns/${CAMPAIGN}`,
    );
    expect(screen.getByText('from: active · to: disabled')).toBeInTheDocument();
    expect(screen.getByText('Отказано')).toBeInTheDocument();
    expect(screen.getByText(/только дополняется/)).toBeInTheDocument();
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.pathname).toBe('/api/v1/admin/audit');
    expect(url.searchParams.get('objectType')).toBe('campaign');

    await userEvent.type(screen.getByLabelText('Действие (код)'), 'export.csv');
    await userEvent.click(screen.getByRole('button', { name: 'Найти' }));
    await waitFor(() => expect(window.location.search).toContain('action=export.csv'));
  });

  it('shows an empty state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(auditPage([]))),
    );
    renderAt('/admin/manage');
    expect(await screen.findByText('В журнале пока нет записей.')).toBeInTheDocument();
  });

  it('shows an error with retry on a 500', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'internal_error' }, 500)),
    );
    renderAt('/admin/manage');
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });
});

describe('ManagePage — settings', () => {
  it('edits percentages, resets to defaults and saves the full object as fractions', async () => {
    const fetchMock = vi.fn(async (_input: URL | string, init?: RequestInit) =>
      init?.method === 'PUT' ? json({ settings: defaults }) : json(settingsResponse),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/admin/manage?tab=settings');
    const low = await screen.findByLabelText('Очень низкая точность, %');
    expect(low).toHaveValue(20);
    expect(screen.getByLabelText('Минимум ответов')).toHaveValue(40);

    await userEvent.clear(low);
    await userEvent.type(low, '12.5');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true),
    );
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(new URL(String(put[0])).pathname).toBe('/api/v1/admin/settings');
    expect((put[1]!.headers as Record<string, string>)['x-zybrilka-admin']).toBe('1');
    expect(JSON.parse(String(put[1]!.body))).toEqual({
      quality: { ...defaults.quality, minSample: 40, lowAccuracy: 0.125 },
      alerts: defaults.alerts,
    });

    await userEvent.click(
      screen.getByRole('button', { name: 'Сбросить к значениям по умолчанию' }),
    );
    expect(screen.getByLabelText('Очень низкая точность, %')).toHaveValue(15);
    expect(screen.getByLabelText('Минимум ответов')).toHaveValue(30);
  });

  it('shows a server validation error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: URL | string, init?: RequestInit) =>
        init?.method === 'PUT' ? json({ error: 'invalid_body' }, 400) : json(settingsResponse),
      ),
    );
    renderAt('/admin/manage?tab=settings');
    await userEvent.click(await screen.findByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Проверьте заполненные поля.')).toBeInTheDocument();
  });

  it('blocks out-of-range values locally', async () => {
    const fetchMock = vi.fn(async () => json(settingsResponse));
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/admin/manage?tab=settings');
    const min = await screen.findByLabelText('Минимум ответов');
    await userEvent.clear(min);
    await userEvent.type(min, '2');
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText(/Проверьте поля: Минимум ответов/)).toBeInTheDocument();
    expect(fetchMock.mock.calls).toHaveLength(1);
  });
});

describe('ManagePage — export and notifications', () => {
  it('lists every CSV kind for the current period', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({})),
    );
    renderAt('/admin/manage?tab=export&period=7d');
    const links = screen.getAllByRole('link', { name: 'Скачать CSV' });
    expect(links.map((a) => a.getAttribute('href'))).toEqual(
      ['overview', 'subjects', 'numbers', 'users', 'campaigns', 'complaints', 'quality'].map(
        (k) => `/api/v1/admin/export/${k}?period=7d`,
      ),
    );
    expect(screen.getByText(/записывается в журнал действий/)).toBeInTheDocument();
  });

  it('shows channels and integrations as not connected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(settingsResponse)),
    );
    renderAt('/admin/manage?tab=notifications');
    expect(await screen.findAllByText('не подключено')).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'в разделе «Задания»' })).toHaveAttribute(
      'href',
      '/admin/content',
    );
    expect(screen.getByText(/импорт выполняется/)).toBeInTheDocument();
  });

  it('switches tabs through the URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(auditPage([]))),
    );
    renderAt('/admin/manage');
    await userEvent.click(screen.getByRole('button', { name: 'Выгрузки' }));
    expect(window.location.search).toBe('?tab=export');
  });
});

describe('compactDetails', () => {
  it('formats nested objects compactly and cuts long text', () => {
    expect(compactDetails({ status: { from: 'new', to: 'fixed' } })).toBe(
      'status: {from: new, to: fixed}',
    );
    expect(compactDetails(null)).toBe('—');
    expect(compactDetails({ a: 'x'.repeat(300) }).length).toBe(160);
  });
});
