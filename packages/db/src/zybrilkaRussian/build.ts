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

export interface OneWrongSpec {
  readonly taskNumber: 5 | 7;
  readonly instruction: string;
  readonly intro: string;
  readonly othersTitle: string;
  readonly hint: string;
}

export const PARONYM_SPEC: OneWrongSpec = {
  taskNumber: 5,
  instruction: TASK5_INSTRUCTION,
  intro:
    'Паронимы — однокоренные слова, похожие по звучанию, но разные по значению. Проверяем, подходит ли каждое выделенное слово по смыслу и сочетаемости.',
  othersTitle: 'Остальные слова употреблены верно:',
  hint: 'Подставь к каждому выделенному слову его пароним и реши, какое из двух точнее подходит по смыслу и сочетаемости.',
};

export const TASK7_INSTRUCTION =
  'В одном из выделенных ниже слов допущена грамматическая ошибка. **Исправьте ошибку** и запишите слово правильно.';

export const FORMS_SPEC: OneWrongSpec = {
  taskNumber: 7,
  instruction: TASK7_INSTRUCTION,
  intro:
    'Проверяем каждую выделенную форму по нормам образования форм слов: падежные окончания, степени сравнения, склонение числительных и местоимений, формы глаголов, причастий и деепричастий.',
  othersTitle: 'Остальные формы образованы верно:',
  hint: 'Определи часть речи каждого выделенного слова и вспомни, как правильно образуется именно эта форма.',
};

/** Five highlighted items, exactly one wrong (tasks 5 and 7). */
export function buildOneWrong(n: number, t: Paronym5, spec: OneWrongSpec): BankTask {
  const i = t.wrong - 1;
  const sentence = t.s[i]!;
  const bad = highlightsOf(sentence)[0]!;
  const atStart = sentence.trimStart().startsWith(`{${bad}}`);
  const fixed = plain(sentence.replace(`{${bad}}`, `**${atStart ? cap(t.fix) : t.fix}**`));
  const others = t.why.filter((_, k) => k !== i).map((w) => `- ${cap(w)}`);
  return {
    taskNumber: spec.taskNumber,
    n,
    difficulty: t.d,
    kind: t.kind,
    conditionMd: [spec.instruction, ...t.s.map(showHighlights)].join('\n\n'),
    answer: { type: 'word', word: t.fix, accepted: t.accepted ?? [] },
    explanationMd: [
      spec.intro,
      `**Ошибка — в ${spec.taskNumber === 5 ? 'предложении' : 'строке'} ${t.wrong}.** ${cap(t.why[i]!)}. Правильно: «${fixed}»`,
      `${spec.othersTitle}\n\n${others.join('\n')}`,
      `**Обрати внимание.** ${t.note}`,
      `Ответ: ${[t.fix, ...(t.accepted ?? [])].join(' / ')}.`,
    ].join('\n\n'),
    hintMd: spec.hint,
  };
}

export const buildParonym5 = (n: number, t: Paronym5) => buildOneWrong(n, t, PARONYM_SPEC);

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
  /** The corrected sentence, when the fix changes more than the word (e.g. a case after «из-за»). */
  readonly corrected?: string;
}

export function buildLexical6(n: number, t: Lexical6): BankTask {
  const target = highlightsOf(t.s)[0]!;
  const answer = t.mode === 'remove' ? target : t.fix!;
  const corrected =
    t.mode === 'remove'
      ? plain(t.s.replace(`{${target}} `, '').replace(` {${target}}`, ''))
      : plain(
          t.s.replace(
            `{${target}}`,
            t.s.trimStart().startsWith(`{${target}}`) ? cap(t.fix!) : t.fix!,
          ),
        );
  return {
    taskNumber: 6,
    n,
    difficulty: t.d,
    kind: t.kind,
    conditionMd: [t.mode === 'remove' ? TASK6_REMOVE : TASK6_REPLACE, plain(t.s)].join('\n\n'),
    answer: { type: 'word', word: answer.toLowerCase(), accepted: t.accepted ?? [] },
    explanationMd: [
      t.mode === 'remove'
        ? 'Ищем слово, которое повторяет смысл другого слова в предложении (это плеоназм): без него смысл не меняется, а ошибка исчезает.'
        : 'Ищем слово, которое не сочетается с соседними по смыслу или по устойчивому употреблению, и подбираем верное, сохраняя смысл.',
      `**Ошибка: «${target}».** ${cap(dot(t.why))}`,
      `Исправленное предложение: «${dot(cap(t.corrected ?? corrected))}»`,
      `**Обрати внимание.** ${t.note}`,
      `Ответ: ${[answer.toLowerCase(), ...(t.accepted ?? [])].join(' / ')}.`,
    ].join('\n\n'),
    hintMd:
      t.mode === 'remove'
        ? 'Найди два слова, которые говорят одно и то же: одно из них лишнее.'
        : 'Проверь, с какими словами обычно употребляется каждое слово предложения: одно сочетание неустойчиво.',
  };
}
