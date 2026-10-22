import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminRouter } from '../router.js';
import { CampaignPage, CampaignsPage } from './Campaigns.js';

const period = {
  preset: '30d',
  from: '2026-09-23',
  to: '2026-10-22',
  days: 30,
  granularity: 'day',
  timezone: 'Europe/Moscow',
  previous: { from: '2026-08-24', to: '2026-09-22' },
};

const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';

const item = (over: Record<string, unknown> = {}) => ({
  id: CAMPAIGN_ID,
  slug: 'AbCdEf1234',
  name: 'Осенний пост ВК',
  source: 'vk',
  channel: 'post',
  creative: 'баннер 1',
  targetPath: '/training',
  status: 'active',
  createdAt: '2026-10-01 09:00:00+00',
  clicks: 120,
  uniqueVisitors: 80,
  guestAnswered: 30,
  registrations: 12,
  started: 10,
  a1: 9,
  a5: 6,
  a10: 4,
  d7: 3,
  d30: 0,
  d7eligible: 8,
  d30eligible: 0,
  conversion: 0.15,
  link: { web: 'https://zybrilka.ru/api/v1/go/AbCdEf1234', telegramStartParam: 'AbCdEf1234' },
  ...over,
});

const report = (items: unknown[]) => ({
  period,
  attributionWindowDays: 30,
  registrations: { total: 40, attributed: 12, unknown: 28, unknownShare: 0.7 },
  items,
  searchIntegrations: { yandexWebmaster: 'not_connected', googleSearchConsole: 'not_connected' },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function renderAt(url: string, ui: React.ReactNode) {
  window.history.replaceState(null, '', url);
  return render(<AdminRouter>{ui}</AdminRouter>);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CampaignsPage', () => {
  it('renders campaigns, summary, search integrations and the attribution note', async () => {
    const fetchMock = vi.fn(async (_input: URL | string) => json(report([item()])));
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/admin/campaigns', <CampaignsPage />);
    expect(await screen.findByRole('link', { name: 'Осенний пост ВК' })).toHaveAttribute(
      'href',
      `/admin/campaigns/${CAMPAIGN_ID}`,
    );
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText('3 из 8 (38%)')).toBeInTheDocument();
    expect(screen.getAllByText('ещё рано').length).toBeGreaterThan(0);
    expect(screen.getByText('startapp=AbCdEf1234')).toBeInTheDocument();
    expect(screen.getAllByText('не подключено')).toHaveLength(2);
    expect(screen.getByText(/первое касание — по cookie браузера/)).toBeInTheDocument();
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.pathname).toBe('/api/v1/admin/campaigns');
    expect(url.searchParams.get('archived')).toBe('0');
    expect(screen.getByRole('link', { name: 'CSV' }).getAttribute('href')).toContain(
      '/api/v1/admin/export/campaigns',
    );
  });

  it('shows the comparison table for selected campaigns', async () => {
    const second = item({
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Чат школы',
      clicks: 5,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(report([item(), second]))),
    );
    renderAt('/admin/campaigns', <CampaignsPage />);
    await userEvent.click(await screen.findByLabelText('Сравнить «Осенний пост ВК»'));
    await userEvent.click(screen.getByLabelText('Сравнить «Чат школы»'));
    const table = screen.getByRole('table', { name: 'Сравнение кампаний' });
    expect(within(table).getByRole('columnheader', { name: 'Чат школы' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'Переходы' })).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(report([]))),
    );
    renderAt('/admin/campaigns?archived=1', <CampaignsPage />);
    expect(await screen.findByText(/Кампаний пока нет/)).toBeInTheDocument();
    expect(screen.getByLabelText('Показать архив')).toBeChecked();
  });

  it('shows an error with retry on a 500', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'internal_error' }, 500)),
    );
    renderAt('/admin/campaigns', <CampaignsPage />);
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });

  it('creates a campaign and shows the new link; server errors are explained', async () => {
    let failNext = true;
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        if (failNext) {
          failNext = false;
          return json({ error: 'target_not_allowed' }, 400);
        }
        return json({ ...item({ name: 'Новая' }), name: 'Новая' }, 201);
      }
      void input;
      return json(report([]));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderAt('/admin/campaigns', <CampaignsPage />);
    await screen.findByText(/Кампаний пока нет/);
    await userEvent.type(screen.getByLabelText('Название'), 'Новая');
    await userEvent.type(screen.getByLabelText('Источник'), 'vk');
    await userEvent.type(screen.getByLabelText('Канал'), 'post');
    await userEvent.selectOptions(screen.getByLabelText('Куда ведёт'), '/mock-exams');
    await userEvent.click(screen.getByRole('button', { name: 'Создать ссылку' }));
    expect(
      await screen.findByText('Такую страницу нельзя указать целью ссылки.'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Создать ссылку' }));
    expect(await screen.findByText(/Ссылка для «Новая»/)).toBeInTheDocument();
    const post = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').at(-1)!;
    expect(new URL(String(post[0])).pathname).toBe('/api/v1/admin/campaigns');
    expect(JSON.parse(String(post[1]!.body))).toEqual({
      name: 'Новая',
      source: 'vk',
      channel: 'post',
      targetPath: '/mock-exams',
    });
    expect((post[1]!.headers as Record<string, string>)['x-zybrilka-admin']).toBe('1');
  });
});

