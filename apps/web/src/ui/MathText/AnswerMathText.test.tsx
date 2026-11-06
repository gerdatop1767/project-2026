import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnswerMathText, InlineMathText } from './MathText.js';

const UNION = '$a\\in(-\\infty;-3)\\cup(-3;-1)\\cup(1;3)\\cup(3;+\\infty)$';

describe('AnswerMathText', () => {
  it('renders a long answer as several whole formulas the line may wrap between', () => {
    const { container } = render(<AnswerMathText text={UNION} />);
    expect(container.querySelectorAll('.katex')).toHaveLength(4);
    // Same symbols as one formula: four intervals, three unions.
    expect(container.querySelectorAll('.katex-mathml annotation')).toHaveLength(4);
    const tex = [...container.querySelectorAll('.katex-mathml annotation')]
      .map((a) => a.textContent)
      .join('');
    expect(tex.replace(/\{\}/g, '')).toBe(UNION.slice(1, -1));
  });

  it('leaves short answers, and everything that is not an answer, as one formula', () => {
    expect(
      render(<AnswerMathText text="$6-3\\sqrt2$" />).container.querySelectorAll('.katex'),
    ).toHaveLength(1);
    expect(
      render(<InlineMathText text={UNION} />).container.querySelectorAll('.katex'),
    ).toHaveLength(1);
  });
});
