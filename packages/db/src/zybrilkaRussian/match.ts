import { MATCH_LABELS, type BankTask, type Difficulty } from './types.js';

/**
 * Matching tasks (8, 22): five items А–Д, nine options 1–9; the answer is
 * the option number for every letter, computed from the data.
 */
export interface MatchTaskInput {
  readonly taskNumber: 8 | 22;
  readonly n: number;
  readonly difficulty: Difficulty;
  readonly kind: string;
  readonly instruction: string;
  readonly leftTitle: string;
  readonly left: readonly string[];
  readonly rightTitle: string;
  readonly right: readonly string[];
  /** For every letter, the 0-based index into `right`. */
  readonly answer: readonly number[];
  readonly intro: string;
  /** One line per letter, without the «А — 3:» prefix. */
  readonly why: readonly string[];
  readonly tip: string;
  readonly hint: string;
}

export function buildMatchTask(t: MatchTaskInput): BankTask {
  if (t.left.length !== 5 || t.right.length !== 9 || t.answer.length !== 5)
    throw new Error(`№${t.taskNumber}.${t.n}: 5 items and 9 options expected`);
  const parts = t.answer.map((i) => String(i + 1)) as unknown as readonly [
    string,
    string,
    string,
    string,
    string,
  ];
  return {
    taskNumber: t.taskNumber,
    n: t.n,
    difficulty: t.difficulty,
    kind: t.kind,
    conditionMd: [
      t.instruction,
      `**${t.leftTitle}**`,
      ...t.left.map((s, i) => `${MATCH_LABELS[i]}) ${s}`),
      `**${t.rightTitle}**`,
      ...t.right.map((s, i) => `${i + 1}) ${s}`),
      'Запишите в таблицу выбранные цифры под соответствующими буквами.',
    ].join('\n\n'),
    answer: { type: 'match', parts },
    explanationMd: [
      t.intro,
      ...t.answer.map((i, k) => `${MATCH_LABELS[k]} — ${i + 1}: ${t.right[i]} — ${t.why[k]}`),
      `**Обрати внимание.** ${t.tip}`,
      `Ответ: ${parts.map((d, i) => `${MATCH_LABELS[i]} — ${d}`).join(', ')}.`,
    ].join('\n\n'),
    hintMd: t.hint,
  };
}
