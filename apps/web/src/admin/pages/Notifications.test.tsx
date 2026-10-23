import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminRouter } from '../router.js';
import { NotificationsPage } from './Notifications.js';

const base = {
  settings: { registrations: true, siteErrors: true, complaints: false },
  delivery: { botConfigured: true, owners: 1, withTelegram: 1, startedBot: 1 },
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
    expect(screen.getByText('Всё готово: уведомления будут приходить.')).toBeInTheDocument();
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
    mockFetch({ ...base, delivery: { ...base.delivery, startedBot: 0 } });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('нажмите /start');
    expect(screen.getByRole('button', { name: 'Отправить тестовое уведомление' })).toBeDisabled();
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
