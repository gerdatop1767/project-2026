import { z } from 'zod';

/**
 * Quiz mini-games (docs/MINI_GAMES.md § Игры-викторины). Every question is
 * cut out of a REAL published ЕГЭ task: its condition, its key and its own
 * explanation. Nothing is invented — a task whose key or text does not
 * parse cleanly gives no question at all.
 *
 * Kinds of questions:
 * - `choice`: tap one option (Н / НН, Да / Нет, a word, a means…);
 * - `slots`: tap the numbered places where a comma goes;
 * - `input`: type a short answer (a word, a number);
 * - `words`: tap the words of a text that answer the prompt.
 */

export type QuizKind = 'choice' | 'slots' | 'input' | 'words';

/** One question as the server keeps it (the key never leaves the server). */
export interface QuizItem {
  /** Stable within the task: `${taskId}:${part}`. */
  readonly key: string;
  readonly taskId: string;
  readonly kind: QuizKind;
  /** The text the player works on. */
  readonly text: string;
  /** This question's own wording, when it differs from the game's instruction. */
  readonly prompt?: string;
  readonly options?: readonly string[];
  readonly slots?: readonly number[];
  /** Normalized key (see `checkQuizAnswer`). */
  readonly correct: string;
  /** Other accepted keys (normalized), from the task's own accepted answers. */
  readonly accepted?: readonly string[];
  /** The right answer as the player sees it. */
  readonly display: string;
  /** The task's own explanation of this very question, when it has one. */
  readonly explanation?: string;
}

/** What a game needs from one task row (+ its passage). */
export interface QuizTaskRow {
  readonly id: string;
  readonly taskNumber: number;
  readonly conditionMd: string;
  readonly correctAnswer: string;
  readonly acceptedAnswers: readonly string[] | null;
  readonly explanationMd: string | null;
  readonly passageMd: string | null;
  readonly imageUrl: string | null;
}

export const QUIZ_TOPICS = [
  { id: 'orthography', title: 'Орфография' },
  { id: 'punctuation', title: 'Пунктуация' },
  { id: 'norms', title: 'Нормы языка' },
  { id: 'text', title: 'Текст и лексика' },
  { id: 'math-part1', title: 'Первая часть' },
] as const;
export type QuizTopic = (typeof QUIZ_TOPICS)[number]['id'];

export const QUIZ_ROUND_SIZE = 10;
/** Points for a question answered right on the first try. */
export const QUIZ_POINTS_PER_CORRECT = 10;
/** Bonus for a round with every question right. */
export const QUIZ_PERFECT_BONUS = 20;

/** The round's points: 10 per right first answer, +20 for a perfect round. */
export function quizRoundScore(firstTryCorrect: number, questions: number): number {
  const right = Math.max(0, Math.min(firstTryCorrect, questions));
  return (
    right * QUIZ_POINTS_PER_CORRECT +
    (questions > 0 && right === questions ? QUIZ_PERFECT_BONUS : 0)
  );
}

// ---------------------------------------------------------------- helpers

const clean = (s: string) =>
  s
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();

/** Lowercase, «ё» → «е», no spaces or punctuation: how keys are compared. */
export function normalizeWord(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]/g, '');
}

/** A number as a key: «0,5» = «0.5» = «.5»; anything else → null. */
function normalizeNumber(s: string): string | null {
  const t = s.trim().replace(/\s+/g, '').replace(',', '.');
  if (!/^-?\d*\.?\d+$/.test(t)) return null;
  return String(Number(t));
}

/** The answer's digits as a sorted set: «31» → «13». */
const digitSet = (s: string) => [...new Set(s.replace(/\D/g, ''))].sort().join('');

/** Numbered lines «1) …» of a condition, by number. */
function numberedLines(md: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of md.split('\n')) {
    const m = line.match(/^\s*(\d)\)\s*(.+)$/);
    if (m) out.set(Number(m[1]), clean(m[2]!));
  }
  return out;
}

/**
 * The part of an explanation about row/place `n`: from its marker («3)»,
 * «(3)», «**Ряд 3 …**») to the next one. Null when it cannot be cut out
 * cleanly — then only the rule-free «Правильно: …» is shown.
 */
