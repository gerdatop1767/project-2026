import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnimatedNumber } from './AnimatedNumber.js';

describe('AnimatedNumber', () => {
  it('reads as the final value straight away — for screen readers, copy and tests — whatever the digits are doing', () => {
    render(<AnimatedNumber value="1 234+" />);
    expect(screen.getByText('1 234+')).toBeInTheDocument();
  });

  it('draws the digits in an aria-hidden layer that carries no text of its own', () => {
    const { container } = render(<AnimatedNumber value="70%" />);
    const visual = container.querySelector('[aria-hidden="true"]')!;
    expect(visual.textContent).toBe('');
    // One rolling column per digit; the "%" stays a static character.
    expect(visual.querySelectorAll('[data-digit]')).toHaveLength(2);
    expect(visual.querySelector('[data-char="%"]')).not.toBeNull();
    expect(container.textContent).toBe('70%');
  });

  it('formats a plain number in ru-RU', () => {
    const { container } = render(<AnimatedNumber value={12345} />);
    // Exact text: ru-RU groups with a non-breaking space, which getByText would normalise away.
    expect(container.textContent).toBe((12345).toLocaleString('ru-RU'));
  });

  it('shows a placeholder or text without digits exactly as given, unanimated', () => {
    const { container } = render(<AnimatedNumber value="···" />);
    expect(screen.getByText('···')).toBeInTheDocument();
    expect(container.querySelector('[data-digit]')).toBeNull();
  });

  it('lands on the real value (no IntersectionObserver here, so it is shown at once)', () => {
    const { container } = render(<AnimatedNumber value="94+" />);
    const columns = [...container.querySelectorAll<HTMLElement>('[data-digit]')];
    expect(columns.map((column) => column.style.getPropertyValue('--pos'))).toEqual(['19', '14']);
  });
});