describe('CampaignPage', () => {
  const detail = {
    period,
    campaign: {
      id: CAMPAIGN_ID,
      slug: 'AbCdEf1234',
      name: 'Осенний пост ВК',
      source: 'vk',
      channel: 'post',
      creative: null,
      targetPath: '/training',
      status: 'active',
      createdAt: '2026-10-01 09:00:00+00',
    },
    daily: [
      { day: '2026-10-20', clicks: 3, uniqueVisitors: 2, registrations: 1 },
      { day: '2026-10-21', clicks: 5, uniqueVisitors: 4, registrations: 0 },
    ],
    link: { web: 'https://zybrilka.ru/api/v1/go/AbCdEf1234', telegramStartParam: 'AbCdEf1234' },
  };

  it('renders the campaign and disables it through a confirmation', async () => {
    const fetchMock = vi.fn(async (_input: URL | string, init?: RequestInit) =>
      init?.method === 'PATCH' ? json({ ...detail.campaign, status: 'disabled' }) : json(detail),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderAt(`/admin/campaigns/${CAMPAIGN_ID}`, <CampaignPage id={CAMPAIGN_ID} />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Осенний пост ВК' }),
    ).toBeInTheDocument();
    expect(screen.getByText('https://zybrilka.ru/api/v1/go/AbCdEf1234')).toBeInTheDocument();
    expect(screen.getByText('Тренировка (/training)')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Отключить' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/ведёт людей на главную страницу/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Отключить' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true),
    );
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(new URL(String(patch[0])).pathname).toBe(
      `/api/v1/admin/campaigns/${CAMPAIGN_ID}/status`,
    );
    expect(JSON.parse(String(patch[1]!.body))).toEqual({ status: 'disabled', confirm: true });
    expect((patch[1]!.headers as Record<string, string>)['x-zybrilka-admin']).toBe('1');
  });

  it('says «Кампания не найдена» on a 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'not_found' }, 404)),
    );
    renderAt(`/admin/campaigns/${CAMPAIGN_ID}`, <CampaignPage id={CAMPAIGN_ID} />);
    expect(await screen.findByText('Кампания не найдена')).toBeInTheDocument();
  });

  it('shows an error with retry on a 500', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'internal_error' }, 500)),
    );
    renderAt(`/admin/campaigns/${CAMPAIGN_ID}`, <CampaignPage id={CAMPAIGN_ID} />);
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });
});