export function explanationPart(md: string | null, n: number): string | null {
  if (!md) return null;
  const text = md.replace(/\r/g, '');
  const marker = (k: number | string) =>
    new RegExp(`(?:^|\\n|\\s)(?:\\*\\*)?(?:Ряд\\s+${k}\\b|\\(${k}\\)|${k}\\))`, 'm');
  const start = text.search(marker(n));
  if (start < 0) return null;
  const rest = text.slice(start + 1);
  // The part ends where ANY other place's part starts (authors do not
  // always go in order), or at «Ответ:».
  const others = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    .filter((k) => k !== n)
    .map((k) => rest.search(marker(k)))
    .filter((x) => x >= 0);
  const answer = rest.search(/\n\s*Ответ\s*:/);
  const stops = [...others, answer].filter((x) => x >= 0);
  const part = clean(
    text.slice(start, start + 1 + (stops.length ? Math.min(...stops) : rest.length)),
  );
  return part.length >= 8 ? part : null;
}

/** The part of an explanation about letter `L` (А–Д). */
export function explanationLetter(md: string | null, letter: string): string | null {
  if (!md) return null;
  const re = /(?:^|\n|\.\s+|\s)([А-Д])\s*(?:\)|—|-|–)/g;
  const marks = [...md.matchAll(re)].map((m) => ({
    letter: m[1]!,
    at: m.index! + m[0].indexOf(m[1]!),
  }));
  const i = marks.findIndex((m) => m.letter === letter);
  if (i < 0) return null;
  const end = marks.slice(i + 1).find((m) => m.letter !== letter)?.at;
  const part = clean(md.slice(marks[i]!.at, end).replace(/\n\s*Ответ\s*:.*$/s, ''));
  return part.length >= 8 ? part : null;
}

/** The whole explanation (for a question that is the whole task). */
export function explanationWhole(md: string | null): string | null {
  if (!md) return null;
  const t = clean(md);
  return t.length >= 8 ? t : null;
}

