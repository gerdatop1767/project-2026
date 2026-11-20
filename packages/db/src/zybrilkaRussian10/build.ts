import { checkWord, explainWord, orthogramOf, parseWord, type Word } from './rules.js';
import type { AuthoredTask10 } from './tasks.js';

/** The instruction of ЕГЭ task 10, word for word as the imported tasks have it. */
export const TASK10_INSTRUCTION =
  'Укажите варианты ответов, в которых во всех словах одного ряда пропущена одна и та же буква. Запишите номера ответов.';

export interface BuiltTask10 {
  readonly n: number;
  readonly difficulty: 1 | 2 | 3;
  readonly conditionMd: string;
  /** Row numbers whose three words share the letter, ascending: «135». */
  readonly correctAnswer: string;
  readonly correctAnswerDisplay: string;
  readonly explanationMd: string;
  readonly hintMd: string;
  /** The condition without formatting — the base of the content hash. */
  readonly rawStatement: string;
  readonly status: 'published' | 'needs_review';
  readonly reviewNote: string | null;
  /** The letter of every word, row by row (for checks). */
  readonly letters: readonly (readonly string[])[];
}

const unique = <T>(xs: readonly T[]) => [...new Set(xs)];

function rowVerdict(words: readonly Word[]): { same: boolean; text: string } {
  const letters = words.map((w) => parseWord(w.raw).letter.toUpperCase());
  const same = unique(letters).length === 1;
  return {
    same,
    text: same
      ? `во всех словах ${letters[0]}. Ряд подходит.`
      : `буквы разные (${letters.join(', ')}). Ряд не подходит.`,
  };
}

export function buildTask10(task: AuthoredTask10): BuiltTask10 {
  const rows = task.rows;
  const lines = rows.map((r, i) => `${i + 1}) ${r.map((w) => parseWord(w.raw).shown).join(', ')}`);
  const conditionMd = [TASK10_INSTRUCTION, ...lines].join('\n\n');
  const answer = rows.map((r, i) => (rowVerdict(r).same ? String(i + 1) : '')).join('');
  const kinds = unique(rows.flat().map((w) => orthogramOf(w.rule)));
  const explanation = [
    `Что дано: пять рядов по три слова с пропущенной буквой. Орфограммы: ${kinds.join('; ')}. Вставляем букву во все три слова ряда и сравниваем.`,
    ...rows.map((r, i) => {
      const v = rowVerdict(r);
      return `${i + 1}) ${r.map(explainWord).join('; ')} — ${v.text}`;
    }),
    `**Обрати внимание.** ${task.note}`,
    `Ответ: ${answer}.`,
  ].join('\n\n');
  const hint = `Раздели ряды по типу орфограммы (${kinds.join(', ')}) и в каждом ряду вставь букву во все три слова: подходит только ряд, где буква везде одна.`;
  return {
    n: task.n,
    difficulty: task.difficulty,
    conditionMd,
    correctAnswer: answer,
    correctAnswerDisplay: `${answer} (в любом порядке)`,
    explanationMd: explanation,
    hintMd: hint,
    rawStatement: conditionMd,
    status: task.review ? 'needs_review' : 'published',
    reviewNote: task.review ?? null,
    letters: rows.map((r) => r.map((w) => parseWord(w.raw).letter)),
  };
}

/** Everything wrong with the authored set; empty = ready to import. */
export function validateAuthoredTasks10(tasks: readonly AuthoredTask10[], expected = 50): string[] {
  const problems: string[] = [];
  if (tasks.length !== expected) problems.push(`expected ${expected} tasks, found ${tasks.length}`);
  const numbers = tasks.map((t) => t.n);
  if (new Set(numbers).size !== numbers.length) problems.push('task numbers repeat');
  if (numbers.some((n, i) => n !== i + 1)) problems.push('tasks must be numbered 1…N in order');
  const seenRows = new Map<string, number>();
  const seenTasks = new Set<string>();
  const wordUse = new Map<string, number>();
  for (const task of tasks) {
    const where = `№${task.n}`;
    if (task.rows.length !== 5) problems.push(`${where}: 5 rows expected`);
    for (const row of task.rows) {
      if (row.length !== 3) problems.push(`${where}: 3 words per row expected`);
      for (const w of row) {
        for (const p of checkWord(w)) problems.push(`${where}: ${p}`);
        const key = parseWord(w.raw).shown;
        wordUse.set(key, (wordUse.get(key) ?? 0) + 1);
      }
      const rowKey = row
        .map((w) => parseWord(w.raw).shown)
        .sort()
        .join('|');
      const earlier = seenRows.get(rowKey);
      if (earlier !== undefined) problems.push(`${where}: the same row as in №${earlier}`);
      else seenRows.set(rowKey, task.n);
      const inRow = row.map((w) => parseWord(w.raw).shown);
      if (new Set(inRow).size !== inRow.length) problems.push(`${where}: a word repeats in a row`);
    }
    const built = buildTask10(task);
    if (built.correctAnswer.length < 2 || built.correctAnswer.length > 4) {
      problems.push(`${where}: answer «${built.correctAnswer}» — 2 to 4 rows expected`);
    }
    const taskKey = built.conditionMd;
    if (seenTasks.has(taskKey)) problems.push(`${where}: duplicates another task`);
    seenTasks.add(taskKey);
    if (task.note.trim().length < 40) problems.push(`${where}: the note is too short`);
  }
  for (const [word, n] of wordUse) {
    if (n > 3) problems.push(`«${word}» is used ${n} times (3 at most)`);
  }
  return problems;
}
