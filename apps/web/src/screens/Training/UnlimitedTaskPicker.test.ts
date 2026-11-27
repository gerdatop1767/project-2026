import { describe, expect, it } from 'vitest';
import { conditionPreview } from './UnlimitedTaskPicker.js';

describe('conditionPreview — a list row’s first words', () => {
  it('drops markdown, keeps short formulas as text, cuts long ones', () => {
    expect(conditionPreview('**Найдите** все значения $a$, при которых $x^2 = a$.')).toBe(
      'Найдите все значения a, при которых x^2 = a.',
    );
    expect(
      conditionPreview('Вычислите $\\frac{\\sqrt{12}\\cdot\\sqrt{3}}{\\sqrt{25}+\\sqrt{16}}$.'),
    ).toBe('Вычислите ….');
  });

  it('long conditions end with an ellipsis', () => {
    const text = conditionPreview('слово '.repeat(40), 30);
    expect(text.length).toBeLessThanOrEqual(31);
    expect(text.endsWith('…')).toBe(true);
  });
});
