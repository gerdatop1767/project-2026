import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { TheoryMarkdown, parseMarkdown } from './TheoryMarkdown.js';

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
