import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminRouter } from '../router.js';
import { SUPPORT_POLL_MS, SupportPage, SupportThreadPage } from './Support.js';

const T1 = '11111111-1111-4111-8111-111111111111';
const iso = '2026-10-24T10:00:00.000Z';
const summary = {
  id: T1,
  status: 'open',
  name: 'Маша Иванова',
  userId: null,
  lastMessageAt: iso,
  lastMessagePreview: 'Не открывается задание 5',
  lastMessageFrom: 'user',
  unread: true,
  messageCount: 1,
  openedBy: 'user',
};
const detail = {
  thread: { ...summary, createdAt: iso, closedAt: null, reachable: true },
  messages: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      direction: 'user',
      text: 'Не открывается задание 5',
      attachments: [],
      createdAt: iso,
      delivery: null,
      deliveryError: null,
    },
  ],
};

function mockApi() {
  const fn = vi.fn(async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (url.pathname === '/api/v1/admin/support/threads')
      return json({ items: [summary], unread: 1 });
    if (url.pathname === `/api/v1/admin/support/threads/${T1}`) return json(detail);
    if (url.pathname.endsWith('/read')) return new Response(null, { status: 204 });
    if (url.pathname.endsWith('/messages') && init.method === 'POST') {
      return json({ ...detail.messages[0], direction: 'admin', delivery: 'pending' }, 201);
    }
    if (url.pathname === '/api/v1/admin/support/users') {
      return json({
        items: [
          {
            userId: '33333333-3333-4333-8333-333333333333',
            name: 'Петя',
            reachable: false,
            reason: 'not_started',
            openThreadId: null,
          },
        ],
      });
    }
    return json({ error: 'not_found' }, 404);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const at = (path: string, ui: React.ReactNode) => {
  window.history.replaceState(null, '', path);
  return render(<AdminRouter>{ui}</AdminRouter>);
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Поддержка (admin)', () => {
  it('lists conversations with an unread mark and a preview', async () => {
    mockApi();
    at('/admin/support', <SupportPage />);
    const list = await screen.findByRole('list', { name: 'Обращения' });
    expect(within(list).getByText('Маша Иванова')).toBeInTheDocument();
    expect(within(list).getByLabelText('непрочитанное')).toBeInTheDocument();
    expect(within(list).getByText('Не открывается задание 5')).toBeInTheDocument();
  });

  it('opens a conversation, marks it read and sends a reply with the admin header', async () => {
    const fetchMock = mockApi();
    at(`/admin/support/${T1}`, <SupportThreadPage id={T1} />);
    const messages = await screen.findByRole('list', { name: 'Сообщения' });
    expect(within(messages).getByText('Не открывается задание 5')).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/read'))).toBe(true),
    );
    fireEvent.change(screen.getByLabelText('Ответ пользователю'), {
      target: { value: 'Здравствуйте!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([u, init]) => String(u).endsWith('/messages') && init?.method === 'POST',
      );
      expect(post).toBeDefined();
      expect(JSON.parse(String(post![1]!.body))).toEqual({ text: 'Здравствуйте!' });
      expect((post![1]!.headers as Record<string, string>)['x-zybrilka-admin']).toBe('1');
    });
  });

  it('asks for news by itself every few seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = mockApi();
    at('/admin/support', <SupportPage />);
    await screen.findByRole('list', { name: 'Обращения' });
    const before = fetchMock.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(SUPPORT_POLL_MS + 50);
    });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
  });

  it('«Написать первым» says honestly why the bot cannot write', async () => {
    mockApi();
    at('/admin/support', <SupportPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Написать первым' }));
    fireEvent.change(screen.getByLabelText('Найти пользователя'), { target: { value: 'Петя' } });
    expect(await screen.findByText(/не запускал бота/)).toBeInTheDocument();
  });
});
