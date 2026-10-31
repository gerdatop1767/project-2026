import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataTable, Kpi, Sparkline } from './ui.js';

describe('admin ui primitives', () => {
  it('a sparkline needs ≥3 real points with some movement, else nothing is drawn', () => {
    const { container, rerender } = render(<Sparkline values={[1, 4, 2]} />);
    expect(container.querySelector('polyline')).not.toBeNull();
    rerender(<Sparkline values={[0, 0, 0, 0]} />);
    expect(container.querySelector('svg')).toBeNull();
    rerender(<Sparkline values={[5, 7]} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('an unknown KPI value is «Недостаточно данных», never 0', () => {
    render(<Kpi label="Гости" value={null} />);
    expect(screen.getByText('Недостаточно данных')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('table cells carry their column label (phone card layout) and sort has a select too', () => {
    const { container } = render(
      <DataTable
        caption="t"
        columns={[
          { key: 'name', label: 'Имя' },
          { key: 'n', label: 'Решений', numeric: true, sort: 'solves' },
        ]}
        rows={[{ id: 'a', name: 'Анна', n: 3 }]}
        rowKey={(r) => String(r.id)}
        sort="solves"
        dir="desc"
        onSort={() => undefined}
      />,
    );
    expect(container.querySelector('td[data-label="Решений"]')).toHaveTextContent('3');
    expect(screen.getByRole('combobox')).toHaveValue('solves');
  });
});