/** Drops repeats: the same text + key appears once (books reprint tasks). */
export function dedupeItems(items: readonly QuizItem[]): QuizItem[] {
  const seen = new Set<string>();
  const out: QuizItem[] = [];
  for (const it of items) {
    const k = `${it.kind}|${it.text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ')}|${it.prompt ?? ''}|${it.correct}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

const YES = 'Да';
const NO = 'Нет';

/** The first line of a condition, plain. */
const firstLine = (md: string) => clean(md.split('\n')[0] ?? '');

// ----------------------------------------------------------------- parsers

/**
 * №9–12: one question per row — «Во всех словах ряда пропущена одна и та
 * же буква?». The key is the task's answer digits.
 */
export function rowItems(row: QuizTaskRow): QuizItem[] {
  const head = firstLine(row.conditionMd);
  if (!/одна и та же буква/.test(head)) return [];
  const rows = numberedLines(row.conditionMd);
  const key = digitSet(row.correctAnswer);
  if (rows.size !== 5 || !/^[1-5]+$/.test(key)) return [];
  const both = /в обоих словах/.test(head);
  return [...rows].map(([n, text]) => {
    const yes = key.includes(String(n));
    const explanation = explanationPart(row.explanationMd, n);
    return {
      key: `${row.id}:${n}`,
      taskId: row.id,
      kind: 'choice' as const,
      text,
      prompt: both
        ? 'В обоих словах пропущена одна и та же буква?'
        : 'Во всех словах ряда пропущена одна и та же буква?',
      options: [YES, NO],
      correct: yes ? YES : NO,
      display: yes ? YES : NO,
      ...(explanation ? { explanation } : {}),
    };
  });
}

/** №13: НЕ (НИ) — слитно или раздельно, one question per sentence. */
export function neItems(row: QuizTaskRow): QuizItem[] {
  const head = firstLine(row.conditionMd);
  const asked = /РАЗДЕЛЬНО/.test(head) ? 'раздельно' : /СЛИТНО/.test(head) ? 'слитно' : null;
  if (!asked) return [];
  const lines = numberedLines(row.conditionMd);
  const key = digitSet(row.correctAnswer);
  if (lines.size !== 5 || !/^[1-5]+$/.test(key)) return [];
  const other = asked === 'слитно' ? 'раздельно' : 'слитно';
  return [...lines]
    .filter(([, text]) => /\((?:НЕ|НИ)\)/.test(text))
    .map(([n, text]) => {
      const answer = key.includes(String(n)) ? asked : other;
      const explanation = explanationPart(row.explanationMd, n);
      return {
        key: `${row.id}:${n}`,
        taskId: row.id,
        kind: 'choice' as const,
        text,
        prompt: 'НЕ (НИ) с выделенным словом пишется…',
        options: ['слитно', 'раздельно'],
        correct: answer,
        display: answer,
        ...(explanation ? { explanation } : {}),
      };
    });
}

/** №14: все выделенные слова пишутся СЛИТНО / РАЗДЕЛЬНО / ЧЕРЕЗ ДЕФИС? */
export function hyphenItems(row: QuizTaskRow): QuizItem[] {
  const head = firstLine(row.conditionMd);
  const m = head.match(/пишутся\s+(СЛИТНО|РАЗДЕЛЬНО|ЧЕРЕЗ ДЕФИС)/i);
  if (!m) return [];
  const how = m[1]!.toLowerCase();
  const lines = numberedLines(row.conditionMd);
  const key = digitSet(row.correctAnswer);
  if (lines.size !== 5 || !/^[1-5]+$/.test(key)) return [];
  return [...lines].map(([n, text]) => {
    const yes = key.includes(String(n));
    const explanation = explanationPart(row.explanationMd, n);
    return {
      key: `${row.id}:${n}`,
      taskId: row.id,
      kind: 'choice' as const,
      text,
      prompt: `Оба выделенных слова пишутся ${how}?`,
      options: [YES, NO],
      correct: yes ? YES : NO,
      display: yes ? YES : NO,
      ...(explanation ? { explanation } : {}),
    };
  });
}

/** №15: one question per numbered place — Н или НН. */
export function nnItems(row: QuizTaskRow): QuizItem[] {
  const head = firstLine(row.conditionMd);
  const asksNN = /пишется НН/.test(head);
  const asksN = /одна буква Н|пишется Н\.?$/.test(head);
  if (!asksNN && !asksN) return [];
  const body = clean(row.conditionMd.split('\n').slice(1).join(' '));
  const places = [...body.matchAll(/\((\d)\)/g)].map((m) => Number(m[1]));
  const key = digitSet(row.correctAnswer);
  if (places.length < 2 || !/^\d+$/.test(key)) return [];
  if ([...key].some((d) => !places.includes(Number(d)))) return [];
  return places.map((n) => {
    const inKey = key.includes(String(n));
    const answer = asksNN === inKey ? 'НН' : 'Н';
    const text = body.replace(/\((\d)\)/g, (_, d: string) => (Number(d) === n ? '▢' : '..'));
    const explanation = explanationPart(row.explanationMd, n);
    return {
      key: `${row.id}:${n}`,
      taskId: row.id,
      kind: 'choice' as const,
      text,
      options: ['Н', 'НН'],
      correct: answer,
      display: answer,
      ...(explanation ? { explanation } : {}),
    };
  });
}

/** №16: one question per sentence — нужна ровно одна запятая? */
export function oneCommaItems(row: QuizTaskRow): QuizItem[] {
  if (!/ОДНУ запятую/.test(firstLine(row.conditionMd))) return [];
  const lines = numberedLines(row.conditionMd);
  const key = digitSet(row.correctAnswer);
  if (lines.size !== 5 || !/^[1-5]+$/.test(key)) return [];
  return [...lines].map(([n, text]) => {
    const yes = key.includes(String(n));
    const explanation = explanationPart(row.explanationMd, n);
    return {
      key: `${row.id}:${n}`,
      taskId: row.id,
      kind: 'choice' as const,
      text,
      prompt: 'Нужна ровно одна запятая?',
      options: [YES, NO],
      correct: yes ? YES : NO,
      display: yes ? YES : NO,
      ...(explanation ? { explanation } : {}),
    };
  });
}

/** №17–20: tap the numbered places where commas go (the whole task). */
export function commaItems(row: QuizTaskRow): QuizItem[] {
  if (!/должна\(-ы\) стоять запятая/.test(firstLine(row.conditionMd))) return [];
  const body = clean(row.conditionMd.split('\n').slice(1).join(' '));
  const slots = [...new Set([...body.matchAll(/\((\d{1,2})\)/g)].map((m) => Number(m[1])))];
  const key = [...new Set(row.correctAnswer.replace(/\D/g, ''))].map(Number).sort((a, b) => a - b);
  if (slots.length < 2 || slots.some((n) => n > 9) || key.length === 0) return [];
  if (key.some((d) => !slots.includes(d))) return [];
  const explanation = explanationWhole(row.explanationMd);
  return [
    {
      key: `${row.id}:all`,
      taskId: row.id,
      kind: 'slots',
      text: body,
      slots: slots.sort((a, b) => a - b),
      correct: key.join(''),
      display: key.join(', '),
      ...(explanation ? { explanation } : {}),
    },
  ];
}

/** The CAPS words of a block («ЗВУЧНЫЙ»), in order. */
const capsWords = (s: string) =>
  [...s.matchAll(/(?<![А-Яа-яЁё])[А-ЯЁ]{3,}(?:-[А-ЯЁ]+)?(?![А-Яа-яЁё])/g)].map((m) => m[0]);

/** Length of the common start of two words. */
function commonStart(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * The highlighted word the key corrects: the one sharing the longest start
 * with the key, and clearly longer than every other. Null when ambiguous.
 */
function wrongWord(candidates: readonly string[], key: string): string | null {
  const k = normalizeWord(key);
  const scored = candidates
    .map((w) => ({ w, s: commonStart(normalizeWord(w), k) }))
    .sort((a, b) => b.s - a.s);
  if (!scored[0] || scored[0].s < 3) return null;
  if (scored[1] && scored[1].s >= scored[0].s) return null;
  if (normalizeWord(scored[0].w) === k) return null;
  return scored[0].w;
}

/** №5: which highlighted word is a wrong paronym? (the task's key corrects it) */
export function paronymItems(row: QuizTaskRow): QuizItem[] {
  const sentences = row.conditionMd
    .split('\n')
    .slice(1)
    .map(clean)
    .filter((l) => l.length > 0);
  const words = sentences.flatMap((s) => capsWords(s));
  if (words.length < 4 || new Set(words).size !== words.length) return [];
  const wrong = wrongWord(words, row.correctAnswer);
  if (!wrong) return [];
  const explanation = explanationWhole(row.explanationMd);
  return [
    {
      key: `${row.id}:all`,
      taskId: row.id,
      kind: 'choice',
      text: sentences.join('\n'),
      prompt: 'Какое выделенное слово употреблено неверно?',
      options: words,
      correct: wrong,
      display: `${wrong} → ${row.correctAnswer.trim().toUpperCase()}`,
      ...(explanation ? { explanation } : {}),
    },
  ];
}

/** №7: which highlighted form is wrong? (the task's key is its right form) */
export function formErrorItems(row: QuizTaskRow): QuizItem[] {
  const lines = row.conditionMd
    .split('\n')
    .slice(1)
    .map(clean)
    .filter((l) => l.length > 0);
  if (lines.length !== 5) return [];
  const words = lines.map((l) => capsWords(l)[0] ?? '');
  if (words.some((w) => !w) || new Set(words).size !== 5) return [];
  const wrong = wrongWord(words, row.correctAnswer);
  if (!wrong) return [];
  const explanation = explanationWhole(row.explanationMd);
  return [
    {
      key: `${row.id}:all`,
      taskId: row.id,
      kind: 'choice',
      text: lines.join('\n'),
      prompt: 'В каком выделенном слове ошибка в форме?',
      options: words,
      correct: wrong,
      display: `${wrong} → ${row.correctAnswer.trim().toLowerCase()}`,
      ...(explanation ? { explanation } : {}),
    },
  ];
}

/** The sentence of a passage that holds the gap «<…>». */
function sentenceWith(passage: string, needle: RegExp): string | null {
  const flat = passage.replace(/\*\*/g, '').replace(/\s+/g, ' ');
  const m = flat.search(needle);
  if (m < 0) return null;
  const before = flat.slice(0, m);
  const startCut = Math.max(
    before.lastIndexOf('. '),
    before.lastIndexOf('! '),
    before.lastIndexOf('? '),
    before.lastIndexOf('» '),
  );
  const start = startCut >= 0 ? startCut + 2 : 0;
  const after = flat.slice(m);
  const endRel = after.search(/[.!?…](?:\s|$)(?!\s*[а-яё])/);
  const end = endRel >= 0 ? m + endRel + 1 : flat.length;
  const s = flat.slice(start, end).trim();
  return s.length >= 10 && s.length <= 600 ? s : null;
}

/** №1: type the word that fills the gap «<…>» of the text. */
export function gapWordItems(row: QuizTaskRow): QuizItem[] {
  if (!row.passageMd || !/месте пропуска/.test(row.conditionMd)) return [];
  const gaps = row.passageMd.match(/<…>|<\.\.\.>/g) ?? [];
  if (gaps.length !== 1) return [];
  const sentence = sentenceWith(row.passageMd, /<…>|<\.\.\.>/);
  if (!sentence) return [];
  const key = normalizeWord(row.correctAnswer);
  if (!key) return [];
  const explanation = explanationWhole(row.explanationMd);
  return [
    {
      key: `${row.id}:all`,
      taskId: row.id,
      kind: 'input',
      text: sentence.replace(/<…>|<\.\.\.>/, '▢'),
      prompt: firstLine(row.conditionMd)
        .replace(/^Самостоятельно подберите/, 'Подбери')
        .replace(/\s*Запишите.*$/, ''),
      correct: key,
      accepted: (row.acceptedAnswers ?? []).map(normalizeWord).filter(Boolean),
      display: row.correctAnswer.trim(),
      ...(explanation ? { explanation } : {}),
    },
  ];
}

/**
 * №2: one question per dictionary entry — does the meaning fit the word
 * in the text? The text's sentence with the bold word is shown with it.
 */
export function wordMeaningItems(row: QuizTaskRow): QuizItem[] {
  if (!row.passageMd || !/лексическое значение/.test(firstLine(row.conditionMd))) return [];
  const entries = numberedLines(row.conditionMd);
  const bold = [...row.passageMd.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1]!.trim());
  const key = digitSet(row.correctAnswer);
  if (entries.size !== 5 || bold.length !== 5 || !/^[1-5]+$/.test(key)) return [];
  const items: QuizItem[] = [];
  for (const [n, entry] of entries) {
    const word = bold[n - 1]!;
    const head = entry.match(/^([А-ЯЁ-]{2,})/)?.[1];
    if (!head || commonStart(normalizeWord(head), normalizeWord(word)) < 3) return [];
    const sentence = sentenceWith(
      row.passageMd,
      new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
    if (!sentence) return [];
    const yes = key.includes(String(n));
    const explanation = explanationPart(row.explanationMd, n);
    items.push({
      key: `${row.id}:${n}`,
      taskId: row.id,
      kind: 'choice',
      text: `${sentence}\n\n${entry}`,
      prompt: `Значение подходит к слову «${word}» в этом предложении?`,
      options: [YES, NO],
      correct: yes ? YES : NO,
      display: yes ? YES : NO,
      ...(explanation ? { explanation } : {}),
    });
  }
  return items;
}

/** №8: one question per sentence — which error is in it (or none)? */
export function grammarItems(row: QuizTaskRow): QuizItem[] {
  let spec: { parts: { label: string; correctAnswer: string }[] };
  try {
    spec = JSON.parse(row.correctAnswer) as typeof spec;
  } catch {
    return [];
  }
  const md = row.conditionMd;
  const errors = new Map<string, string>();
  for (const m of md.matchAll(/^\s*([А-Д])\)\s*(.+)$/gm)) errors.set(m[1]!, clean(m[2]!));
  const sentences = new Map<number, string>();
  for (const m of md.matchAll(/^\s*(\d)\)\s*(.+)$/gm)) sentences.set(Number(m[1]), clean(m[2]!));
  if (errors.size !== 5 || sentences.size < 6 || spec.parts?.length !== 5) return [];
  const letterOf = new Map<number, string>();
  for (const p of spec.parts) {
    const n = Number(p.correctAnswer);
    if (!Number.isInteger(n) || !sentences.has(n) || letterOf.has(n)) return [];
    letterOf.set(n, p.label);
  }
  const NONE = 'Ошибки нет';
  const options = [...[...errors.values()].map((e) => capitalize(e)), NONE];
  return [...sentences].map(([n, text]) => {
    const letter = letterOf.get(n);
    const answer = letter ? capitalize(errors.get(letter)!) : NONE;
    const explanation = letter
      ? explanationLetter(row.explanationMd, letter)
      : 'По ключу задания в этом предложении нет ни одной из пяти ошибок, перечисленных в задании.';
    return {
      key: `${row.id}:${n}`,
      taskId: row.id,
      kind: 'choice' as const,
      text,
      prompt: 'Какая грамматическая ошибка в предложении?',
      options,
      correct: answer,
      display: answer,
      ...(explanation ? { explanation } : {}),
    };
  });
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** №22: one question per fragment А–Д — which means of expression? */
export function expressiveItems(row: QuizTaskRow): QuizItem[] {
  let spec: { parts: { label: string; correctAnswer: string }[] };
  try {
    spec = JSON.parse(row.correctAnswer) as typeof spec;
  } catch {
    return [];
  }
  const md = row.conditionMd;
  const fragments = new Map<string, string>();
  for (const m of md.matchAll(/^\s*([А-Д])\)\s*(.+)$/gm)) fragments.set(m[1]!, clean(m[2]!));
  const means = new Map<number, string>();
  for (const m of md.matchAll(/^\s*(\d)\)\s*(.+)$/gm)) means.set(Number(m[1]), clean(m[2]!));
  if (fragments.size !== 5 || means.size < 6 || spec.parts?.length !== 5) return [];
  const options = [...means.values()];
  const items: QuizItem[] = [];
  for (const p of spec.parts) {
    const text = fragments.get(p.label);
    const mean = means.get(Number(p.correctAnswer));
    if (!text || !mean) return [];
    const explanation = explanationLetter(row.explanationMd, p.label);
    items.push({
      key: `${row.id}:${p.label}`,
      taskId: row.id,
      kind: 'choice',
      text,
      prompt: 'Какое средство выразительности здесь?',
      options,
      correct: mean,
      display: mean,
      ...(explanation ? { explanation } : {}),
    });
  }
  return items;
}

/** «Из предложений 14–16» → [14, 15, 16]; «предложения 5» → [5]. */
export function sentenceRange(head: string): number[] | null {
  const m = head.match(/предложени[йяе]\s+(\d+)\s*(?:[–—-]\s*(\d+)|,\s*(\d+))?/);
  if (!m) return null;
  const a = Number(m[1]);
  if (m[2]) {
    const b = Number(m[2]);
    return b >= a && b - a <= 8 ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : null;
  }
  return m[3] ? [a, Number(m[3])] : [a];
}

/** Russian words of a text, in order. */
export const wordsOf = (s: string): string[] =>
  [...s.matchAll(/[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*/g)].map((m) => normalizeWord(m[0]));

/**
 * Tokens (by index) whose words, in some order, spell `key` exactly —
 * the player taps them. Null when the key cannot be formed from up to
 * four words of the text.
 */
export function keyTokens(key: string, words: readonly string[]): number[] | null {
  const k = normalizeWord(key);
  const search = (rest: string, used: number[]): number[] | null => {
    if (rest === '') return used;
    if (used.length >= 4) return null;
    for (let i = 0; i < words.length; i++) {
      if (used.includes(i) || !words[i] || !rest.startsWith(words[i]!)) continue;
      const r = search(rest.slice(words[i]!.length), [...used, i]);
      if (r) return r;
    }
    return null;
  };
  return k ? search(k, []) : null;
}

/** №25: tap the words of the given sentences that answer the prompt. */
export function findInTextItems(row: QuizTaskRow): QuizItem[] {
  const head = firstLine(row.conditionMd);
  const numbers = sentenceRange(head);
  const passage = row.passageMd ?? '';
  if (!numbers || !passage || !/выпишите/.test(head)) return [];
  const parts = numbers.map((n) => {
    const m = passage.match(new RegExp(`\\(${n}\\)([^(]*?)(?=\\s*\\(${n + 1}\\)|\\n\\n|$)`));
    return m ? `(${n})${clean(m[1]!)}` : null;
  });
  if (parts.some((p) => p === null)) return [];
  const text = parts.join(' ');
  const raw = [...text.matchAll(/[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*/g)].map((m) => m[0]);
  const tokens = keyTokens(row.correctAnswer, raw.map(normalizeWord));
  if (!tokens) return [];
  // Shown as the words of the text, in text order: «так сказать».
  const shown = [...tokens]
    .sort((a, b) => a - b)
    .map((i) => raw[i]!.toLowerCase())
    .join(' ');
  const explanation = explanationWhole(row.explanationMd);
  return [
    {
      key: `${row.id}:all`,
      taskId: row.id,
      kind: 'words',
      text,
      prompt: head.replace(/\s*Запишите.*$/, ''),
      correct: normalizeWord(row.correctAnswer),
      accepted: (row.acceptedAnswers ?? []).map(normalizeWord).filter(Boolean),
      display: shown,
      ...(explanation ? { explanation } : {}),
    },
  ];
}

/** Math part 1: a short numeric answer, typed (no figure needed). */
export function inputItems(row: QuizTaskRow): QuizItem[] {
  if (row.imageUrl) return [];
  const key = normalizeNumber(row.correctAnswer);
  const text = row.conditionMd.trim();
  if (key === null || text.length > 700 || /!\[|<img|рисун|изображ|график/i.test(text)) return [];
  const accepted = (row.acceptedAnswers ?? [])
    .map(normalizeNumber)
    .filter((x): x is string => x !== null);
  const explanation = explanationWhole(row.explanationMd);
  return [
    {
      key: `${row.id}:all`,
      taskId: row.id,
      kind: 'input',
      text,
      correct: key,
      accepted,
      display: row.correctAnswer.trim(),
      ...(explanation ? { explanation } : {}),
    },
  ];
}

// ---------------------------------------------------------------- checking

/**
 * Is `answer` right for `item`? `choice`: the option itself; `slots`: the
 * same set of places in any order; `input`: the key or an accepted one
 * (words: case, «ё», spaces ignored; numbers: «0,5» = «0.5»); `words`: the
 * tapped words, in any order, spell the key.
 */
export function checkQuizAnswer(item: QuizItem, answer: string): boolean {
  const keys = [item.correct, ...(item.accepted ?? [])];
  switch (item.kind) {
    case 'choice':
      return answer === item.correct;
    case 'slots':
      return digitSet(answer) === digitSet(item.correct);
    case 'input': {
      const asNumber = normalizeNumber(answer);
      if (asNumber !== null && keys.includes(asNumber)) return true;
      return keys.includes(normalizeWord(answer));
    }
    case 'words': {
      const tapped = answer.split(/\s+/).map(normalizeWord).filter(Boolean);
      if (tapped.length === 0 || tapped.length > 4) return false;
      return permutations(tapped).some((p) => keys.includes(p.join('')));
    }
  }
}

function permutations<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [[...xs]];
  return xs.flatMap((x, i) =>
    permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]),
  );
}

// ------------------------------------------------------------------- games

export interface QuizGameInfo {
  readonly id: string;
  readonly title: string;
  readonly subjectId: 'russian' | 'math';
  readonly topic: QuizTopic;
  readonly egeTask: string;
  readonly description: string;
  /** Shown above every question unless the question has its own prompt. */
  readonly instruction: string;
}

export const QUIZ_GAMES: readonly QuizGameInfo[] = [
  {
    id: 'root-vowels',
    title: 'Гласные в корне',
    subjectId: 'russian',
    topic: 'orthography',
    egeTask: 'Задание 9',
    description: 'Безударные, чередующиеся и непроверяемые гласные — по рядам слов из задания 9.',
    instruction: 'Во всех словах ряда пропущена одна и та же буква?',
  },
  {
    id: 'prefixes',
    title: 'Приставки',
    subjectId: 'russian',
    topic: 'orthography',
    egeTask: 'Задание 10',
    description: 'ПРЕ- и ПРИ-, З и С на конце приставок, Ъ и Ь — по рядам из задания 10.',
    instruction: 'Во всех словах ряда пропущена одна и та же буква?',
  },
  {
    id: 'suffixes-endings',
    title: 'Суффиксы и окончания',
    subjectId: 'russian',
    topic: 'orthography',
    egeTask: 'Задания 11–12',
    description: 'Суффиксы разных частей речи, личные окончания глаголов и суффиксы причастий.',
    instruction: 'В обоих словах пропущена одна и та же буква?',
  },
  {
    id: 'ne-together',
    title: 'НЕ и НИ',
    subjectId: 'russian',
    topic: 'orthography',
    egeTask: 'Задание 13',
    description: 'Слитно или раздельно НЕ (НИ) с разными частями речи — предложения задания 13.',
    instruction: 'НЕ (НИ) с выделенным словом пишется…',
  },
  {
    id: 'hyphen',
    title: 'Слитно, раздельно, через дефис',
    subjectId: 'russian',
    topic: 'orthography',
    egeTask: 'Задание 14',
    description: 'Наречия, союзы, предлоги и частицы — предложения задания 14.',
    instruction: 'Как пишутся выделенные слова?',
  },
  {
    id: 'nn',
    title: 'Н и НН',
    subjectId: 'russian',
    topic: 'orthography',
    egeTask: 'Задание 15',
    description: 'Н или НН в прилагательных, причастиях и наречиях — по предложениям задания 15.',
    instruction: 'Н или НН на месте пропуска?',
  },
  {
    id: 'one-comma',
    title: 'Одна запятая',
    subjectId: 'russian',
    topic: 'punctuation',
    egeTask: 'Задание 16',
    description: 'Однородные члены и части сложносочинённого предложения — нужна ли одна запятая.',
    instruction: 'Нужна ровно одна запятая?',
  },
  {
    id: 'commas',
    title: 'Расстановка знаков препинания',
    subjectId: 'russian',
    topic: 'punctuation',
    egeTask: 'Задания 17–20',
    description: 'Обособления, вводные слова, сложные предложения — отметь места запятых.',
    instruction: 'Отметь цифры, на месте которых нужна запятая.',
  },
  {
    id: 'grammar-detective',
    title: 'Грамматические нормы',
    subjectId: 'russian',
    topic: 'norms',
    egeTask: 'Задание 8',
    description: 'Найди грамматическую ошибку в предложении — или убедись, что её нет.',
    instruction: 'Какая грамматическая ошибка в предложении?',
  },
  {
    id: 'paronyms',
    title: 'Паронимы',
    subjectId: 'russian',
    topic: 'norms',
    egeTask: 'Задание 5',
    description: 'Найди слово, употреблённое вместо своего паронима.',
    instruction: 'Какое выделенное слово употреблено неверно?',
  },
  {
    id: 'word-errors',
    title: 'Ошибка в слове',
    subjectId: 'russian',
    topic: 'norms',
    egeTask: 'Задание 7',
    description: 'Найди неверно образованную форму слова.',
    instruction: 'В каком выделенном слове ошибка в форме?',
  },
  {
    id: 'gap-word',
    title: 'Пропущенное слово',
    subjectId: 'russian',
    topic: 'text',
    egeTask: 'Задание 1',
    description: 'Подбери союз, частицу или местоимение на месте пропуска в тексте.',
    instruction: 'Какое слово стоит на месте пропуска?',
  },
  {
    id: 'word-meaning',
    title: 'Значение слова в тексте',
    subjectId: 'russian',
    topic: 'text',
    egeTask: 'Задание 2',
    description: 'Подходит ли словарное значение к слову в предложении текста.',
    instruction: 'Значение подходит к слову в этом предложении?',
  },
  {
    id: 'expressive',
    title: 'Средства выразительности',
    subjectId: 'russian',
    topic: 'text',
    egeTask: 'Задание 22',
    description: 'Анафора, антитеза, литота и другие — определи средство во фрагменте.',
    instruction: 'Какое средство выразительности здесь?',
  },
  {
    id: 'find-in-text',
    title: 'Фразеологизмы и антонимы',
    subjectId: 'russian',
    topic: 'text',
    egeTask: 'Задание 25',
    description: 'Найди в предложениях текста фразеологизм, антонимы или слово с нужным значением.',
    instruction: 'Отметь нужные слова в тексте.',
  },
  {
    id: 'probability-blitz',
    title: 'Теория вероятностей',
    subjectId: 'math',
    topic: 'math-part1',
    egeTask: 'Задание 4',
    description: 'Классическая вероятность — короткие задачи с ответом-числом.',
    instruction: 'Найди вероятность. Ответ — число (десятичной дробью).',
  },
  {
    id: 'expressions-blitz',
    title: 'Вычисления',
    subjectId: 'math',
    topic: 'math-part1',
    egeTask: 'Задание 7',
    description: 'Значения выражений: степени, корни, логарифмы, тригонометрия.',
    instruction: 'Найди значение выражения.',
  },
];

export const quizGameById = (id: string): QuizGameInfo | undefined =>
  QUIZ_GAMES.find((g) => g.id === id);

// --------------------------------------------------------------------- API

export const quizModes = ['all', 'mistakes'] as const;
export type QuizMode = (typeof quizModes)[number];

export const quizRoundQuerySchema = z.object({
  mode: z.enum(quizModes).default('all'),
  size: z.coerce.number().int().min(5).max(20).default(QUIZ_ROUND_SIZE),
});

/** A question as the player gets it — no key. */
export interface QuizQuestion {
  readonly itemId: string;
  readonly kind: QuizKind;
  readonly text: string;
  readonly options?: readonly string[];
  readonly slots?: readonly number[];
  /** This question's own wording, when it differs from the game's instruction. */
  readonly prompt?: string;
}

export interface QuizRoundResponse {
  readonly gameId: string;
  readonly mode: QuizMode;
  readonly questions: readonly QuizQuestion[];
  /** Questions the game has in total. */
  readonly bankSize: number;
  readonly sessionId: string | null;
}

export const quizAnswerRequestSchema = z.object({
  itemId: z.uuid(),
  answer: z.string().max(200),
  clientAnswerId: z.uuid(),
  sessionId: z.uuid().optional(),
});
export type QuizAnswerRequest = z.infer<typeof quizAnswerRequestSchema>;

export interface QuizAnswerResponse {
  readonly correct: boolean;
  /** The right answer as shown. */
  readonly display: string;
  /** `choice`: the right option; `slots`: the right places. */
  readonly correctOption?: string;
  readonly correctSlots?: readonly number[];
  /** The task's own explanation of this question, when there is one. */
  readonly explanation?: string;
  /** Saved for this account (false for a guest, or a repeat in the same round). */
  readonly recorded: boolean;
  /** The task this question comes from (for «Пожаловаться»). */
  readonly taskId: string;
}

export interface QuizProgressResponse {
  readonly gameId: string;
  readonly bankSize: number;
  /** Questions answered right `MINI_GAME_LEARNED_STREAK` times in a row. */
  readonly learned: number;
  readonly seen: number;
  readonly answers: number;
  readonly correct: number;
  readonly accuracyPercent: number | null;
  /** Questions whose last answer was wrong — «Мои ошибки». */
  readonly mistakes: number;
  /** Best finished round, in points (10 per right, +20 perfect); null before one. */
  readonly bestScore: number | null;
  readonly rounds: number;
}
