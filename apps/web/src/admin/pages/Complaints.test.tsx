import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminRouter } from '../router.js';
import { ComplaintPage, ComplaintsPage } from './Complaints.js';

const ID = 'cccccccc-0000-4000-8000-000000000001';
const TASK = 'aaaaaaaa-0000-4000-8000-000000000002';
const USER = 'bbbbbbbb-0000-4000-8000-000000000003';

const row = {
  id: ID,
  createdAt: '2026-10-20 12:00:00+00',
  updatedAt: '2026-10-20 12:00:00+00',
  resolvedAt: null,
  subjectId: 'math',
  taskId: TASK,
  taskNumber: 6,
  sourceYear: 2026,
  reason: 'wrong_answer',
  comment: 'В ответе должно быть 0,5, а не 5. '.repeat(5),
  status: 'new',
  internalComment: null,
  userId: USER,
  otherComplaints: 1,
};

const list = {
  total: 1,
  page: 1,
  pageSize: 25,
  items: [row],
  counts: { new: 1, in_progress: 2, fixed: 3 },
};

const card = {
  complaint: {
    ...row,
    taskPreview: 'Найдите корень уравнения log_2(x) = 3.',
    taskStatus: 'published',
  },
  others: [
    {
      id: 'dddddddd-0000-4000-8000-000000000004',
      reason: 'typo',
      status: 'fixed',
      comment: 'Опечатка',
      createdAt: '2026-10-10 12:00:00+00',
    },
  ],
  history: [
    {
      id: 'l1',
      action: 'complaint.updated',
      result: 'ok',
      details: { status: { from: 'new', to: 'in_progress' } },
      actorUserId: USER,
      createdAt: '2026-10-21 08:00:00+00',
    },
  ],
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

describe('ComplaintsPage', () => {
  it('renders complaints, counts and links', async () => {
    const fetch = mockFetch(() => [200, list]);
    renderAt('/admin/complaints?status=new&reason=wrong_answer', <ComplaintsPage />);
    expect(await screen.findByRole('link', { name: 'cccccccc' })).toHaveAttribute(
      'href',
      `/admin/complaints/${ID}`,
    );
    expect(screen.getByRole('link', { name: 'aaaaaaaa' })).toHaveAttribute(
      'href',
      `/admin/content/tasks/${TASK}`,
    );
    expect(screen.getByRole('link', { name: 'bbbbbbbb' })).toHaveAttribute(
      'href',
      `/admin/users/${USER}`,
    );
    expect(screen.getByRole('button', { name: 'Все · 6' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'В работе · 2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отклонено · 0' })).toBeInTheDocument();
    expect(screen.getByText(/…$/)).toBeInTheDocument();
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.searchParams.get('status')).toBe('new');
    expect(url.searchParams.get('reason')).toBe('wrong_answer');
    fireEvent.click(screen.getByRole('button', { name: 'Исправлено · 3' }));
    expect(new URLSearchParams(window.location.search).get('status')).toBe('fixed');
  });

  it('shows the empty state', async () => {
    mockFetch(() => [200, { total: 0, page: 1, pageSize: 25, items: [], counts: {} }]);
    renderAt('/admin/complaints', <ComplaintsPage />);
    expect(await screen.findByText(/Жалоб пока нет/)).toBeInTheDocument();
  });

  it('shows an error with retry', async () => {
    mockFetch(() => [500, { error: 'internal_error' }]);
    renderAt('/admin/complaints', <ComplaintsPage />);
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });
});

describe('ComplaintPage', () => {
  it('renders the card and changes status / comment', async () => {
    const fetch = mockFetch((_url, init) =>
      init.method === 'PATCH' ? [200, { ...row, status: 'fixed' }] : [200, card],
    );
    renderAt(`/admin/complaints/${ID}`, <ComplaintPage id={ID} />);
    expect(await screen.findByText(/Найдите корень уравнения/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Открыть задание' })).toHaveAttribute(
      'href',
      `/admin/content/tasks/${TASK}`,
    );
    expect(screen.getByText(/статус: Новая → В работе/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'dddddddd' })).toBeInTheDocument();

    // Closing status goes through the confirmation dialog.
    fireEvent.click(screen.getByRole('button', { name: 'Исправлено' }));
    const dialog = await screen.findByRole('dialog');
    expect(fetch.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(false);
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Исправлено')!,
    );
    await waitFor(() => expect(fetch.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(true));
    const patch = fetch.mock.calls.find(([, i]) => i?.method === 'PATCH')!;
    expect(new URL(String(patch[0])).pathname).toBe(`/api/v1/admin/complaints/${ID}`);
    expect(JSON.parse(String(patch[1]!.body))).toEqual({ status: 'fixed' });
    expect((patch[1]!.headers as Record<string, string>)['x-zybrilka-admin']).toBe('1');

    // Non-closing status is immediate.
    fireEvent.click(screen.getByRole('button', { name: 'В работу' }));
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(
          ([, i]) => i?.method === 'PATCH' && String(i.body) === '{"status":"in_progress"}',
        ),
      ).toBe(true),
    );

    fireEvent.change(screen.getByLabelText('Комментарий'), {
      target: { value: '  Проверить с автором  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Сохранено')).toBeInTheDocument();
    expect(
      fetch.mock.calls.some(
        ([, i]) =>
          i?.method === 'PATCH' && String(i.body) === '{"internalComment":"Проверить с автором"}',
      ),
    ).toBe(true);
  });

  it('shows not found on 404', async () => {
    mockFetch(() => [404, { error: 'not_found' }]);
    renderAt(`/admin/complaints/${ID}`, <ComplaintPage id={ID} />);
    expect(await screen.findByText('Жалоба не найдена.')).toBeInTheDocument();
  });
});
