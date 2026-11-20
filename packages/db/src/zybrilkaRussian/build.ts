import type { BankTask, Difficulty } from './types.js';

/**
 * Builders of the bank's mechanics. Each takes the author's structured
 * data and returns a `BankTask` whose answer is computed from that data;
 * the explanation is assembled from the same notes, so it always argues
 * for the computed answer. Highlighted words are written `{слово}` and
 * shown as **СЛОВО**.
 */

const HIGHLIGHT = /\{([^}]+)\}/g;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const dot = (s: string) => (/[.!?…]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

/** `{слово}` → **СЛОВО**. */
export function showHighlights(text: string): string {
  return text.replace(HIGHLIGHT, (_, w: string) => `**${w.toUpperCase()}**`);
}
export function highlightsOf(text: string): string[] {
  return [...text.matchAll(HIGHLIGHT)].map((m) => m[1]!);
}
const plain = (text: string) => text.replace(HIGHLIGHT, (_, w: string) => w);

// ------------------------------------------------------------------ №5

export const TASK5_INSTRUCTION =
  'В одном из приведённых ниже предложений **НЕВЕРНО** употреблено выделенное слово. Исправьте лексическую ошибку, подобрав к выделенному слову пароним. Запишите подобранное слово, соблюдая нормы современного русского литературного языка.';

export interface Paronym5 {
  readonly d: Difficulty;
  readonly kind: string;
  /** Five sentences, each with one `{слово}`. */
  readonly s: readonly [string, string, string, string, string];
  /** Why each highlighted word is (or is not) right, in sentence order. */
  readonly why: readonly [string, string, string, string, string];
  /** 1-based number of the sentence with the error. */
  readonly wrong: 1 | 2 | 3 | 4 | 5;
  /** The paronym in the form the sentence needs. */
  readonly fix: string;
  readonly accepted?: readonly string[];
  readonly note: string;
}

export function buildParonym5(n: number, t: Paronym5): BankTask {
  const i = t.wrong - 1;
  const sentence = t.s[i]!;
  const bad = highlightsOf(sentence)[0]!;
  const fixed = plain(sentence.replace(`{${bad}}`, `**${t.fix}**`));
  const others = t.s
    .map((s, k) => ({ s, k }))
    .filter(({ k }) => k !== i)
    .map(({ s, k }) => `- **${highlightsOf(s)[0]}** — ${t.why[k]}`);
  return {
    taskNumber: 5,
    n,
    difficulty: t.d,
    kind: t.kind,
    conditionMd: [TASK5_INSTRUCTION, ...t.s.map(showHighlights)].join('\n\n'),
    answer: { type: 'word', word: t.fix, accepted: t.accepted ?? [] },
    explanationMd: [
      'Паронимы — однокоренные слова, похожие по звучанию, но разные по значению. Проверяем, подходит ли каждое выделенное слово по смыслу и сочетаемости.',
      `**Ошибка — в предложении ${t.wrong}.** ${cap(t.why[i]!)}. Правильно: «${fixed}»`,
      `Остальные слова употреблены верно:\n\n${others.join('\n')}`,
      `**Обрати внимание.** ${t.note}`,
      `Ответ: ${[t.fix, ...(t.accepted ?? [])].join(' / ')}.`,
    ].join('\n\n'),
    hintMd:
      'Подставь к каждому выделенному слову его пароним и реши, какое из двух точнее подходит по смыслу и сочетаемости.',
  };
}

// ------------------------------------------------------------------ №6

export const TASK6_REMOVE =
  'Отредактируйте предложение: исправьте лексическую ошибку, **исключив лишнее слово**. Выпишите это слово.';
export const TASK6_REPLACE =
  'Отредактируйте предложение: исправьте лексическую ошибку, **заменив употреблённое неверно слово**. Запишите подобранное слово, соблюдая нормы современного русского литературного языка и сохраняя смысл высказывания.';

export interface Lexical6 {
  readonly d: Difficulty;
  readonly kind: string;
  readonly mode: 'remove' | 'replace';
  /** The sentence; the wrong / extra word written `{так}` (shown plainly). */
  readonly s: string;
  /** replace: the right word in the sentence's form. remove: omitted (= the extra word). */
  readonly fix?: string;
  readonly accepted?: readonly string[];
  readonly why: string;
  readonly note: string;
}

export function buildLexical6(n: number, t: Lexical6): BankTask {
  const target = highlightsOf(t.s)[0]!;
  const answer = t.mode === 'remove' ? target : t.fix!;
  const corrected =
    t.mode === 'remove'
      ? plain(t.s.replace(`{${target}} `, '').replace(` {${target}}`, ''))
      : plain(t.s.replace(`{${target}}`, t.fix!));
  return {
    taskNumber: 6,
    n,
    difficulty: t.d,
    kind: t.kind,
    conditionMd: [t.mode === 'remove' ? TASK6_REMOVE : TASK6_REPLACE, plain(t.s)].join('\n\n'),
    answer: { type: 'word', word: answer.toLowerCase(), accepted: t.accepted ?? [] },
    explanationMd: [
      t.mode === 'remove'
        ? 'Ищем слово, которое повторяет смысл другого слова в предложении (плеоназм) или однокоренное слово рядом (тавтология): без него смысл не меняется.'
        : 'Ищем слово, которое не сочетается с соседними по смыслу или по устойчивому употреблению, и подбираем верное, сохраняя смысл.',
      `**Ошибка: «${target}».** ${cap(dot(t.why))}`,
      `Исправленное предложение: «${dot(corrected)}»`,
      `**Обрати внимание.** ${t.note}`,
      `Ответ: ${[answer.toLowerCase(), ...(t.accepted ?? [])].join(' / ')}.`,
    ].join('\n\n'),
    hintMd:
      t.mode === 'remove'
        ? 'Найди два слова, которые говорят одно и то же: одно из них лишнее.'
        : 'Проверь, с какими словами обычно употребляется каждое слово предложения: одно сочетание неустойчиво.',
  };
}
