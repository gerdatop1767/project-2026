import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminRouter } from '../router.js';
import { UserPage, UsersPage } from './Users.js';

const USER_ID = '3f2b1c4d-0000-4000-8000-000000000001';

const userRow = {
  id: USER_ID,
  name: 'Анна',
  registeredAt: '2026-10-01 09:00:00+00',
  lastActivity: '2026-10-20 12:00:00+00',
  subjects: ['math'],
  solves: 12,
  correct: 9,
  incorrect: 3,
  accuracy: 0.75,
  activeDays: 4,
  source: 'unknown',
  campaign: null,
  methods: ['vk'],
  status: 'active',
};

const list = {
  total: 2,
  page: 1,
  pageSize: 25,
  items: [
    userRow,
    {
      ...userRow,
      id: '9a8b7c6d-0000-4000-8000-000000000002',
      name: null,
      solves: 0,
      correct: 0,
      incorrect: 0,
      accuracy: null,
      activeDays: 0,
      lastActivity: null,
      subjects: null,
      status: 'no_solves',
    },
  ],
};

const card = {
  user: {
    ...userRow,
    firstAnswer: '2026-10-01 10:00:00+00',
    lastAnswer: '2026-10-20 12:00:00+00',
    firstSolve: '2026-10-01 10:01:00+00',
  },
  streaks: { current: 2, best: 3 },
  activity90d: [
    { day: '2026-10-19', attempts: 5, correct: 4 },
    { day: '2026-10-20', attempts: 7, correct: 5 },
  ],
  bySubject: [{ subjectId: 'math', attempts: 12, correct: 9, solved: 8 }],
  byNumber: [{ subjectId: 'math', taskNumber: 6, attempts: 12, correct: 9 }],
  byTopic: [{ topic: 'Логарифмы', subjectId: 'math', attempts: 12, correct: 9 }],
  mistakes: [
    {
      taskId: 'aaaaaaaa-0000-4000-8000-000000000003',
      subjectId: 'math',
      taskNumber: 6,
      timesWrong: 2,
      status: 'open',
      updatedAt: '2026-10-20 12:00:00+00',
    },
  ],
  history: [
    {
      id: 'h1',
      taskId: 'aaaaaaaa-0000-4000-8000-000000000003',
      subjectId: 'math',
      taskNumber: 6,
      correct: false,
      timeSpentMs: 65000,
      createdAt: '2026-10-20 12:00:00+00',
    },
  ],
  complaints: [
    {
      id: 'cccccccc-0000-4000-8000-000000000004',
      taskId: 'aaaaaaaa-0000-4000-8000-000000000003',
      reason: 'wrong_answer',
      status: 'new',
      createdAt: '2026-10-20 12:00:00+00',
    },
  ],
  activeSessions: 2,
};

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

function renderAt(path: string, ui: React.ReactNode) {
  window.history.replaceState(null, '', path);
  return render(<AdminRouter>{ui}</AdminRouter>);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('UsersPage', () => {
  it('renders the list with server params from the URL', async () => {
    const fetch = mockFetch(() => [200, list]);
    renderAt('/admin/users?segment=active7&sort=solves&dir=asc', <UsersPage />);
    expect(await screen.findByText('Анна')).toBeInTheDocument();
    expect(screen.getByText('без имени')).toBeInTheDocument();
    expect(screen.getByText('Активен')).toBeInTheDocument();
    expect(screen.getAllByText('Без решений').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Неизвестно').length).toBe(2);
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '3f2b1c4d' })).toHaveAttribute(
      'href',
      `/admin/users/${USER_ID}`,
    );
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.pathname).toBe('/api/v1/admin/users');
    expect(url.searchParams.get('segment')).toBe('active7');
    expect(url.searchParams.get('sort')).toBe('solves');
    expect(url.searchParams.get('dir')).toBe('asc');
    expect(url.searchParams.get('pageSize')).toBe('25');
    expect(screen.getByRole('link', { name: 'CSV' }).getAttribute('href')).toContain(
      '/api/v1/admin/export/users?segment=active7',
    );
  });

  it('keeps filters in the URL', async () => {
    mockFetch(() => [200, list]);
    renderAt('/admin/users', <UsersPage />);
    await screen.findByText('Анна');
    fireEvent.change(screen.getByLabelText('Решений'), { target: { value: '10' } });
    expect(window.location.search).toBe('?minSolves=10');
    fireEvent.change(screen.getByLabelText('Поиск (ID или имя)'), { target: { value: 'Анн' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
    expect(new URLSearchParams(window.location.search).get('q')).toBe('Анн');
  });

  it('shows an empty state', async () => {
    mockFetch(() => [200, { total: 0, page: 1, pageSize: 25, items: [] }]);
    renderAt('/admin/users', <UsersPage />);
    expect(
      await screen.findByText('Зарегистрированных пользователей пока нет.'),
    ).toBeInTheDocument();
  });

  it('shows an error with retry', async () => {
    mockFetch(() => [500, { error: 'internal_error' }]);
    renderAt('/admin/users', <UsersPage />);
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });
});

describe('UserPage', () => {
  it('renders the card and revokes sessions after confirmation', async () => {
    const fetch = mockFetch((url, init) => {
      if (init.method === 'POST') return [200, { revoked: 2 }];
      return [200, card];
    });
    renderAt(`/admin/users/${USER_ID}`, <UserPage id={USER_ID} />);
    expect(await screen.findByRole('heading', { name: 'Анна' })).toBeInTheDocument();
    expect(screen.getByText('Логарифмы')).toBeInTheDocument();
    expect(screen.getByText('1 мин 5 с')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'aaaaaaaa' })).toHaveAttribute(
      'href',
      '/admin/content/tasks/aaaaaaaa-0000-4000-8000-000000000003',
    );
    expect(screen.getByRole('link', { name: 'cccccccc' })).toHaveAttribute(
      'href',
      '/admin/complaints/cccccccc-0000-4000-8000-000000000004',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Завершить все сессии' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Завершить сессии' }));
    expect(await screen.findByText('Завершено сессий: 2.')).toBeInTheDocument();

    const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(new URL(String(post[0])).pathname).toBe(
      `/api/v1/admin/users/${USER_ID}/revoke-sessions`,
    );
    expect(JSON.parse(String(post[1]!.body))).toEqual({ confirm: true });
    expect((post[1]!.headers as Record<string, string>)['x-zybrilka-admin']).toBe('1');
    await waitFor(() =>
      expect(fetch.mock.calls.filter(([, i]) => i?.method === 'GET').length).toBe(2),
    );
  });

  it('disables revoking when there are no sessions', async () => {
    mockFetch(() => [200, { ...card, activeSessions: 0 }]);
    renderAt(`/admin/users/${USER_ID}`, <UserPage id={USER_ID} />);
    expect(await screen.findByRole('button', { name: 'Завершить все сессии' })).toBeDisabled();
  });

  it('shows not found on 404', async () => {
    mockFetch(() => [404, { error: 'not_found' }]);
    renderAt(`/admin/users/${USER_ID}`, <UserPage id={USER_ID} />);
    expect(await screen.findByText('Пользователь не найден.')).toBeInTheDocument();
  });
});
