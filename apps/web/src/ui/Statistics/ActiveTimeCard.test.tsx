import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActiveTimeView, activeTime } from './ActiveTimeCard.js';

describe('Время на платформе', () => {
  it('today, 7 and 30 days, all time — real zeros as «0 мин»', () => {
    render(
      <ActiveTimeView
        data={{
          todaySeconds: 0,
          last7Seconds: 1500,
          last30Seconds: 7260,
          allSeconds: 90_000,
          activeDays: 9,
          days: Array.from({ length: 30 }, (_, i) => ({
            date: `2026-11-${String(i + 1).padStart(2, '0')}`,
            seconds: i * 60,
          })),
        }}
      />,
    );
    const terms = screen.getAllByRole('term').map((t) => t.textContent);
    const values = screen.getAllByRole('definition').map((d) => d.textContent);
    expect(terms).toEqual(['Сегодня', '7 дней', '30 дней', 'Всё время']);
    expect(values).toEqual(['0 мин', '25 мин', '2 ч 1 мин', '25 ч 0 мин']);
    expect(screen.getByRole('group', { name: /Активное время по дням/ })).toBeInTheDocument();
    expect(screen.getByText(/Вкладка без действий/)).toBeInTheDocument();
  });

  it('a failed load shows dashes, never zeros', () => {
    render(<ActiveTimeView data={null} />);
    expect(screen.getAllByRole('definition').map((d) => d.textContent)).toEqual([
      '—',
      '—',
      '—',
      '—',
    ]);
    expect(activeTime(30)).toBe('30 с');
  });
});
