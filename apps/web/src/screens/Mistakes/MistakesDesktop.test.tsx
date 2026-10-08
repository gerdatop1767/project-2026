import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MistakesDesktop } from './MistakesDesktop.js';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import { ToastProvider } from '../../ui/Toast/ToastProvider.js';
import * as api from '../../lib/api.js';

vi.mock('../../lib/api.js', () => ({
  getMistakes: vi.fn(),
  getSimilarTasks: vi.fn(() => Promise.resolve([])),
}));

const apiMistakes = [
  {
    id: 'm1',
    taskId: '11111111-1111-1111-1111-111111111111',
    subjectId: 'math',
    taskNumber: 15,
    topicName: 'Логарифмы',
    conditionMd: 'Решите неравенство: log₂(x² − 3x − 4) ≥ 1',
    userAnswer: '(−∞; 2]',
    correctAnswer: '(−∞; −1] ∪ [2; +∞)',
    timesWrong: 2,
    status: 'open' as const,
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
  },
  {
    id: 'm2',
    taskId: '22222222-2222-2222-2222-222222222222',
    subjectId: 'math',
    taskNumber: 11,
    topicName: 'Функции',
    conditionMd: 'Найдите наибольшее значение функции f(x) = x³ − 3x² − 9x + 4',
    userAnswer: '−1',
    correctAnswer: '9',
    timesWrong: 1,
    status: 'resolved' as const,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-21T00:00:00.000Z',
  },
];

function OverlayMarker() {
  const { overlay } = useNavigation();
  if (overlay?.screen === 'task') {
    return (
      <p data-testid="overlay">
        task:{overlay.taskId}:returnTo={overlay.returnTo?.screen ?? 'none'}:count=
        {overlay.customOrderedTasks?.length ?? 0}
      </p>
    );
  }
  return <p data-testid="overlay">{overlay?.screen ?? 'none'}</p>;
}

function renderScreen() {
  return render(
    <NavigationProvider>
      <ToastProvider>
        <MistakesDesktop />
        <OverlayMarker />
      </ToastProvider>
    </NavigationProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.getMistakes).mockResolvedValue(apiMistakes);
});

describe('MistakesDesktop', () => {
  it('fetches real mistakes and renders them with counts derived from the response', async () => {
    renderScreen();
    expect(await screen.findByText(apiMistakes[0]!.conditionMd)).toBeInTheDocument();
    expect(screen.getByText(/Все ошибки 2/)).toBeInTheDocument();
    // Only the open mistake counts as unsolved.
    expect(screen.getByText(/Неразобранные 1/)).toBeInTheDocument();
  });

  it('opens the real task for a mistake via "Разобрать"', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText(apiMistakes[0]!.conditionMd);
    await user.click(screen.getAllByRole('button', { name: /Разобрать/ })[0]!);
    expect(screen.getByTestId('overlay')).toHaveTextContent('task');
  });

  it('groups mistakes by task number, with the number as the group header', async () => {
    renderScreen();
    await screen.findByText(apiMistakes[0]!.conditionMd);
    expect(screen.getByRole('button', { name: /№15/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /№11/ })).toBeInTheDocument();
    expect(screen.getAllByText('1 ошибка')).toHaveLength(2);
  });

  it('collapses and re-expands a task-number group without losing the real mistake', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText(apiMistakes[0]!.conditionMd);
    const group15Header = screen.getByRole('button', { name: /№15/ });
    expect(group15Header).toHaveAttribute('aria-expanded', 'true');
    await user.click(group15Header);
    expect(group15Header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(apiMistakes[0]!.conditionMd)).not.toBeInTheDocument();
    await user.click(group15Header);
    expect(await screen.findByText(apiMistakes[0]!.conditionMd)).toBeInTheDocument();
  });
});

describe('MistakesDesktop — "Решить похожее" (deterministic similarity engine, same taskNumber only)', () => {
  it('on a real candidate list, opens the first similar task carrying the whole list as customOrderedTasks', async () => {
    vi.mocked(api.getSimilarTasks).mockResolvedValue([
      { taskId: 'aaaaaaaa-0000-0000-0000-000000000001', taskNumber: 15, score: 80 },
      { taskId: 'bbbbbbbb-0000-0000-0000-000000000002', taskNumber: 15, score: 60 },
    ]);
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText(apiMistakes[0]!.conditionMd);

    // Groups sort by task number ascending — apiMistakes[1] (№11)
    // renders its card, and its "Решить похожее" button, before
    // apiMistakes[0] (№15).
    await user.click(screen.getAllByRole('button', { name: 'Решить похожее' })[0]!);

    expect(api.getSimilarTasks).toHaveBeenCalledWith(apiMistakes[1]!.taskId);
    await waitFor(() =>
      expect(screen.getByTestId('overlay')).toHaveTextContent(
        'task:aaaaaaaa-0000-0000-0000-000000000001:returnTo=mistakes:count=2',
      ),
    );
  });

  it('never opens a task and shows an honest empty-state toast when there are no same-number candidates', async () => {
    vi.mocked(api.getSimilarTasks).mockResolvedValue([]);
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText(apiMistakes[0]!.conditionMd);

    await user.click(screen.getAllByRole('button', { name: 'Решить похожее' })[0]!);

    expect(await screen.findByText('Похожих заданий этого номера пока нет.')).toBeInTheDocument();
    expect(screen.getByTestId('overlay')).toHaveTextContent('none');
  });

  it('disables the button while the request is in flight, guarding against a double tap', async () => {
    let resolveSimilar!: (items: Awaited<ReturnType<typeof api.getSimilarTasks>>) => void;
    vi.mocked(api.getSimilarTasks).mockReturnValue(
      new Promise((resolve) => {
        resolveSimilar = resolve;
      }),
    );
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText(apiMistakes[0]!.conditionMd);

    const button = screen.getAllByRole('button', { name: 'Решить похожее' })[0]!;
    await user.click(button);
    expect(button).toBeDisabled();

    resolveSimilar([{ taskId: 'aaaaaaaa-0000-0000-0000-000000000001', taskNumber: 15, score: 80 }]);
    await waitFor(() => expect(screen.getByTestId('overlay')).toHaveTextContent('task:'));
    expect(api.getSimilarTasks).toHaveBeenCalledTimes(1);
  });
});
