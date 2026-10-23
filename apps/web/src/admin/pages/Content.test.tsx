import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminRouter } from '../router.js';
import { ContentPage, SubjectPage, TaskPage } from './Content.js';

const period = {
  from: '2026-09-23',
  to: '2026-09-25',
  days: 3,
  granularity: 'day',
  timezone: 'Europe/Moscow',
  previous: { from: '2026-09-20', to: '2026-09-22' },
};

const TASK_ID = '3f2a9c1e-1111-4222-8333-444455556666';

const subjects = {
  period,
  items: [
    {
      subjectId: 'math',
      name: 'Математика',
      tasks: 120,
      published: 110,
      attempts: 840,
      correct: 600,
      uniqueSolvers: 57,
      guestChecks: 33,
      openComplaints: 2,
    },
  ],
};

const tasks = {
  period,
  total: 1,
  page: 1,
  pageSize: 25,
  items: [
    {
      id: TASK_ID,
      subjectId: 'math',
      taskNumber: 6,
      status: 'published',
      source: 'ФИПИ',
      sourceYear: 2026,
      updatedAt: '2026-09-20 10:00:00+00',
      preview: 'Найдите корень уравнения',
      attempts: 40,
      correct: 30,
      incorrect: 10,
      uniqueSolvers: 12,
      solved: 11,
      complaints: 1,
    },
  ],
};

const subjectDetail = {
  period,
  subject: { id: 'math', name: 'Математика' },
  minSample: 20,
  totals: {
    attempts: 50,
    correct: 30,
    incorrect: 20,
    uniqueSolvers: 9,
    solvedPairs: 14,
    userTaskPairs: 25,
    accuracy: 0.6,
    averageAttemptsPerTask: 2,
    repeats: 25,
  },
  daily: [{ day: '2026-09-24', attempts: 50, correct: 30 }],
  byNumber: [
    {
      taskNumber: 6,
      tasks: 10,
      attempts: 50,
      correct: 30,
      incorrect: 20,
      uniqueSolvers: 9,
      solved: 14,
      openComplaints: 1,
    },
  ],
  top: {
    popular: [
      {
        id: TASK_ID,
        taskNumber: 6,
        status: 'published',
        preview: 'Найдите корень',
        attempts: 50,
        correct: 30,
        incorrect: 20,
        uniqueSolvers: 9,
        solved: 14,
        complaints: 1,
      },
    ],
    hardest: [],
    complained: [],
  },
};

const stats = { attempts: 4, correct: 3, incorrect: 1, uniqueSolvers: 2, solved: 2 };
const taskCard = {
  period,
  task: {
    id: TASK_ID,
    subjectId: 'math',
    subjectName: 'Математика',
    taskNumber: 6,
    difficulty: 2,
    status: 'published',
    answerType: 'short_answer',
    conditionMd: 'Найдите корень уравнения <b>x</b> = 5',
    correctAnswer: '5',
    correctAnswerDisplay: null,
    explanationMd: 'Очевидно, x = 5.',
    hintMd: null,
    imageUrl: null,
    source: 'ФИПИ',
    sourceUrl: 'javascript:alert(1)',
    sourceYear: 2026,
    sourceDocument: 'Демоверсия',
    sourceVariant: null,
    sourcePage: 3,
    topicName: 'Уравнения',
    createdAt: '2026-09-01 10:00:00+00',
    updatedAt: '2026-09-20 10:00:00+00',
  },
  stats: { period: stats, allTime: { ...stats, attempts: 10 } },
  guest: { checks: 7, correct: 5, started: 12 },
  complaints: [
    {
      id: 'c0ffee00-0000-4000-8000-000000000001',
      reason: 'wrong_answer',
      status: 'new',
      comment: 'Ответ не тот',
      createdAt: '2026-09-21 10:00:00+00',
    },
  ],
  history: [
    {
      id: 'h1',
      action: 'task.status_changed',
      result: 'ok',
      details: { from: 'draft', to: 'published' },
      createdAt: '2026-09-19 10:00:00+00',
    },
  ],
  variants: [{ title: 'Вариант 1', collection: 'Сборник 2026', position: 6 }],
};

