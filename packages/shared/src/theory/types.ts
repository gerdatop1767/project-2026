/**
 * «Теория на практике»: hand-written, checked theory questions. A bank is
 * one topic area (geometry, later algebra, trigonometry…); every question
 * is one of six mechanics. A new bank is a new file plus one line in
 * `theory/index.ts` — the game, its checking and its screen stay as they are.
 *
 * Rules for the content (docs/THEORY-GAME.md): only school-curriculum
 * statements; every condition a rule needs is in the wording; one
 * unambiguous right answer; a short explanation; formulas in LaTeX ($…$).
 */
export type TheoryMechanic = 'continue' | 'fix' | 'figure' | 'formula' | 'truefalse' | 'match';

interface Base {
  /** Stable forever (progress is kept by it). */
  readonly id: string;
  /** A sub-topic inside the bank: «треугольники», «окружность»… */
  readonly topic: string;
  readonly explanation: string;
}

/** «Продолжи правило»: the start of a rule, the right ending among others. */
export interface ContinueQuestion extends Base {
  readonly kind: 'continue';
  readonly stem: string;
  readonly answer: string;
  readonly wrong: readonly string[];
}

/** «Исправь ошибку»: a statement with one error; pick its correct version. */
export interface FixQuestion extends Base {
  readonly kind: 'fix';
  readonly statement: string;
  readonly answer: string;
  readonly wrong: readonly string[];
}

/** «Для какой фигуры характерно правило?» */
export interface FigureQuestion extends Base {
  readonly kind: 'figure';
  readonly property: string;
  readonly answer: string;
  readonly wrong: readonly string[];
}

/** «Найди правильную формулу». */
export interface FormulaQuestion extends Base {
  readonly kind: 'formula';
  readonly prompt: string;
  readonly answer: string;
  readonly wrong: readonly string[];
}

/** «Верно или неверно». */
export interface TrueFalseQuestion extends Base {
  readonly kind: 'truefalse';
  readonly statement: string;
  readonly answer: boolean;
}

/** «Соедини соответствия»: every left item has exactly one right item. */
export interface MatchQuestion extends Base {
  readonly kind: 'match';
  readonly prompt: string;
  readonly pairs: readonly (readonly [string, string])[];
}

export type TheoryQuestion =
  | ContinueQuestion
  | FixQuestion
  | FigureQuestion
  | FormulaQuestion
  | TrueFalseQuestion
  | MatchQuestion;

export interface TheoryBank {
  /** `geometry`, `algebra`… — part of every question's key. */
  readonly id: string;
  readonly title: string;
  readonly questions: readonly TheoryQuestion[];
}
