import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminRouter } from '../router.js';
import { ComplaintPage, ComplaintsPage } from './Complaints.js';

const ID = 'cccccccc-0000-4000-8000-000000000001';
const TASK = 'aaaaaaaa-0000-4000-8000-000000000002';
const USER = 'bbbbbbbb-0000-4000-8000-000000000003';

const row = {
  id: ID,
  reportNumber: 42,
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
  context: { screen: 'task', path: '/task/x?from=training' },
  duplicateOf: null,
  handledByUserId: null,
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
    taskStatus: 'published',
    taskStatement: 'Найдите корень уравнения log_2(x) = 4.',
    taskAnswer: '16',
    taskExplanation: 'По определению логарифма x = 2^4.',
    snapshot: {
      statement: 'Найдите корень уравнения log_2(x) = 3.',
      answer: '8',
      explanation: 'По определению логарифма x = 2^3.',
      taskUpdatedAt: '2026-10-01 10:00:00+00',
    },
  },
  report: {
    reportNumber: 42,
    id: ID,
    status: 'new',
    createdAt: '2026-10-20 12:00:00+00',
    subjectName: 'Математика',
    taskId: TASK,
    taskNumber: 6,
    source: 'ФИПИ',
    sourceYear: 2026,
    sourceDocument: null,
    variant: null,
    reason: 'wrong_answer',
    comment: 'В ответе должно быть 0,5',
    statement: 'Найдите корень уравнения log_2(x) = 3.',
    statementFromSnapshot: true,
    taskChangedSinceReport: true,
    expectedAnswer: '8',
    explanation: 'По определению логарифма x = 2^3.',
    context: { screen: 'task', path: '/task/x?from=training' },
    duplicateOf: null,
    adminUrl: `https://zybrilka.test/admin/complaints/${ID}`,
  },
  others: [
    {
      id: 'dddddddd-0000-4000-8000-000000000004',
      reportNumber: 40,
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
    expect(await screen.findByRole('link', { name: 'RPT-42' })).toHaveAttribute(
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
    expect(screen.getByRole('button', { name: 'Отклонена · 0' })).toBeInTheDocument();
    expect(screen.getByText(/…$/)).toBeInTheDocument();
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.searchParams.get('status')).toBe('new');
    expect(url.searchParams.get('reason')).toBe('wrong_answer');
    fireEvent.click(screen.getByRole('button', { name: 'Исправлена · 3' }));
    expect(new URLSearchParams(window.location.search).get('status')).toBe('fixed');
  });

  it('searches by id and sorts by date through the URL', async () => {
    const fetch = mockFetch(() => [200, list]);
    renderAt('/admin/complaints', <ComplaintsPage />);
    await screen.findByRole('link', { name: 'RPT-42' });
    fireEvent.change(screen.getByLabelText('Поиск по ID'), { target: { value: ' RPT-42 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Найти' }));
    expect(new URLSearchParams(window.location.search).get('q')).toBe('RPT-42');
    fireEvent.change(screen.getByLabelText('Сортировка'), { target: { value: 'oldest' } });
    expect(new URLSearchParams(window.location.search).get('sort')).toBe('oldest');
    await waitFor(() => {
      const last = new URL(String(fetch.mock.calls.at(-1)![0]));
      expect(last.searchParams.get('q')).toBe('RPT-42');
      expect(last.searchParams.get('sort')).toBe('oldest');
    });
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
    // The statement the user saw (snapshot), with the current one on demand.
    expect(await screen.findByText('Найдите корень уравнения log_2(x) = 3.')).toBeInTheDocument();
    expect(screen.getByText(/Задание с тех пор изменено/)).toBeInTheDocument();
    expect(screen.getByText('Найдите корень уравнения log_2(x) = 4.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Открыть задание' })).toHaveAttribute(
      'href',
      `/admin/content/tasks/${TASK}`,
    );
    expect(screen.getByText(/статус: Новая → В работе/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'RPT-40' })).toBeInTheDocument();

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

  it('copies the full report for Claude, the short version and the id', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mockFetch(() => [200, card]);
    renderAt(`/admin/complaints/${ID}`, <ComplaintPage id={ID} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Скопировать для Claude' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const full = writeText.mock.calls[0]![0] as string;
    expect(full).toMatch(/^\[ZUBRILKA BUG REPORT\]\nReport ID: RPT-42\n/);
    expect(full).toContain(`Task ID: ${TASK}`);
    expect(full).toContain('Expected answer:\n8');
    expect(full).toContain('Variant: not available');
    expect(full).toContain('Path: /task/x?from=training');
    fireEvent.click(screen.getByRole('button', { name: 'Краткая версия' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText.mock.calls[1]![0]).toMatch(/^RPT-42 \[new\] wrong_answer: Математика, №6/);
    fireEvent.click(screen.getByRole('button', { name: 'ID жалобы' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('RPT-42'));
    expect(screen.getAllByText('Скопировано').length).toBeGreaterThan(0);
  });

  it('without any clipboard access shows the report to copy by hand', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const exec = vi.fn(() => false);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    mockFetch(() => [200, card]);
    renderAt(`/admin/complaints/${ID}`, <ComplaintPage id={ID} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Скопировать для Claude' }));
    const manual = await screen.findByLabelText(/текст для ручного копирования/);
    expect((manual as HTMLTextAreaElement).value).toContain('Report ID: RPT-42');
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('marks a complaint as a duplicate of another', async () => {
    const fetch = mockFetch((_url, init) => (init.method === 'PATCH' ? [200, row] : [200, card]));
    renderAt(`/admin/complaints/${ID}`, <ComplaintPage id={ID} />);
    fireEvent.change(await screen.findByLabelText('Исходная жалоба'), {
      target: { value: 'RPT-40' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Отметить как дубликат' }));
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(
          ([, i]) => i?.method === 'PATCH' && String(i.body) === '{"duplicateOf":"RPT-40"}',
        ),
      ).toBe(true),
    );
  });

  it('shows not found on 404', async () => {
    mockFetch(() => [404, { error: 'not_found' }]);
    renderAt(`/admin/complaints/${ID}`, <ComplaintPage id={ID} />);
    expect(await screen.findByText('Жалоба не найдена.')).toBeInTheDocument();
  });
});