type Handler = (url: URL, init: RequestInit) => { status: number; body: unknown };

function mockFetch(handler: Handler) {
  const fn = vi.fn(async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input), window.location.origin);
    const { status, body } = handler(url, init);
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

describe('ContentPage', () => {
  it('renders subjects and the task table, passing URL filters to the API', async () => {
    const fetchFn = mockFetch((url) =>
      url.pathname.endsWith('/content/subjects')
        ? { status: 200, body: subjects }
        : { status: 200, body: tasks },
    );
    renderAt('/admin/content?subject=math&sort=attempts&dir=desc&page=2', <ContentPage />);
    expect(await screen.findByRole('link', { name: 'Математика' })).toHaveAttribute(
      'href',
      '/admin/content/subjects/math?period=30d',
    );
    expect(await screen.findByRole('link', { name: '3f2a9c1e' })).toHaveAttribute(
      'href',
      `/admin/content/tasks/${TASK_ID}?period=30d`,
    );
    expect(screen.getByText('ФИПИ · 2026')).toBeInTheDocument();
    const taskUrl = fetchFn.mock.calls
      .map((c) => new URL(String(c[0])))
      .find((u) => u.pathname === '/api/v1/admin/content/tasks')!;
    expect(taskUrl.searchParams.get('subject')).toBe('math');
    expect(taskUrl.searchParams.get('sort')).toBe('attempts');
    expect(taskUrl.searchParams.get('dir')).toBe('desc');
    expect(taskUrl.searchParams.get('page')).toBe('2');
    expect(taskUrl.searchParams.get('pageSize')).toBe('25');
    expect(screen.getByRole('link', { name: 'CSV: предметы' })).toHaveAttribute(
      'href',
      '/api/v1/admin/export/subjects?period=30d',
    );
    expect(screen.getByRole('link', { name: 'CSV: номера' })).toHaveAttribute(
      'href',
      '/api/v1/admin/export/numbers?period=30d',
    );
  });

  it('puts the search into the URL on submit', async () => {
    mockFetch((url) =>
      url.pathname.endsWith('/content/subjects')
        ? { status: 200, body: subjects }
        : { status: 200, body: tasks },
    );
    const user = userEvent.setup();
    renderAt('/admin/content', <ContentPage />);
    await screen.findByRole('link', { name: '3f2a9c1e' });
    await user.type(screen.getByLabelText(/Поиск/), 'корень');
    await user.click(screen.getByRole('button', { name: 'Найти' }));
    expect(new URLSearchParams(window.location.search).get('q')).toBe('корень');
  });

  it('shows the empty state', async () => {
    mockFetch((url) =>
      url.pathname.endsWith('/content/subjects')
        ? { status: 200, body: { period, items: [] } }
        : { status: 200, body: { ...tasks, total: 0, items: [] } },
    );
    renderAt('/admin/content', <ContentPage />);
    expect(await screen.findByText('Заданий по этим фильтрам нет.')).toBeInTheDocument();
    expect(screen.getByText('Предметов пока нет.')).toBeInTheDocument();
  });

  it('shows an error with retry on 500', async () => {
    mockFetch(() => ({ status: 500, body: { error: 'internal_error' } }));
    renderAt('/admin/content', <ContentPage />);
    const retries = await screen.findAllByRole('button', { name: 'Повторить' });
    expect(retries.length).toBeGreaterThan(0);
  });
});

