import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MathText } from '../MathText/MathText.js';
import { SolutionText } from './SolutionText.js';

const TEXT = [
  'Что дано: уравнение $\\sqrt{15x}=\\dfrac53x$.',
  'Шаг 1. ОДЗ: $x\\ge0$.',
  'Шаг 2. Возводим в квадрат:\n$$15x=\\dfrac{25}{9}x^2$$',
  'Отсюда x = 0 или x = 5.4.',
  'Ответ: $5{,}4$.',
].join('\n\n');

describe('SolutionText', () => {
  it('one block per paragraph: steps with their label, the answer highlighted, display formulas kept', () => {
    const { container } = render(<SolutionText text={TEXT} />);
    const kinds = [...container.querySelectorAll('[data-block]')].map((b) =>
      b.getAttribute('data-block'),
    );
    expect(kinds).toEqual(['given', 'step', 'step', 'text', 'answer']);
    expect(container.querySelectorAll('[data-block="step"] p')[0]).toHaveTextContent('Шаг 1.');
    expect(container.querySelector('.katex-display')).not.toBeNull();
    expect(container.querySelector('[data-block="answer"]')).toHaveTextContent(/^Ответ:/);
  });

  it('shows exactly the same text as before — only the layout changed', () => {
    const now = render(<SolutionText text={TEXT} />).container.textContent!;
    const before = render(<MathText text={TEXT} />).container.textContent!;
    const norm = (s: string) => s.replace(/\u2060/g, '').replace(/\s+/g, '');
    expect(norm(now)).toBe(norm(before));
  });
});
