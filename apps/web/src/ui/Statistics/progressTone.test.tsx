import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { progressStatusLabel, progressTone } from './progressTone.js';
import { TaskNumberBars } from './TaskNumberBars.js';
import { TaskNumberGrid } from './TaskNumberGrid.js';

const row = (percent: number | null, completed?: number, total?: number) => ({
  number: 1,
  percent,
  status: 'medium' as const,
  completed,
  total,
});

describe('progressTone', () => {
  it('nothing solved is neutral, every task solved is done, a sliver is low, the rest partial', () => {
    expect(progressTone(row(null, 0, 10))).toBe('empty');
    expect(progressTone(row(0, 0, 10))).toBe('empty');
    expect(progressTone(row(10, 1, 10))).toBe('low');
    expect(progressTone(row(50, 5, 10))).toBe('partial');
    expect(progressTone(row(100, 10, 10))).toBe('done');
    expect(progressStatusLabel(row(100, 10, 10))).toBe('Решено');
    expect(progressStatusLabel(row(null, 0, 10))).toBe('Не решалось');
    expect(progressStatusLabel(row(50, 5, 10))).toBe('50%');
  });
});

describe('TaskNumberBars — liquid columns', () => {
  it('fills each column exactly to its real percent, and leaves a 0% column empty', () => {
    const { container } = render(
      <TaskNumberBars
        rows={[
          { number: 1, percent: 100, status: 'strong', completed: 4, total: 4 },
          { number: 2, percent: 30, status: 'weak', completed: 3, total: 10 },
          { number: 3, percent: null, status: 'untried', completed: 0, total: 10 },
        ]}
        activeNumber={2}
      />,
    );
    const cols = [...container.querySelectorAll<HTMLElement>('[data-tone]')];
    expect(cols.map((c) => c.dataset.tone)).toEqual(['done', 'partial', 'empty']);
    expect(cols.map((c) => c.style.getPropertyValue('--level'))).toEqual(['0%', '70%', '100%']);
    // No liquid (and so no wave) where nothing is solved.
    expect(cols[2]!.querySelector('svg')).toBeNull();
    // Selection is its own mark, not a tone.
    expect(screen.getByRole('listitem', { name: /Задание 2/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(cols[1]!.dataset.tone).toBe('partial');
  });
});

describe('TaskNumberGrid — cards', () => {
  it('shows the honest status, the real count, a check for a finished number, and marks the active one', () => {
    const { container } = render(
      <TaskNumberGrid
        rows={[
          { number: 1, percent: 100, status: 'strong', completed: 10, total: 10 },
          { number: 2, percent: 10, status: 'weak', completed: 1, total: 10 },
          { number: 3, percent: null, status: 'untried', completed: 0, total: 10 },
        ]}
        activeNumber={2}
      />,
    );
    expect(screen.getByText('Решено')).toBeInTheDocument();
    expect(screen.getByText('10%')).toBeInTheDocument();
    expect(screen.getByText('Не решалось')).toBeInTheDocument();
    expect(screen.getByText('1 из 10')).toBeInTheDocument();
    const cards = [...container.querySelectorAll<HTMLElement>('[data-tone]')];
    expect(cards.map((c) => c.dataset.tone)).toEqual(['done', 'low', 'empty']);
    expect(cards[1]).toHaveAttribute('aria-current', 'true');
    expect(cards[1]!.style.getPropertyValue('--p')).toBe('10');
    expect(cards[2]!.style.getPropertyValue('--p')).toBe('0');
  });
});
