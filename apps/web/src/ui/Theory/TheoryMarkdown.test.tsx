import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import {
  TheoryMarkdown,
  parseMarkdown,
  splitTexAtRelations,
  type Block,
} from './TheoryMarkdown.js';

const sample = `# Задание 3. Стиль

> **Суть:** выбрать верные характеристики.

## Алгоритм
1. Определи тему.
2. Определи цель.

## Ловушки
- Не путай *стиль* и тип речи.
- [ ] пример есть в тексте;

| Стиль | Цель |
|---|---|
| **Научный** | Объяснить |

Обычный абзац с \`примером\` и <b>не HTML</b>.`;

describe('TheoryMarkdown', () => {
  it('parses headings, quote, lists, check lists and tables', () => {
    const types = parseMarkdown(sample).map((b) => b.type);
    expect(types).toEqual([
      'heading',
      'quote',
      'heading',
      'list',
      'heading',
      'list',
      'table',
      'paragraph',
    ]);
  });

  it('renders sections, tints «Ловушки», drops the file title, never renders HTML', () => {
    const { container } = render(<TheoryMarkdown source={sample} />);
    expect(screen.queryByText('Задание 3. Стиль')).not.toBeInTheDocument();
    const traps = screen.getByRole('heading', { name: 'Ловушки' }).closest('section')!;
    expect(traps).toHaveAttribute('data-tone', 'warn');
    expect(screen.getByRole('heading', { name: 'Алгоритм' }).closest('section')).toHaveAttribute(
      'data-tone',
      'steps',
    );
    expect(within(screen.getByRole('table')).getByText('Научный').tagName).toBe('STRONG');
    expect(screen.getByText('стиль').tagName).toBe('EM');
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText(/не HTML/)).toBeInTheDocument();
  });

  it('marks the stressed capital vowel without changing the text', () => {
    const { container } = render(<TheoryMarkdown source={'- тОрты\n- ФИПИ'} stress />);
    expect(container.textContent).toBe('тОртыФИПИ');
    const marked = [...container.querySelectorAll('span')].filter((s) => s.textContent === 'О');
    expect(marked).toHaveLength(1);
  });
});

describe('TheoryMarkdown — formulas, boxes and drawings', () => {
  const math = `## Ожидание

Формула $E(X) = x_1p_1$ внутри текста.

$$D(X) = E(X^2) - (E(X))^2$$

> [!mistake] Квадрат ожидания
> $E(X^2)$ и $(E(X))^2$ — разные числа.

> [!exam]
> 1. Составь таблицу.
> 2. Посчитай.

![[rv-two-coins]] Подпись к рисунку

| Выражение | Чему равно |
|---|---|
| $D(aX)$ | $a^2D(X)$ |`;

  it('parses display formulas, callouts with their own blocks and figures', () => {
    const blocks = parseMarkdown(math);
    expect(blocks.map((b) => b.type)).toEqual([
      'heading',
      'paragraph',
      'math',
      'callout',
      'callout',
      'figure',
      'table',
    ]);
    const mistake = blocks[3] as Extract<Block, { type: 'callout' }>;
    expect(mistake).toMatchObject({ kind: 'mistake', title: 'Квадрат ожидания' });
    const exam = blocks[4] as Extract<Block, { type: 'callout' }>;
    expect(exam.title).toBeNull();
    expect(exam.blocks[0]).toMatchObject({ type: 'list', ordered: true });
  });

  it('renders KaTeX for $…$ and $$…$$, a titled box, a drawing with its caption', () => {
    const { container } = render(<TheoryMarkdown source={math} />);
    expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText('Квадрат ожидания')).toBeInTheDocument();
    // A box without its own title gets the kind's default one.
    expect(screen.getByText('Как решать на ЕГЭ')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Распределение числа орлов при двух бросках монеты' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Подпись к рисунку')).toBeInTheDocument();
    // Formulas are never read as Markdown emphasis.
    expect(container.textContent).not.toContain('$');
  });

  it('an unknown drawing renders nothing rather than breaking the page', () => {
    const { container } = render(<TheoryMarkdown source={'![[no-such-figure]]'} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('a long inline formula is split after its top-level relation signs, so it can wrap', () => {
    expect(
      splitTexAtRelations('x^2 - x \\le x + 3 \\iff x^2 - 2x - 3 \\le 0 \\iff -1 \\le x \\le 3'),
    ).toEqual([
      'x^2 - x \\le',
      'x + 3 \\iff',
      'x^2 - 2x - 3 \\le',
      '0 \\iff',
      '-1 \\le',
      'x \\le',
      '3',
    ]);
    // Never inside braces, \left…\right or an environment; never on \left / \neq look-alikes.
    expect(splitTexAtRelations('\\frac{a = b}{c} = d')).toEqual(['\\frac{a = b}{c} =', 'd']);
    expect(splitTexAtRelations('\\left(x = 1\\right) \\ne 2')).toEqual([
      '\\left(x = 1\\right) \\ne',
      '2',
    ]);
    expect(splitTexAtRelations('a \\neq b')).toEqual(['a \\neq', 'b']);
    expect(splitTexAtRelations('\\begin{cases} x = 1,\\\\ y = 2\\end{cases}')).toEqual([
      '\\begin{cases} x = 1,\\\\ y = 2\\end{cases}',
    ]);
    expect(splitTexAtRelations('\\{1\\} = A')).toEqual(['\\{1\\} =', 'A']);
    // Nothing to split: one piece, unchanged.
    expect(splitTexAtRelations('\\sqrt{x + 1}')).toEqual(['\\sqrt{x + 1}']);
    expect(splitTexAtRelations('= 5')).toEqual(['= 5']);
  });

  it('renders each piece of a split formula as its own KaTeX span', () => {
    const { container } = render(<TheoryMarkdown source={'Итак, $a = b \\iff c$.'} />);
    expect(container.querySelectorAll('.katex')).toHaveLength(3);
  });
});
