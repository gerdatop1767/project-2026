import katex from 'katex';
import { describe, expect, it } from 'vitest';
import { splitFormulaAtTopLevel, wrapAnswerMath } from './answerWrapping.js';

describe('answer formulas: breakable between top-level items, never inside one', () => {
  it('cuts before each top-level union', () => {
    expect(splitFormulaAtTopLevel('a\\in(-\\infty;-3)\\cup(-3;-1)\\cup(1;3)')).toEqual([
      'a\\in(-\\infty;-3)',
      '\\cup(-3;-1)',
      '\\cup(1;3)',
    ]);
  });

  it('keeps \\left…\\right, half-open intervals and fractions whole', () => {
    expect(
      splitFormulaAtTopLevel(
        'x\\in\\left[-\\dfrac{\\sqrt3}9;\\,0\\right)\\cup\\left(0;\\,\\dfrac{\\sqrt3}9\\right]',
      ),
    ).toEqual([
      'x\\in\\left[-\\dfrac{\\sqrt3}9;\\,0\\right)',
      '\\cup\\left(0;\\,\\dfrac{\\sqrt3}9\\right]',
    ]);
    expect(splitFormulaAtTopLevel('(2;5]\\cup[7;8)')).toEqual(['(2;5]', '\\cup[7;8)']);
    expect(splitFormulaAtTopLevel('\\dfrac{a;b}{c,d}')).toEqual(['\\dfrac{a;b}{c,d}']);
  });

  it('cuts after top-level list separators, keeping them with the left item', () => {
    expect(splitFormulaAtTopLevel('a\\in(-3;0),\\ a\\neq\\dfrac{-5-\\sqrt{13}}{6}')).toEqual([
      'a\\in(-3;0),',
      'a\\neq\\dfrac{-5-\\sqrt{13}}{6}',
    ]);
    expect(splitFormulaAtTopLevel('-\\dfrac{35\\pi}{12};\\ -\\dfrac{23\\pi}8')).toEqual([
      '-\\dfrac{35\\pi}{12};',
      '-\\dfrac{23\\pi}8',
    ]);
    expect(splitFormulaAtTopLevel('\\dfrac{36}{25};\\ (\\sqrt{13}-2;\\ 4)')).toEqual([
      '\\dfrac{36}{25};',
      '(\\sqrt{13}-2;\\ 4)',
    ]);
  });

  it('short formulas, display formulas and plain text stay as they are', () => {
    expect(wrapAnswerMath('$6-3\\sqrt2$')).toBe('$6-3\\sqrt2$');
    expect(wrapAnswerMath('12')).toBe('12');
    expect(wrapAnswerMath('а) $x$; б) $y$')).toBe('а) $x$; б) $y$');
    expect(wrapAnswerMath('$$a\\cup b$$')).toBe('$$a\\cup b$$');
  });

  it('the pieces, joined, are exactly the original formula: nothing lost, nothing reordered', () => {
    const tex =
      'a\\in\\left(-4\\sqrt{65};\\,-\\sqrt{290}\\right)\\cup\\left(-12\\sqrt2;\\,-8\\sqrt2\\right)\\cup(8\\sqrt2;12\\sqrt2)';
    const out = wrapAnswerMath(`$${tex}$`);
    expect(out.split('$ $')).toHaveLength(3);
    expect(out.replace(/\$ \$(\{\})?/g, '').replace(/\$/g, '')).toBe(tex);
  });

  it.each([
    'a\\in(-3;0),\\ a\\neq\\dfrac{-5-\\sqrt{13}}{6},\\ a\\neq\\dfrac{-5+\\sqrt{13}}{6}',
    '\\dfrac{36}{25};\\ (\\sqrt{13}-2;\\ 4)',
    'a\\in\\left\\{\\dfrac{36}{25}\\right\\}\\cup(\\sqrt{13}-2;\\,4)',
    '-\\dfrac{35\\pi}{12};\\ -\\dfrac{23\\pi}8;\\ -\\dfrac{21\\pi}8',
    'x\\in(-\\infty;\\,-10)\\cup\\left[-4\\sqrt2;\\,-\\dfrac{\\sqrt2}8\\right]\\cup(10;\\,+\\infty)',
  ])('every piece is valid LaTeX on its own: %s', (tex) => {
    for (const piece of splitFormulaAtTopLevel(tex)) {
      expect(piece.endsWith('\\')).toBe(false);
      expect(() => katex.renderToString(piece, { throwOnError: true })).not.toThrow();
    }
  });
});
