import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BarChart } from './BarChart.js';
import { LineChart } from './LineChart.js';
import { DonutChart } from './DonutChart.js';
import { RankedBarList } from './RankedBarList.js';

describe('BarChart', () => {
  it('renders one bar per point', () => {
    const { container } = render(
      <BarChart
        points={[
          { label: 'Пн', value: 4 },
          { label: 'Вт', value: 8 },
        ]}
      />,
    );
    expect(container.querySelectorAll('[title]')).toHaveLength(2);
    expect(screen.getByText('Пн')).toBeInTheDocument();
  });

  const days = [
    { label: '1', value: 0, tooltip: { title: 'пн, 1 сентября', value: 'Ничего не решено' } },
    { label: '2', value: 5, tooltip: { title: 'вт, 2 сентября', value: 'Решено 5 заданий' } },
    { label: '3', value: 2, tooltip: { title: 'ср, 3 сентября', value: 'Решено 2 задания' } },
  ];

  function stubWidth(el: Element, width = 300) {
    el.getBoundingClientRect = () =>
      ({ left: 0, width, top: 0, height: 100, right: width, bottom: 100 }) as DOMRect;
  }

  it('a tap picks the nearest day and shows its exact count; a second tap closes it', () => {
    render(<BarChart points={days} ariaLabel="Решено" />);
    const chart = screen.getByRole('group');
    stubWidth(chart);
    fireEvent.pointerDown(chart, { clientX: 150, pointerType: 'touch' }); // middle third → day 2
    expect(screen.getAllByText('Решено 5 заданий')[0]).toBeInTheDocument();
    expect(screen.getByText(/вт, 2 сентября, Решено 5 заданий/)).toHaveAttribute(
      'aria-live',
      'polite',
    );
    fireEvent.pointerDown(chart, { clientX: 150, pointerType: 'touch' });
    expect(screen.queryByText('Решено 5 заданий')).not.toBeInTheDocument();
  });

  it('is usable from the keyboard: ←/→ move between days, Esc closes', async () => {
    const user = userEvent.setup();
    render(<BarChart points={days} />);
    screen.getByRole('group').focus();
    await user.keyboard('{End}');
    expect(screen.getAllByText('Решено 2 задания')[0]).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getAllByText('Решено 5 заданий')[0]).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByText('Решено 5 заданий')).not.toBeInTheDocument();
  });
});

describe('LineChart', () => {
  it('renders a dot per point', () => {
    const { container } = render(
      <LineChart
        points={[
          { label: '1 сен', value: 40 },
          { label: '2 сен', value: 60 },
        ]}
      />,
    );
    // Round HTML markers over the stretched SVG (SVG circles became ellipses).
    expect(container.querySelectorAll('[class*="dot"]')).toHaveLength(2);
  });

  it('a tap snaps to the nearest point and shows its exact percent and basis', () => {
    render(
      <LineChart
        points={[
          {
            label: '1',
            value: 40,
            tooltip: { title: 'пн', value: '40% правильных ответов', detail: 'по 5 заданиям' },
          },
          { label: '2', value: 0, tooltip: { title: 'вт', value: 'Нет решённых заданий' } },
        ]}
      />,
    );
    const chart = screen.getByRole('group');
    chart.getBoundingClientRect = () =>
      ({ left: 0, width: 200, top: 0, height: 100, right: 200, bottom: 100 }) as DOMRect;
    fireEvent.pointerDown(chart, { clientX: 20, pointerType: 'touch' });
    expect(screen.getAllByText('40% правильных ответов')[0]).toBeInTheDocument();
    expect(screen.getAllByText('по 5 заданиям')[0]).toBeInTheDocument();
    fireEvent.pointerDown(chart, { clientX: 190, pointerType: 'touch' });
    expect(screen.getAllByText('Нет решённых заданий')[0]).toBeInTheDocument();
  });
});

describe('DonutChart', () => {
  it('renders a legend row per segment', () => {
    render(
      <DonutChart
        ariaLabel="Распределение по темам"
        segments={[
          { label: 'Неравенства', value: 7, percent: 29, color: 'var(--chart-1)' },
          { label: 'Функции', value: 5, percent: 21, color: 'var(--chart-2)' },
        ]}
      />,
    );
    expect(screen.getByText('Неравенства')).toBeInTheDocument();
    expect(screen.getByText('29%')).toBeInTheDocument();
  });
});

describe('RankedBarList', () => {
  it('numbers rows in order', () => {
    render(
      <RankedBarList
        items={[
          { label: 'Стереометрия', value: 42, color: 'var(--color-error)' },
          { label: 'Вероятность', value: 38, color: 'var(--chart-3)' },
        ]}
      />,
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('1');
    expect(rows[0]).toHaveTextContent('Стереометрия');
    expect(rows[1]).toHaveTextContent('2');
  });
});
