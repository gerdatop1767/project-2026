import { MATCH_SEPARATOR, type QuizItem } from '../quizGames.js';
import { GEOMETRY_BANK } from './geometry.js';
import type { TheoryBank, TheoryQuestion } from './types.js';

export type * from './types.js';
export { GEOMETRY_BANK };

/**
 * Every bank of «Теория на практике». A new area (algebra, trigonometry,
 * derivative, functions, logarithms, solid geometry, probability) is a new
 * file with a `TheoryBank` added here — nothing else changes.
 */
export const THEORY_BANKS: readonly TheoryBank[] = [GEOMETRY_BANK];

export const THEORY_PROMPTS: Record<TheoryQuestion['kind'], string> = {
  continue: 'Продолжи правило',
  fix: 'В утверждении ошибка. Выбери верный вариант',
  figure: 'Для какой фигуры это верно?',
  formula: 'Выбери верную формулу',
  truefalse: 'Верно или неверно?',
  match: 'Соедини пары',
};

const TRUE = 'Верно';
const FALSE = 'Неверно';

/** One theory question as a quiz question of the shared pipeline. */
export function theoryQuizItem(bank: TheoryBank, q: TheoryQuestion): QuizItem {
  const key = `theory:${bank.id}:${q.id}`;
  const base = {
    key,
    taskId: key,
    explanation: q.explanation,
    explanationSource: 'author' as const,
  };
  switch (q.kind) {
    case 'continue':
    case 'figure':
    case 'formula':
    case 'fix': {
      const text =
        q.kind === 'continue'
          ? q.stem
          : q.kind === 'figure'
            ? q.property
            : q.kind === 'formula'
              ? q.prompt
              : q.statement;
      return {
        ...base,
        kind: 'choice',
        text,
        prompt: THEORY_PROMPTS[q.kind],
        options: [q.answer, ...q.wrong],
        correct: q.answer,
        display: q.answer,
      };
    }
    case 'truefalse':
      return {
        ...base,
        kind: 'choice',
        text: q.statement,
        prompt: THEORY_PROMPTS.truefalse,
        options: [TRUE, FALSE],
        correct: q.answer ? TRUE : FALSE,
        display: q.answer ? TRUE : FALSE,
      };
    case 'match':
      return {
        ...base,
        kind: 'match',
        text: q.prompt,
        prompt: THEORY_PROMPTS.match,
        left: q.pairs.map(([l]) => l),
        options: q.pairs.map(([, r]) => r),
        correct: q.pairs.map(([, r]) => r).join(MATCH_SEPARATOR),
        display: q.pairs.map(([l, r]) => `${l} — ${r}`).join('; '),
      };
  }
}

export function theoryQuizItems(): QuizItem[] {
  return THEORY_BANKS.flatMap((bank) => bank.questions.map((q) => theoryQuizItem(bank, q)));
}
