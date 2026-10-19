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
    // One glyph per character, in order, each at its final place.
    expect(
      [...visual.querySelectorAll('[data-char]')].map((g) => g.getAttribute('data-char')),
    ).toEqual(['7', '0', '%']);
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
    expect(container.querySelector('[style*="--i"]')).toBeNull();
  });

  it('is shown at once where it cannot animate (no IntersectionObserver here)', () => {
    const { container } = render(<AnimatedNumber value="94+" />);
    expect(container.querySelector('[data-animated-number]')).toHaveAttribute('data-revealed');
  });
});
