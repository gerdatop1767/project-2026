import { answerText, type BankNumber, type BankTask } from './types.js';
import { highlightsOf } from './build.js';

/**
 * Deterministic checks of the bank (docs/imports/zybrilka-russian-4-22-plan.md §5).
 * Returns every problem; empty = ready to import. `complete` requires the
 * full 100 tasks with the 30 / 40 / 30 difficulty split.
 */
export const BANK_SIZE = 100;
export const DIFFICULTY_SPLIT = { 1: 30, 2: 40, 3: 30 } as const;

const ANSWER_TYPE: Record<number, BankTask['answer']['type']> = {
  4: 'digits',
  5: 'word',
  6: 'word',
  7: 'word',
  8: 'match',
  22: 'match',
};
export const answerTypeFor = (taskNumber: number) => ANSWER_TYPE[taskNumber] ?? 'digits';

const normalize = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

export function validateTask(t: BankTask): string[] {
  const p: string[] = [];
  const where = `№${t.taskNumber}.${t.n}`;
  if (t.taskNumber < 4 || t.taskNumber > 22 || t.taskNumber === 10)
    p.push(`${where}: task number out of the bank`);
  if (t.answer.type !== answerTypeFor(t.taskNumber))
    p.push(`${where}: answer type ${t.answer.type}, expected ${answerTypeFor(t.taskNumber)}`);
  const a = t.answer;
  if (a.type === 'digits') {
    if (!/^[1-9]+$/.test(a.digits)) p.push(`${where}: digits answer «${a.digits}»`);
    if ([...a.digits].sort().join('') !== a.digits || new Set(a.digits).size !== a.digits.length)
      p.push(`${where}: digits must ascend without repeats`);
  } else if (a.type === 'word') {
    for (const w of [a.word, ...a.accepted]) {
      if (!/^[а-яё]+(-[а-яё]+)?$/.test(w)) p.push(`${where}: word answer «${w}»`);
    }
    if (new Set([a.word, ...a.accepted].map(normalize)).size !== a.accepted.length + 1)
      p.push(`${where}: accepted answers repeat`);
  } else {
    if (a.parts.some((d) => !/^[1-9]$/.test(d)) || new Set(a.parts).size !== 5)
      p.push(`${where}: match answer must be 5 different digits 1–9`);
  }
  if (t.explanationMd.length < 200) p.push(`${where}: explanation is too short`);
  if (!t.explanationMd.trim().endsWith(`Ответ: ${answerText(t.answer)}.`))
    p.push(`${where}: explanation must end with «Ответ: ${answerText(t.answer)}.»`);
  if (!t.explanationMd.includes('**Обрати внимание.**')) p.push(`${where}: no «Обрати внимание»`);
  if (t.hintMd.trim().length < 20) p.push(`${where}: hint is missing`);
  if (/[{}]/.test(t.conditionMd)) p.push(`${where}: unrendered {highlight} in the condition`);
  for (const text of [t.conditionMd, t.explanationMd, t.hintMd])
    if (/[а-яё][a-z]|[a-z][а-яё]/i.test(text))
      p.push(`${where}: Latin and Cyrillic letters mixed in a word`);
  if (/\b(ФИПИ|Дощинск)/i.test(t.conditionMd))
    p.push(`${where}: the condition names another source`);
  return p;
}

/** Mechanic-specific source checks, on the author data (before building). */
export function checkHighlighted(where: string, sentences: readonly string[], count = 1): string[] {
  return sentences.flatMap((s, k) =>
    highlightsOf(s).length === count
      ? []
      : [`${where}: sentence ${k + 1} must have ${count} {highlight}`],
  );
}

export function validateNumber(
  bank: BankNumber,
  opts: { complete: boolean; extraConditions?: ReadonlySet<string> },
): string[] {
  const p: string[] = [];
  const t = bank.tasks;
  const where = `№${bank.taskNumber}`;
  if (t.some((x) => x.taskNumber !== bank.taskNumber)) p.push(`${where}: a task of another number`);
  if (t.map((x) => x.n).some((n, i) => n !== i + 1)) p.push(`${where}: tasks must be numbered 1…N`);
  if (t.length > BANK_SIZE) p.push(`${where}: more than ${BANK_SIZE} tasks`);
  if (opts.complete) {
    if (t.length !== BANK_SIZE) p.push(`${where}: ${t.length} of ${BANK_SIZE} tasks`);
    for (const d of [1, 2, 3] as const) {
      const got = t.filter((x) => x.difficulty === d).length;
      if (got !== DIFFICULTY_SPLIT[d])
        p.push(`${where}: difficulty ${d}: ${got}, expected ${DIFFICULTY_SPLIT[d]}`);
    }
  }
  if (t.length >= 10 && new Set(t.map((x) => x.kind)).size < 3)
    p.push(`${where}: fewer than 3 kinds`);
  const seen = new Set<string>();
  for (const x of t) {
    p.push(...validateTask(x));
    const key = normalize(x.conditionMd);
    if (seen.has(key)) p.push(`№${x.taskNumber}.${x.n}: duplicates another task`);
    if (opts.extraConditions?.has(key)) p.push(`№${x.taskNumber}.${x.n}: repeats an existing task`);
    seen.add(key);
  }
  return p;
}

export { normalize as normalizeCondition };
