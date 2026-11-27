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

describe('SessionTaskListCard — instant click feedback', () => {
  it('marks the clicked number busy until it becomes the current task', async () => {
    vi.stubGlobal('scrollTo', vi.fn());
    const user = userEvent.setup();
    const tasks = variantOf27();
    const { rerender } = render(
      <SessionTaskListCard title="Задания" sessionTasks={tasks} onSelect={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Задание 12' }));
    expect(screen.getByRole('button', { name: 'Задание 12' })).toHaveAttribute('aria-busy', 'true');

    // The next task arrived: 12 is now current and no longer busy.
    const moved = tasks.map((t) => ({
      ...t,
      status:
        t.index === 12 ? ('current' as const) : t.index === 5 ? ('opened' as const) : t.status,
    }));
    rerender(<SessionTaskListCard title="Задания" sessionTasks={moved} onSelect={vi.fn()} />);
    const twelve = screen.getByRole('button', { name: 'Задание 12' });
    expect(twelve).toHaveAttribute('aria-current', 'step');
    expect(twelve).not.toHaveAttribute('aria-busy');
    vi.unstubAllGlobals();
  });
});

describe('SessionTaskListCard — long lists stay compact', () => {
  const list = (n: number, current: number): SessionTask[] =>
    Array.from({ length: n }, (_, i) => ({
      index: i + 1,
      status: i + 1 === current ? 'current' : 'pending',
    }));

  it('shows where you are: «N из M» next to the title', () => {
    render(<SessionTaskListCard title="Задания" sessionTasks={list(200, 37)} onSelect={vi.fn()} />);
    const nav = screen.getByRole('navigation', { name: 'Задания' });
    expect(nav).toHaveTextContent('37 из 200');
  });

  it('a short variant keeps a plain grid; a long list scrolls inside its own box', () => {
    const { rerender } = render(
      <SessionTaskListCard title="Задания" sessionTasks={list(27, 1)} onSelect={vi.fn()} />,
    );
    const grid = () => screen.getByRole('button', { name: 'Задание 1' }).parentElement!;
    expect(grid().className).not.toMatch(/scroll/);
    rerender(
      <SessionTaskListCard title="Задания" sessionTasks={list(200, 1)} onSelect={vi.fn()} />,
    );
    expect(grid().className).toMatch(/scroll/);
    expect(screen.getAllByRole('button')).toHaveLength(200);
  });

  it('keeps the current number in the grid’s own view, never scrolling the page', () => {
    const scrollTo = vi.fn();
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
    const proto = HTMLElement.prototype;
    const offsetTop = Object.getOwnPropertyDescriptor(proto, 'offsetTop');
    const offsetHeight = Object.getOwnPropertyDescriptor(proto, 'offsetHeight');
    const clientHeight = Object.getOwnPropertyDescriptor(proto, 'clientHeight');
    Object.defineProperty(proto, 'offsetHeight', { configurable: true, get: () => 36 });
    Object.defineProperty(proto, 'clientHeight', { configurable: true, get: () => 250 });
    Object.defineProperty(proto, 'offsetTop', {
      configurable: true,
      get(this: HTMLElement) {
        const n = Number(this.textContent);
        return Number.isFinite(n) ? Math.floor((n - 1) / 7) * 42 : 0;
      },
    });
    try {
      render(
        <SessionTaskListCard title="Задания" sessionTasks={list(200, 150)} onSelect={vi.fn()} />,
      );
      const grid = screen.getByRole('button', { name: 'Задание 150' }).parentElement!;
      // Row 21 (offset 882) centred in a 250px box.
      expect(grid.scrollTop).toBe(882 - (250 - 36) / 2);
      expect(scrollTo).not.toHaveBeenCalled();
    } finally {
      if (offsetTop) Object.defineProperty(proto, 'offsetTop', offsetTop);
      if (offsetHeight) Object.defineProperty(proto, 'offsetHeight', offsetHeight);
      if (clientHeight) Object.defineProperty(proto, 'clientHeight', clientHeight);
    }
  });

  it('the sheet variant leaves the title to its sheet', () => {
    render(
      <SessionTaskListCard
        variant="sheet"
        title="Все задания"
        sessionTasks={list(60, 3)}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole('navigation', { name: 'Все задания' })).not.toHaveTextContent('из 60');
  });
});
