import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportTaskContent } from './ReportTaskContent.js';

const authState: { user: { id: string } | null } = { user: { id: 'u1' } };
vi.mock('../../lib/authContext.js', () => ({ useAuth: () => authState }));

describe('ReportTaskContent', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    authState.user = { id: 'u1' };
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const json = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

  it('sends the chosen reason and trimmed comment, then confirms', async () => {
    fetchMock.mockReturnValueOnce(json(201, { id: 'c1', status: 'created' }));
    const user = userEvent.setup();
    render(<ReportTaskContent taskId="task-1" />);
    await user.click(screen.getByRole('button', { name: 'Пожаловаться на задание' }));
    const send = screen.getByRole('button', { name: 'Отправить жалобу' });
    expect(send).toBeDisabled(); // no reason picked yet
    await user.click(screen.getByRole('radio', { name: 'Неверный ответ' }));
    await user.type(screen.getByRole('textbox'), '  ответ 7  ');
    await user.click(send);
    expect(await screen.findByRole('status')).toHaveTextContent('Жалоба отправлена');
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain('/api/v1/tasks/task-1/complaints');
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'wrong_answer', comment: 'ответ 7' });
  });

  it('says so when the same problem was already reported', async () => {
    fetchMock.mockReturnValueOnce(json(200, { id: 'c1', status: 'already_reported' }));
    const user = userEvent.setup();
    render(<ReportTaskContent taskId="task-1" />);
    await user.click(screen.getByRole('button', { name: 'Пожаловаться на задание' }));
    await user.click(screen.getByRole('radio', { name: 'Опечатка' }));
    await user.click(screen.getByRole('button', { name: 'Отправить жалобу' }));
    expect(await screen.findByRole('status')).toHaveTextContent('уже сообщили');
  });

  it('shows an error and keeps the form when sending fails', async () => {
    fetchMock.mockReturnValueOnce(json(500, { error: 'x' }));
    const user = userEvent.setup();
    render(<ReportTaskContent taskId="task-1" />);
    await user.click(screen.getByRole('button', { name: 'Пожаловаться на задание' }));
    await user.click(screen.getByRole('radio', { name: 'Другое' }));
    await user.click(screen.getByRole('button', { name: 'Отправить жалобу' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось отправить');
    expect(screen.getByRole('button', { name: 'Отправить жалобу' })).toBeEnabled();
  });

  it('a guest is offered sign-in, never a form that cannot be sent', async () => {
    authState.user = null;
    const user = userEvent.setup();
    render(<ReportTaskContent taskId="task-1" />);
    await user.click(screen.getByRole('button', { name: 'Пожаловаться на задание' }));
    expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