describe('SubjectPage', () => {
  it('renders KPIs, number drill-down and top lists', async () => {
    mockFetch(() => ({ status: 200, body: subjectDetail }));
    renderAt('/admin/content/subjects/math', <SubjectPage id="math" />);
    expect(await screen.findByRole('heading', { name: 'Математика' })).toBeInTheDocument();
    expect(screen.getByText('Точность').nextSibling).toHaveTextContent('60%');
    expect(screen.getByRole('link', { name: '№6' })).toHaveAttribute(
      'href',
      '/admin/content?period=30d&subject=math&number=6',
    );
    expect(screen.getByText(/Только задания с ≥ 20 ответами; сложное ≠ ошибочное/)).toBeVisible();
    expect(screen.getByText('Нет заданий с достаточной выборкой.')).toBeInTheDocument();
  });

  it('shows «Предмет не найден» on 404', async () => {
    mockFetch(() => ({ status: 404, body: { error: 'not_found' } }));
    renderAt('/admin/content/subjects/nope', <SubjectPage id="nope" />);
    expect(await screen.findByText('Предмет не найден')).toBeInTheDocument();
  });

  it('shows an error with retry on 500', async () => {
    mockFetch(() => ({ status: 500, body: { error: 'internal_error' } }));
    renderAt('/admin/content/subjects/math', <SubjectPage id="math" />);
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });
});

describe('TaskPage', () => {
  it('renders the task card with plain-text content and no unsafe link', async () => {
    mockFetch(() => ({ status: 200, body: taskCard }));
    renderAt(`/admin/content/tasks/${TASK_ID}`, <TaskPage id={TASK_ID} />);
    expect(await screen.findByText('Найдите корень уравнения <b>x</b> = 5')).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
    expect(screen.queryByRole('link', { name: 'ФИПИ' })).toBeNull();
    expect(screen.getByText('Уравнения')).toBeInTheDocument();
    expect(screen.getByText('Статус: Черновик → Опубликовано')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Неправильный ответ в задании' })).toHaveAttribute(
      'href',
      '/admin/complaints/c0ffee00-0000-4000-8000-000000000001',
    );
    expect(screen.getByText(/Редактора заданий в проекте пока нет/)).toBeInTheDocument();
    expect(screen.getByText('Сборник 2026 · Вариант 1 · позиция 6')).toBeInTheDocument();
  });

  it('changes status through the confirm dialog and reloads', async () => {
    let status = 'published';
    const fetchFn = mockFetch((url, init) => {
      if (init.method === 'POST') {
        status = 'archived';
        return { status: 200, body: { id: TASK_ID, status, previousStatus: 'published' } };
      }
      return { status: 200, body: { ...taskCard, task: { ...taskCard.task, status } } };
    });
    const user = userEvent.setup();
    renderAt(`/admin/content/tasks/${TASK_ID}`, <TaskPage id={TASK_ID} />);
    await user.click(await screen.findByRole('button', { name: 'Скрыть' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/перестанет показываться ученикам/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Скрыть задание' }));

    const post = fetchFn.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(new URL(String(post[0])).pathname).toBe(`/api/v1/admin/content/tasks/${TASK_ID}/status`);
    expect(JSON.parse(String(post[1]!.body))).toEqual({ status: 'archived', confirm: true });
    expect((post[1]!.headers as Record<string, string>)['x-zybrilka-admin']).toBe('1');
    await waitFor(() =>
      expect(fetchFn.mock.calls.filter((c) => (c[1]?.method ?? 'GET') === 'GET').length).toBe(2),
    );
    expect(await screen.findByRole('button', { name: 'Опубликовать' })).toBeInTheDocument();
  });

  it('shows «Задание не найдено» on 404', async () => {
    mockFetch(() => ({ status: 404, body: { error: 'not_found' } }));
    renderAt('/admin/content/tasks/x', <TaskPage id="x" />);
    expect(await screen.findByText('Задание не найдено')).toBeInTheDocument();
  });

  it('shows an error with retry on 500', async () => {
    mockFetch(() => ({ status: 500, body: { error: 'internal_error' } }));
    renderAt(`/admin/content/tasks/${TASK_ID}`, <TaskPage id={TASK_ID} />);
    expect(await screen.findByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });
});
