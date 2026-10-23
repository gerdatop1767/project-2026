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
    window.history.replaceState(null, '', '/task/task-1?from=training');
  });
  afterEach(() => vi.unstubAllGlobals());

  const json = (status: number, body: unknown) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  const sentBody = () => {
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    return JSON.parse(init.body as string) as Record<string, unknown>;
  };

  it('opens straight on the eight categories', () => {
    render(<ReportTaskContent taskId="task-1" />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.closest('label')!.textContent)).toEqual([
      'Неправильный ответ в задании',
      'Ошибка в условии',
      'Ошибка в решении или объяснении',
      'Ошибка в изображении, формуле или форматировании',
      'Невозможно отправить или проверить ответ',
      'Задание относится не к той теме',
      'Задание дублируется',
      'Другая причина',
    ]);
  });

  it('one tap on a category is a complete report; the screen, path and variant go along', async () => {
    fetchMock.mockReturnValueOnce(json(201, { id: 'c1', reportId: 'RPT-7', status: 'created' }));
    const user = userEvent.setup();
    render(<ReportTaskContent taskId="task-1" screen="result" variantId="v-1" />);
    const send = screen.getByRole('button', { name: 'Отправить' });
    expect(send).toBeDisabled(); // nothing picked yet
    await user.click(screen.getByRole('radio', { name: 'Неправильный ответ в задании' }));
    await user.click(send);
    expect(await screen.findByRole('status')).toHaveTextContent('Номер обращения: RPT-7');
    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(String(url)).toContain('/api/v1/tasks/task-1/complaints');
    expect(sentBody()).toEqual({
      reason: 'wrong_answer',
      context: { screen: 'result', path: '/task/task-1?from=training', variantId: 'v-1' },
    });
  });

  it('sends a trimmed comment when one is written', async () => {
    fetchMock.mockReturnValueOnce(json(201, { id: 'c1', status: 'created' }));
    const user = userEvent.setup();
    render(<ReportTaskContent taskId="task-1" />);
    await user.click(screen.getByRole('radio', { name: 'Ошибка в условии' }));
    await user.type(screen.getByRole('textbox'), '  нет рисунка  ');
    await user.click(screen.getByRole('button', { name: 'Отправить' }));
    await screen.findByRole('status');
    expect(sentBody()).toMatchObject({ reason: 'condition_error', comment: 'нет рисунка' });
  });

  it('«Другая причина» needs the user’s own text before it can be sent', async () => {
    const user = userEvent.setup();
    render(<ReportTaskContent taskId="task-1" />);
    await user.click(screen.getByRole('radio', { name: 'Другая причина' }));
    expect(screen.getByText('Опишите проблему (обязательно)')).toBeInTheDocument();
    const send = screen.getByRole('button', { name: 'Отправить' });
    expect(send).toBeDisabled();
    await user.type(screen.getByRole('textbox'), '   ');
    expect(send).toBeDisabled();
    await user.type(screen.getByRole('textbox'), 'картинка от другого задания');
    expect(send).toBeEnabled();
  });

  it('limits the text and shows how much is left', async () => {
    const user = userEvent.setup();
    render(<ReportTaskContent taskId="task-1" />);
    const box = screen.getByRole('textbox');
    expect(box).toHaveAttribute('maxLength', '1000');
    await user.type(box, 'абв');
    expect(screen.getByText('3 / 1000')).toBeInTheDocument();
  });

  it('a double tap sends once', async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    const user = userEvent.setup();
    render(<ReportTaskContent taskId="task-1" />);
    await user.click(screen.getByRole('radio', { name: 'Задание дублируется' }));
    const send = screen.getByRole('button', { name: 'Отправить' });
    await user.dblClick(send);
    resolve(new Response(JSON.stringify({ id: 'c1', status: 'created' }), { status: 201 }));
    await screen.findByRole('status');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('says so when the same problem was already reported', async () => {
    fetchMock.mockReturnValueOnce(
      json(200, { id: 'c1', reportId: 'RPT-3', status: 'already_reported' }),
    );
    const user = userEvent.setup();
    render(<ReportTaskContent taskId="task-1" />);
    await user.click(screen.getByRole('radio', { name: 'Задание относится не к той теме' }));
    await user.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(await screen.findByRole('status')).toHaveTextContent('уже сообщили');
  });

  it('shows an error and keeps the form when sending fails', async () => {
    fetchMock.mockReturnValueOnce(json(500, { error: 'x' }));
    const user = userEvent.setup();
    render(<ReportTaskContent taskId="task-1" />);
    await user.click(screen.getByRole('radio', { name: 'Ошибка в условии' }));
    await user.click(screen.getByRole('button', { name: 'Отправить' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось отправить');
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeEnabled();
  });

  it('can be closed without sending', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ReportTaskContent taskId="task-1" onClose={onClose} />);
    await user.click(screen.getByRole('radio', { name: 'Ошибка в условии' }));
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(onClose).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a guest is offered sign-in, never a form that cannot be sent', () => {
    authState.user = null;
    render(<ReportTaskContent taskId="task-1" />);
    expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
