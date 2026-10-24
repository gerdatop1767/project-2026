import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminRouter } from '../router.js';
import { BroadcastPage, BroadcastsPage } from './Broadcasts.js';

const ID = 'bbbbbbbb-0000-4000-8000-000000000001';

const broadcast = {
  id: ID,
  status: 'draft',
  text: '<b>Привет!</b>\nНовые задания по математике',
  mediaMode: 'caption',
  createdAt: '2026-10-23 10:00:00+00',
  confirmedAt: null,
  startedAt: null,
  finishedAt: null,
  recipientsTotal: null as number | null,
  sentCount: 0,
  failedCount: 0,
  blockedCount: 0,
  testStatus: null,
};
const detail = (patch: Partial<typeof broadcast> = {}, extra: object = {}) => ({
  broadcast: { ...broadcast, ...patch },
  attachments: [],
  validation: { ok: true, parts: [{ kind: 'text' }] },
  recipientsEstimate: 1234,
  deliveries: [],
  ...extra,
});

type Handler = (url: URL, init: RequestInit) => [number, unknown];
function mockFetch(handler: Handler) {
  const fn = vi.fn(async (input: URL | string, init: RequestInit = {}) => {
    const [status, body] = handler(new URL(String(input)), init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
const posts = (fn: ReturnType<typeof mockFetch>) =>
  fn.mock.calls
    .filter(([, i]) => i?.method === 'POST')
    .map(([u, i]) => [new URL(String(u)).pathname, i?.body ? JSON.parse(String(i.body)) : null]);

function renderAt(path: string, ui: React.ReactNode) {
  window.history.replaceState(null, '', path);
  return render(<AdminRouter>{ui}</AdminRouter>);
}

afterEach(() => vi.unstubAllGlobals());

describe('BroadcastsPage', () => {
  it('lists past broadcasts with their results and the current audience', async () => {
    mockFetch(() => [
      200,
      {
        recipientsEstimate: 1234,
        items: [
          {
            ...broadcast,
            status: 'completed_with_errors',
            recipientsTotal: 10,
            sentCount: 8,
            failedCount: 1,
            blockedCount: 1,
            attachments: 1,
          },
        ],
      },
    ]);
    renderAt('/admin/broadcasts', <BroadcastsPage />);
    expect(await screen.findByText('Завершена с ошибками')).toBeInTheDocument();
    expect(screen.getByText('1 234')).toBeInTheDocument();
    expect(screen.getByText(/только те, кто сам запускал бота/)).toBeInTheDocument();
  });

  it('explains a zero audience: the bot does not read /start while polling is off', async () => {
    mockFetch(() => [
      200,
      {
        recipientsEstimate: 0,
        items: [],
        worker: {
          at: new Date().toISOString(),
          botConfigured: true,
          polling: false,
          healthCheck: true,
          owners: 1,
          stale: false,
        },
      },
    ]);
    renderAt('/admin/broadcasts', <BroadcastsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('TELEGRAM_BOT_POLLING выключен');
  });

  it('shows an empty state', async () => {
    mockFetch(() => [200, { recipientsEstimate: 0, items: [] }]);
    renderAt('/admin/broadcasts', <BroadcastsPage />);
    expect(await screen.findByText(/Рассылок пока не было/)).toBeInTheDocument();
  });
});

describe('BroadcastPage', () => {
  it('a draft: edit, preview the formatting, save — nothing is sent', async () => {
    const fetch = mockFetch((_u, init) => [200, init.method === 'PATCH' ? detail() : detail()]);
    renderAt(`/admin/broadcasts/${ID}`, <BroadcastPage id={ID} />);
    const preview = await screen.findByLabelText('Предпросмотр сообщения');
    expect(within(preview).getByText('Привет!').tagName).toBe('STRONG');
    const box = screen.getByLabelText('Текст');
    fireEvent.change(box, { target: { value: 'Новый <i>текст</i>' } });
    // Unsaved: the send steps wait for the save.
    expect(screen.getByRole('button', { name: 'Перейти к отправке…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить черновик' }));
    await waitFor(() => expect(fetch.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(true));
    const patch = fetch.mock.calls.find(([, i]) => i?.method === 'PATCH')!;
    expect(JSON.parse(String(patch[1]!.body))).toEqual({
      text: 'Новый <i>текст</i>',
      mediaMode: 'caption',
    });
    expect(posts(fetch).some(([p]) => String(p).endsWith('/confirm'))).toBe(false);
  });

  it('shows why the text cannot be sent', async () => {
    mockFetch(() => [200, detail()]);
    renderAt(`/admin/broadcasts/${ID}`, <BroadcastPage id={ID} />);
    fireEvent.change(await screen.findByLabelText('Текст'), {
      target: { value: '<script>x</script>' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('не поддерживает');
  });

  it('awaiting confirmation: warns about everyone, and sends only after the dialog', async () => {
    const fetch = mockFetch((_u, init) => [
      200,
      detail({ status: init.method === 'POST' ? 'sending' : 'awaiting_confirmation' }),
    ]);
    renderAt(`/admin/broadcasts/${ID}`, <BroadcastPage id={ID} />);
    const warning = (await screen.findByText(/все доступные подписчики бота/)).closest('p')!;
    expect(warning).toHaveTextContent('сейчас их 1 234');
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить отправку' }));
    expect(posts(fetch)).toHaveLength(0); // the dialog asks first
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Отправить 1\s234 получателям$/ }));
    await waitFor(() =>
      expect(posts(fetch)).toEqual([[`/api/v1/admin/broadcasts/${ID}/confirm`, { confirm: true }]]),
    );
  });

  it('cancelling in the dialog sends nothing', async () => {
    const fetch = mockFetch(() => [200, detail({ status: 'awaiting_confirmation' })]);
    renderAt(`/admin/broadcasts/${ID}`, <BroadcastPage id={ID} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Подтвердить отправку' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(posts(fetch)).toHaveLength(0);
  });

  it('sending: shows progress and can be stopped', async () => {
    const fetch = mockFetch(() => [
      200,
      detail(
        { status: 'sending', recipientsTotal: 100, sentCount: 40, failedCount: 2, blockedCount: 3 },
        { deliveries: [{ status: 'failed', errorCode: 'network', n: 2 }] },
      ),
    ]);
    renderAt(`/admin/broadcasts/${ID}`, <BroadcastPage id={ID} />);
    expect(await screen.findByRole('progressbar', { name: 'Прогресс рассылки' })).toHaveAttribute(
      'value',
      '45',
    );
    expect(screen.getByText(/сеть \/ Telegram недоступен — 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Остановить рассылку' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Остановить' }));
    await waitFor(() =>
      expect(posts(fetch)).toEqual([[`/api/v1/admin/broadcasts/${ID}/cancel`, {}]]),
    );
  });
});
