import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionTask } from '../../data/sampleTask.js';
import { SessionTaskListCard } from './SessionTaskListCard.js';

const STATUSES: SessionTask['status'][] = ['correct', 'incorrect', 'draft', 'opened', 'current'];

function variantOf27(): SessionTask[] {
  return Array.from({ length: 27 }, (_, i) => ({
    index: i + 1,
    status: STATUSES[i] ?? 'pending',
  }));
}

describe('SessionTaskListCard — compact task-number grid', () => {
  it('renders all 27 numbers as one navigation grid with state in the accessible name', () => {
    render(<SessionTaskListCard title="Задания" sessionTasks={variantOf27()} onSelect={vi.fn()} />);
    const nav = screen.getByRole('navigation', { name: 'Задания' });
    expect(nav.querySelectorAll('button')).toHaveLength(27);
    expect(screen.getByRole('button', { name: 'Задание 1 — верно' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Задание 2 — неверно' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Задание 3 — есть ответ, не проверен' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Задание 4 — пропущено' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Задание 5' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    expect(screen.getByRole('button', { name: 'Задание 27' })).not.toHaveAttribute('aria-current');
  });

  it('shows a legend only for the states that occur', () => {
    const { rerender } = render(
      <SessionTaskListCard
        title="Задания"
        sessionTasks={[
          { index: 1, status: 'current' },
          { index: 2, status: 'pending' },
        ]}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByText('Верно')).not.toBeInTheDocument();

    rerender(
      <SessionTaskListCard title="Задания" sessionTasks={variantOf27()} onSelect={vi.fn()} />,
    );
    for (const label of ['Верно', 'Ошибка', 'Есть ответ', 'Пропущено']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('opens a task in one click and scrolls the page back to the task top', async () => {
    const onSelect = vi.fn();
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    const user = userEvent.setup();
    render(
      <SessionTaskListCard title="Задания" sessionTasks={variantOf27()} onSelect={onSelect} />,
    );

    await user.click(screen.getByRole('button', { name: 'Задание 19' }));
    expect(onSelect).toHaveBeenCalledWith(19);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));

    // Re-selecting the current task changes nothing on the page.
    scrollTo.mockClear();
    await user.click(screen.getByRole('button', { name: 'Задание 5' }));
    expect(scrollTo).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
