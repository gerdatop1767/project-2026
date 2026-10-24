import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminRouter } from '../router.js';
import { NotificationsPage } from './Notifications.js';

const base = {
  settings: { registrations: true, siteErrors: true, complaints: false },
  delivery: { botConfigured: true, owners: 1, withTelegram: 1 },
  worker: {
    at: new Date().toISOString(),
    botConfigured: true,
    polling: false,
    healthCheck: true,
    owners: 1,
    stale: false,
  },
  lastResult: null as null | { status: string; lastError: string | null; at: string },
  queue: { pending: 0, failed24h: 1, sent24h: 4, lastSentAt: '2026-10-23 10:00:00+00' },
};

function mockFetch(body: unknown) {
  const fn = vi.fn(async (_input: URL | string, init: RequestInit = {}) => {
    const reply = init.method === 'PUT' ? { settings: JSON.parse(String(init.body)) } : body;
    return new Response(JSON.stringify(init.method === 'POST' ? { queued: true } : reply), {
      status: init.method === 'POST' ? 202 : 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function renderPage() {
  window.history.replaceState(null, '', '/admin/notifications');
  return render(
    <AdminRouter>
      <NotificationsPage />
    </AdminRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('NotificationsPage', () => {
  it('shows the three switches with their state and the delivery readiness', async () => {
    mockFetch(base);
    renderPage();
    const reg = await screen.findByRole('switch', { name: /Новые регистрации/ });
    expect(reg).toBeChecked();
    expect(screen.getByRole('switch', { name: /Сбои сайта/ })).toBeChecked();
    expect(screen.getByRole('switch', { name: /Жалобы на задания/ })).not.toBeChecked();
    expect(screen.getByText(/Настройки в порядке/)).toBeInTheDocument();
    // The worker's own report, incl. that /start is not read — which does
    // not stop owner notifications.
    expect(screen.getByText(/бот не видит \/start/)).toBeInTheDocument();
    expect(screen.getByText(/Уведомлениям владельцу это не мешает/)).toBeInTheDocument();
    expect(screen.getByText(/только владельцу/)).toBeInTheDocument();
  });

  it('each switch saves on its own, with the admin write header', async () => {
    const fetch = mockFetch(base);
    renderPage();
    fireEvent.click(await screen.findByRole('switch', { name: /Жалобы на задания/ }));
    await waitFor(() => expect(fetch.mock.calls.some(([, i]) => i?.method === 'PUT')).toBe(true));
    const put = fetch.mock.calls.find(([, i]) => i?.method === 'PUT')!;
    expect(JSON.parse(String(put[1]!.body))).toEqual({
      registrations: true,
      siteErrors: true,
      complaints: true,
    });
    expect((put[1]!.headers as Record<string, string>)['x-zybrilka-admin']).toBe('1');
  });

  it('explains what is missing and does not offer a test when delivery cannot work', async () => {
    mockFetch({ ...base, delivery: { ...base.delivery, withTelegram: 0 } });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('не подключён Telegram');
    expect(screen.getByRole('button', { name: 'Отправить тестовое уведомление' })).toBeDisabled();
  });

  it('says the owner has to press Start when Telegram refused the last message', async () => {
    mockFetch({
      ...base,
      lastResult: { status: 'failed', lastError: 'not_started', at: '2026-10-23 12:00:00+00' },
    });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('нажмите «Запустить» (Start)');
    expect(screen.getByRole('button', { name: 'Отправить тестовое уведомление' })).toBeEnabled();
  });

  it('says when the worker is not running', async () => {
    mockFetch({ ...base, worker: null });
    renderPage();
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.map((a) => a.textContent).join(' ')).toMatch(/worker\) не работает/);
  });

  it('queues a test notification', async () => {
    const fetch = mockFetch(base);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Отправить тестовое уведомление' }));
    expect(await screen.findByText(/Поставлено в очередь/)).toBeInTheDocument();
    expect(
      fetch.mock.calls.some(
        ([url, i]) => i?.method === 'POST' && String(url).endsWith('/admin/notifications/test'),
      ),
    ).toBe(true);
  });
});
