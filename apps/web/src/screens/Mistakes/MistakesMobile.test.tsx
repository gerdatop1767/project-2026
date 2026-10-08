import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MistakesMobile } from './MistakesMobile.js';
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
    taskNumber: 17,
    topicName: 'Параметры',
    conditionMd: 'Найдите все значения параметра a',
    userAnswer: '0',
    correctAnswer: '1',
    timesWrong: 1,
    status: 'open' as const,
    createdAt: '2026-09-26T00:00:00.000Z',
    updatedAt: '2026-09-26T00:00:00.000Z',
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
        <MistakesMobile />
        <OverlayMarker />
      </ToastProvider>
    </NavigationProvider>,
  );
}

describe('MistakesMobile', () => {
  it('fetches real mistakes and shows the unsolved one in "Повторить ошибки"', async () => {
    vi.mocked(api.getMistakes).mockResolvedValue(apiMistakes);
    renderScreen();
    expect(await screen.findByText(apiMistakes[0]!.conditionMd)).toBeInTheDocument();
  });

  it('shows the resolved-all state once every mistake is resolved', async () => {
    vi.mocked(api.getMistakes).mockResolvedValue([
      { ...apiMistakes[0]!, status: 'resolved' as const },
    ]);
    renderScreen();
    expect(await screen.findByText('Все ошибки разобраны!')).toBeInTheDocument();
  });

  it('opens the real task when a mistake is tapped', async () => {
    vi.mocked(api.getMistakes).mockResolvedValue(apiMistakes);
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText(apiMistakes[0]!.conditionMd);
    await user.click(screen.getByText(apiMistakes[0]!.conditionMd));
    expect(screen.getByTestId('overlay')).toHaveTextContent('task');
  });

  it('opens the task with a returnTo back to Mistakes (audit Block 3)', async () => {
    vi.mocked(api.getMistakes).mockResolvedValue(apiMistakes);
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText(apiMistakes[0]!.conditionMd);
    await user.click(screen.getByText(apiMistakes[0]!.conditionMd));
    expect(screen.getByTestId('overlay')).toHaveTextContent('returnTo=mistakes');
  });

  it('groups the real mistakes by task number, with the number as the group header', async () => {
    vi.mocked(api.getMistakes).mockResolvedValue(apiMistakes);
    renderScreen();
    await screen.findByText(apiMistakes[0]!.conditionMd);
    expect(screen.getByRole('button', { name: /№15/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /№17/ })).toBeInTheDocument();
  });

  it('collapses and re-expands a task-number group without losing the real mistake', async () => {
    vi.mocked(api.getMistakes).mockResolvedValue(apiMistakes);
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText(apiMistakes[0]!.conditionMd);
    const group15Header = screen.getByRole('button', { name: /№15/ });
    expect(group15Header).toHaveAttribute('aria-expanded', 'true');
    await user.click(group15Header);
    expect(group15Header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(apiMistakes[0]!.conditionMd)).not.toBeInTheDocument();
    // The other group (№17) stays untouched and visible.
    expect(screen.getByText(apiMistakes[1]!.conditionMd)).toBeInTheDocument();
    await user.click(group15Header);
    expect(await screen.findByText(apiMistakes[0]!.conditionMd)).toBeInTheDocument();
  });
});

describe('MistakesMobile — "Решить похожее" (deterministic similarity engine)', () => {
  it('on a real candidate list, opens the first similar task carrying the whole list as customOrderedTasks', async () => {
    vi.mocked(api.getMistakes).mockResolvedValue(apiMistakes);
    vi.mocked(api.getSimilarTasks).mockResolvedValue([
      { taskId: 'aaaaaaaa-0000-0000-0000-000000000001', taskNumber: 15, score: 80 },
      { taskId: 'bbbbbbbb-0000-0000-0000-000000000002', taskNumber: 14, score: 60 },
    ]);
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText(apiMistakes[0]!.conditionMd);

    await user.click(screen.getAllByRole('button', { name: 'Решить похожее' })[0]!);

    expect(api.getSimilarTasks).toHaveBeenCalledWith(apiMistakes[0]!.taskId);
    await waitFor(() =>
      expect(screen.getByTestId('overlay')).toHaveTextContent(
        'task:aaaaaaaa-0000-0000-0000-000000000001:returnTo=mistakes:count=2',
      ),
    );
  });

  it('never opens a task and shows an honest empty-state toast when there are no similar candidates', async () => {
    vi.mocked(api.getMistakes).mockResolvedValue(apiMistakes);
    vi.mocked(api.getSimilarTasks).mockResolvedValue([]);
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText(apiMistakes[0]!.conditionMd);

    await user.click(screen.getAllByRole('button', { name: 'Решить похожее' })[0]!);

    expect(await screen.findByText('Похожих заданий этого номера пока нет.')).toBeInTheDocument();
    expect(screen.getByTestId('overlay')).toHaveTextContent('none');
  });

  it('disables the button while the request is in flight, guarding against a double tap', async () => {
    vi.mocked(api.getMistakes).mockResolvedValue(apiMistakes);
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
