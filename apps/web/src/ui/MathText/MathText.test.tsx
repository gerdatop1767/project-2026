import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InlineMathText, MathText } from './MathText.js';

describe('MathText / InlineMathText — real KaTeX typography', () => {
  it('renders a $...$ span as KaTeX, not plain text', () => {
    render(<InlineMathText text="Найдите $\dfrac{a}{b}$." />);
    expect(document.querySelector('.katex')).toBeInTheDocument();
  });

  it('renders plain text unchanged when there is no $...$ span', () => {
    render(<InlineMathText text="Обычный текст без формул." />);
    expect(screen.getByText('Обычный текст без формул.')).toBeInTheDocument();
    expect(document.querySelector('.katex')).not.toBeInTheDocument();
  });

  it('MathText splits blank-line-separated paragraphs into separate <p> blocks', () => {
    const { container } = render(<MathText text={'Шаг 1.\n\nШаг 2.'} />);
    expect(container.querySelectorAll('p')).toHaveLength(2);
  });
});

describe('MathText — separateInstruction (instruction-to-condition spacing, task readability)', () => {
  it('without separateInstruction, no paragraph gets the instruction-gap class', () => {
    const { container } = render(
      <MathText text={'Запишите номера ответов.\n\n1) первое\n\n2) второе'} />,
    );
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(3);
    paragraphs.forEach((p) => expect(p.className).toBe(''));
  });

  it('with separateInstruction and more than one paragraph, only the first paragraph gets the gap class', () => {
    const { container } = render(
      <MathText text={'Запишите номера ответов.\n\n1) первое\n\n2) второе'} separateInstruction />,
    );
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]!.className).not.toBe('');
    expect(paragraphs[1]!.className).toBe('');
    expect(paragraphs[2]!.className).toBe('');
  });

  it('with separateInstruction but only a single paragraph, no gap is added (nothing to separate from)', () => {
    const { container } = render(
      <MathText
        text="Самостоятельно подберите союз, который должен стоять на месте пропуска."
        separateInstruction
      />,
    );
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]!.className).toBe('');
  });

  it('separateInstruction composes with a passed className — both apply to the instruction paragraph, only the className applies to the rest', () => {
    const { container } = render(
      <MathText
        text={'Инструкция.\n\nОсновной текст.'}
        className="text-task"
        separateInstruction
      />,
    );
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs[0]!.classList.contains('text-task')).toBe(true);
    expect(paragraphs[1]!.classList.contains('text-task')).toBe(true);
    expect(paragraphs[1]!.className).toBe('text-task');
  });
});

describe('KatexSpan — scroll affordance for oversized formulas (EGE Fidelity Final Polish, Block 2)', () => {
  it('wraps every formula in a scroll-cue wrapper with data-scrollable state', () => {
    render(<InlineMathText text="$x^2$" />);
    const wrap = document.querySelector('[data-scrollable]');
    expect(wrap).toBeInTheDocument();
    // jsdom never actually lays out content, so scrollWidth === clientWidth
    // (both 0) — this formula reports as not overflowing, same as any
    // formula that genuinely fits its box in a real browser.
    expect(wrap).toHaveAttribute('data-scrollable', 'false');
  });

  it('does not throw when ResizeObserver fires/unmounts (jsdom has no real layout, so this only checks lifecycle safety)', () => {
    const { unmount } = render(<InlineMathText text="$\sqrt{15x} = 1\dfrac{2}{3}x$" />);
    expect(document.querySelector('.katex')).toBeInTheDocument();
    expect(() => unmount()).not.toThrow();
  });

  it('a $$...$$ block formula gets the block wrapper variant', () => {
    render(<MathText text="$$a^2+b^2=c^2$$" />);
    expect(document.querySelector('.katex-display')).toBeInTheDocument();
  });
});

/**
 * Full-pipeline emphasis tests — through MathText/InlineMathText's real
 * tokenizeMathText -> EmphasisLine chain, not just parseEmphasis in
 * isolation (emphasis.test.ts covers the parser alone). Confirms math
 * tokenization and emphasis parsing compose correctly and neither one
 * corrupts the other.
 */
describe('MathText — emphasis (**bold**/*italic*) composed with math and plain asterisks', () => {
  it('**bold** renders as <strong>, with the markers stripped', () => {
    render(<InlineMathText text="в тексте выделено **СТАРЫЙ**" />);
    const strong = screen.getByText('СТАРЫЙ');
    expect(strong.tagName).toBe('STRONG');
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
  });

  it('*italic* renders as <em>, with the markers stripped', () => {
    render(<InlineMathText text="*Старый пропуск.*" />);
    const em = screen.getByText('Старый пропуск.');
    expect(em.tagName).toBe('EM');
  });

  it('$x^2 + 1$ still renders as real KaTeX, unaffected by emphasis parsing', () => {
    render(<InlineMathText text="Найдите $x^2 + 1$." />);
    // The math span itself must never be swallowed by the emphasis
    // parser — tokenizeMathText extracts it first, so the formula is
    // real KaTeX markup (superscript via <sup>-like mord structure),
    // never literal '^' text sitting next to a stray '*'.
    expect(document.querySelector('.katex')).toBeInTheDocument();
    expect(document.querySelector('.katex .mfrac, .katex .mord')).toBeInTheDocument();
    expect(screen.getByText('Найдите', { exact: false })).toBeInTheDocument();
  });

  it('a non-markdown lone asterisk (odd count, no closing pair) is left as a literal character, never swallowed or turned into emphasis', () => {
    render(<InlineMathText text="Смотри сноску * внизу страницы." />);
    expect(screen.getByText(/Смотри сноску \* внизу страницы\./)).toBeInTheDocument();
    expect(document.querySelector('strong, em')).not.toBeInTheDocument();
  });

  it('mixed line: plain text, **bold**, a $...$ formula and more plain text all render correctly together', () => {
    render(<InlineMathText text="Шаг: **умножь** на $x^2$ и запиши ответ." />);
    const strong = screen.getByText('умножь');
    expect(strong.tagName).toBe('STRONG');
    expect(document.querySelector('.katex')).toBeInTheDocument();
    expect(screen.getByText(/и запиши ответ\./)).toBeInTheDocument();
  });

  it('KNOWN LIMITATION: a **bold** span that straddles a $...$ math boundary is NOT recognized (each half keeps its literal **) — tokenizeMathText splits text/math first, so emphasis parsing never sees the pair together; verified not to occur in any current imported content (no condition/explanation opens a bold span before a formula and closes it after)', () => {
    render(<InlineMathText text="**жирный $x$ текст**" />);
    expect(screen.getByText(/\*\*жирный/)).toBeInTheDocument();
    expect(screen.getByText(/текст\*\*/)).toBeInTheDocument();
    expect(document.querySelector('strong')).not.toBeInTheDocument();
  });

  it('a passage/condition paragraph with both bold emphasis and a formula renders as one coherent paragraph (MathText, not InlineMathText)', () => {
    const { container } = render(
      <MathText text="Решите уравнение $2x = 4$, где **x** — искомое число." />,
    );
    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(document.querySelector('.katex')).toBeInTheDocument();
    const strong = screen.getByText('x', { selector: 'strong' });
    expect(strong).toBeInTheDocument();
  });
});
