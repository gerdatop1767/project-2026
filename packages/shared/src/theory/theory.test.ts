import { describe, expect, it } from 'vitest';
import { MATCH_SEPARATOR, checkQuizAnswer, dedupeItems } from '../quizGames.js';
import { THEORY_BANKS, theoryQuizItems } from './index.js';
import type { TheoryQuestion } from './types.js';

const all: { bank: string; q: TheoryQuestion }[] = THEORY_BANKS.flatMap((b) =>
  b.questions.map((q) => ({ bank: b.id, q })),
);

/** `$…$` pairs balanced and no empty formula. */
const balanced = (s: string) => (s.match(/\$/g)?.length ?? 0) % 2 === 0 && !/\$\s*\$/.test(s);
const texts = (q: TheoryQuestion): string[] => {
  switch (q.kind) {
    case 'continue':
      return [q.stem, q.answer, ...q.wrong, q.explanation];
    case 'fix':
      return [q.statement, q.answer, ...q.wrong, q.explanation];
    case 'figure':
      return [q.property, q.answer, ...q.wrong, q.explanation];
    case 'formula':
      return [q.prompt, q.answer, ...q.wrong, q.explanation];
    case 'truefalse':
      return [q.statement, q.explanation];
    case 'match':
      return [q.prompt, ...q.pairs.flat(), q.explanation];
  }
};

describe('«Теория на практике»: the bank', () => {
  it('all six mechanics, geometry topics, enough questions for long rounds', () => {
    const kinds = new Set(all.map((x) => x.q.kind));
    expect([...kinds].sort()).toEqual([
      'continue',
      'figure',
      'fix',
      'formula',
      'match',
      'truefalse',
    ]);
    expect(all.length).toBeGreaterThanOrEqual(80);
    const topics = new Set(all.map((x) => x.q.topic));
    for (const t of [
      'треугольники',
      'подобие',
      'четырёхугольники',
      'окружность',
      'площади',
      'углы',
      'теоремы',
      'признаки равенства',
    ]) {
      expect(topics.has(t), t).toBe(true);
    }
  });

  it('ids are unique and stable; every question has an explanation', () => {
    const keys = all.map((x) => `${x.bank}:${x.q.id}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const { q } of all) expect(q.explanation.length, q.id).toBeGreaterThan(15);
  });

  it('exactly one right answer: the answer is not among the wrong ones, no duplicates', () => {
    for (const { q } of all) {
      if (q.kind === 'truefalse') continue;
      if (q.kind === 'match') {
        const rights = q.pairs.map(([, r]) => r);
        const lefts = q.pairs.map(([l]) => l);
        expect(new Set(rights).size, q.id).toBe(rights.length);
        expect(new Set(lefts).size, q.id).toBe(lefts.length);
        expect(q.pairs.length, q.id).toBeGreaterThanOrEqual(3);
        continue;
      }
      expect(q.wrong, q.id).not.toContain(q.answer);
      expect(new Set(q.wrong).size, q.id).toBe(q.wrong.length);
      expect(q.wrong.length, q.id).toBeGreaterThanOrEqual(3);
    }
  });

  it('formulas are well-formed LaTeX in $…$', () => {
    for (const { q } of all)
      for (const t of texts(q)) expect(balanced(t), `${q.id}: ${t}`).toBe(true);
  });

  it('true/false is not one-sided', () => {
    const tf = all.filter((x) => x.q.kind === 'truefalse').map((x) => x.q) as Extract<
      TheoryQuestion,
      { kind: 'truefalse' }
    >[];
    const yes = tf.filter((q) => q.answer).length;
    expect(yes).toBeGreaterThan(tf.length / 4);
    expect(tf.length - yes).toBeGreaterThan(tf.length / 4);
  });
});

describe('«Теория на практике»: as quiz questions', () => {
  const items = theoryQuizItems();

  it('every question answerable by its key, wrong options rejected, nothing lost to dedupe', () => {
    expect(dedupeItems(items)).toHaveLength(items.length);
    for (const it of items) {
      expect(it.explanationSource).toBe('author');
      if (it.kind === 'choice') {
        expect(checkQuizAnswer(it, it.correct), it.key).toBe(true);
        for (const o of it.options!) expect(checkQuizAnswer(it, o), it.key).toBe(o === it.correct);
      } else {
        expect(it.kind).toBe('match');
        expect(checkQuizAnswer(it, it.correct), it.key).toBe(true);
        const right = it.correct.split(MATCH_SEPARATOR);
        // One pair swapped: wrong.
        const swapped = [right[1]!, right[0]!, ...right.slice(2)].join(MATCH_SEPARATOR);
        expect(checkQuizAnswer(it, swapped), it.key).toBe(false);
        // Missing pair: wrong.
        expect(checkQuizAnswer(it, right.slice(1).join(MATCH_SEPARATOR)), it.key).toBe(false);
      }
    }
  });

  it('a math rule keeps its conditions: e.g. «катет против 30°» names the right triangle', () => {
    const leg = items.find((i) => i.key.endsWith(':c-leg-30'))!;
    expect(leg.text).toMatch(/прямоугольном треугольнике/);
    const cyclic = items.find((i) => i.key.endsWith(':g-cyclic-trapezoid'))!;
    expect(cyclic.correct).toBe('равнобедренная трапеция');
  });
});
