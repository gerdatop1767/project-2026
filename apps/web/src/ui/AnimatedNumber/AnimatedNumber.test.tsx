import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { AnimatedNumber } from './AnimatedNumber.js';

describe('AnimatedNumber', () => {
  it('reads as the final value straight away — for screen readers, copy and tests — whatever the figure is doing', () => {
    render(<AnimatedNumber value="1 234+" />);
    expect(screen.getByText('1 234+')).toBeInTheDocument();
  });

  it('draws its figures in an aria-hidden layer that carries no text of its own', () => {
    const { container } = render(<AnimatedNumber value="70%" />);
    const visual = container.querySelector('[aria-hidden="true"]')!;
    expect(visual.textContent).toBe('');
    expect(container.textContent).toBe('70%');
  });

  it('reserves the final width: the invisible sizer always holds the final value', () => {
    const { container } = render(<AnimatedNumber value="1 234+" />);
    const texts = [...container.querySelectorAll('[data-text]')].map((n) =>
      n.getAttribute('data-text'),
    );
    expect(texts[0]).toBe('1 234+');
  });

  it('formats a plain number in ru-RU', () => {
    const { container } = render(<AnimatedNumber value={12345} />);
    // Exact text: ru-RU groups with a non-breaking space, which getByText would normalise away.
    expect(container.textContent).toBe((12345).toLocaleString('ru-RU'));
  });

  it('shows a placeholder or text without a whole number exactly as given, never counting', () => {
    const { container } = render(<AnimatedNumber value="···" />);
    expect(screen.getByText('···')).toBeInTheDocument();
    expect(container.querySelector('[data-counting]')).toBeNull();
  });

  it('is shown at once where it cannot animate (no IntersectionObserver here)', () => {
    const { container } = render(<AnimatedNumber value="94+" />);
    expect(container.querySelector('[data-counting]')).toBeNull();
    expect(container.querySelectorAll('[data-text="94+"]')).toHaveLength(2);
  });
});

describe('AnimatedNumber — count-up', () => {
  it('counts up through the whole numbers to the real value in about half a second, keeping "%"', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
        observe() {
          this.cb([{ isIntersecting: true }]);
        }
        disconnect() {}
      },
    );
    try {
      const { container } = render(<AnimatedNumber value="70%" />);
      const figure = () => container.querySelectorAll('[data-text]')[1]!.getAttribute('data-text');
      const seen = new Set<string>();
      for (let i = 0; i < 50; i += 1) {
        await act(async () => {
          vi.advanceTimersByTime(16);
        });
        seen.add(figure()!);
      }
      // It passed through intermediate whole numbers, never decimals…
      expect([...seen].some((v) => v !== '70%' && /^\d+%$/.test(v))).toBe(true);
      expect([...seen].every((v) => /^\d+%$/.test(v))).toBe(true);
      // …and finished on the real value well within a second.
      expect(figure()).toBe('70%');
      expect(container.querySelector('[data-counting]')).toBeNull();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
