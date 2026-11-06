import { describe, expect, it } from 'vitest';
import { bindPlainFormulas, parseSolution } from './solutionBlocks.js';

const WJ = '\u2060';
const unbind = (s: string) => s.replaceAll(WJ, '');

const SOLUTION = [
  'Что дано: система с параметром a; второе уравнение содержит √a, значит a≥0.',
  'Идея: выразить y из второго уравнения.',
  'Шаг 1. y=6√a−1. Раскрываем (y−4a)(y+4a)=y²−16a².',
  'Шаг 3 (проверка). При a=0 получаем одно решение.',
  'ОДЗ: 15x ≥ 0.',
  'Обычный абзац без метки.\nВторая строка.',
  'Ответ: a=36/25 или a∈(√13−2; 4).',
].join('\n\n');

describe('parseSolution', () => {
  it('splits paragraphs and recognises only the labels the content uses, kept exactly', () => {
    const blocks = parseSolution(SOLUTION);
    expect(blocks.map((b) => [b.kind, b.label])).toEqual([
      ['given', 'Что дано:'],
      ['idea', 'Идея:'],
      ['step', 'Шаг 1.'],
      ['step', 'Шаг 3 (проверка).'],
      ['note', 'ОДЗ:'],
      ['text', null],
      ['answer', 'Ответ:'],
    ]);
    expect(blocks[5]!.body).toBe('Обычный абзац без метки.\nВторая строка.');
  });

  it('label + body is exactly the paragraph (nothing reworded)', () => {
    for (const [i, paragraph] of SOLUTION.split('\n\n').entries()) {
      const b = parseSolution(SOLUTION)[i]!;
      expect(b.label ? `${b.label} ${b.body}` : b.body).toBe(paragraph);
    }
  });

  it('bold labels, and words that only look like labels', () => {
    expect(parseSolution('**Шаг 2.** Заменяем.')[0]).toMatchObject({
      kind: 'step',
      label: 'Шаг 2.',
    });
    expect(parseSolution('Шагаем дальше: нет.')[0]!.kind).toBe('text');
    expect(parseSolution('Ответ:')[0]!.kind).toBe('text'); // a label with nothing after it
    expect(parseSolution('Ответ (подтверждённый): 5.')[0]).toMatchObject({ kind: 'answer' });
  });
});

describe('bindPlainFormulas', () => {
  it('keeps a plain-text formula in one piece, invisibly', () => {
    const out = bindPlainFormulas('получаем (|x|−a²)² = 25a²−36a, где');
    expect(unbind(out)).toBe('получаем (|x|−a²)² = 25a²−36a, где');
    expect(out).toContain(['(', '|', 'x', '|', '−', 'a', '²', ')', '²'].join(WJ));
    // Spaces between formula parts and words stay break points.
    expect(out.split(' ')).toHaveLength(5);
  });

  it('leaves prose, LaTeX and emphasis markers alone', () => {
    expect(bindPlainFormulas('существительным/количественным')).toBe(
      'существительным/количественным',
    );
    expect(bindPlainFormulas('по-русски')).toBe('по-русски');
    expect(bindPlainFormulas('$\\dfrac{a}{b}=c$ и x=1')).toMatch(
      /^\$\\dfrac\{a\}\{b\}=c\$ и x\u2060=\u20601$/,
    );
    const bold = bindPlainFormulas('**x=2** далее');
    expect(bold.startsWith('**')).toBe(true);
    expect(bold).toContain(`x${WJ}=${WJ}2**`);
  });
});
