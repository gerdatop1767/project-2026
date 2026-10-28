import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateStressEntries, type ParsedStressEntry } from '@zybrilka/shared';
import { STRESS_ENTRIES } from './data.js';

/**
 * Answer keys of task 4 (stress) in the project's Дощинский 2027 variants,
 * checked against FIPI's «Орфоэпический список – 2026» — the stress
 * dictionary, which is that list one to one
 * (docs/imports/task-4-audit-2027.md).
 *
 * The book has no answer keys: every key here was derived at import from
 * the transcribed options. For each option the list decides whether its
 * marked letter is right; the key must be exactly the set of right
 * options. A homograph («отзыв») is decided by the option's own context
 * matched against the meaning note of the list («о книге» → «Отзыв»,
 * «посла» → «отзЫв»); an option the list cannot decide makes the whole
 * task `manual`.
 */
export interface Task4Option {
  readonly option: number;
  /** As printed, e.g. «отзЫв (на книгу)». */
  readonly text: string;
  /** Just the marked word. */
  readonly marked: string;
  /** Right by the official list; null when it cannot decide. */
  readonly officialRight: boolean | null;
  /** The list's form it was decided by. */
  readonly official: string | null;
}

export type Task4Verdict = 'confirmed' | 'mismatch' | 'manual';

export interface Task4Check {
  readonly variant: number;
  readonly status: string;
  readonly key: string;
  readonly options: readonly Task4Option[];
  /** The key the official list gives, digits ascending; null if undecidable. */
  readonly expectedKey: string | null;
  readonly verdict: Task4Verdict;
}

const folder = fileURLToPath(new URL('..', import.meta.url));
const flat = (s: string) => s.replace(/ё/g, 'е').replace(/Ё/g, 'Е');
const digitsSorted = (s: string) => [...s].sort().join('');
/** Stems of the meaning note's longer words — «о книге» → «книг». */
const stems = (note: string | null) =>
  (note ?? '')
    .toLowerCase()
    .split(/[^а-яё]+/)
    .filter((w) => w.length >= 5)
    .map((w) => w.slice(0, 4));

function decide(
  text: string,
  marked: string,
  forms: readonly ParsedStressEntry[],
): Pick<Task4Option, 'officialRight' | 'official'> {
  if (forms.length === 0) return { officialRight: null, official: null };
  let candidates = forms;
  if (new Set(forms.map((f) => f.marked)).size > 1) {
    const context = text.toLowerCase();
    candidates = forms.filter((f) => stems(f.formNote).some((s) => context.includes(s)));
    if (new Set(candidates.map((f) => f.marked)).size !== 1) {
      return { officialRight: null, official: null };
    }
  }
  const official = candidates[0]!.marked;
  return { officialRight: flat(official) === flat(marked), official };
}

const field = (block: string, name: string) =>
  new RegExp(`${name}:\\s*'((?:[^'\\\\]|\\\\.)*)'`).exec(block)?.[1];

export function checkTask4Keys(): Task4Check[] {
  const { entries } = validateStressEntries(STRESS_ENTRIES);
  const byWord = new Map<string, ParsedStressEntry[]>();
  for (const e of entries) byWord.set(flat(e.word), [...(byWord.get(flat(e.word)) ?? []), e]);

  const files = readdirSync(folder).filter((f) =>
    /^importRussianDoshchinsky2027Variant\d+\.ts$/.test(f),
  );
  const out: Task4Check[] = [];
  for (const file of files) {
    const variant = Number(/Variant(\d+)\.ts$/.exec(file)![1]);
    const source = readFileSync(`${folder}/${file}`, 'utf-8');
    const start = source.indexOf('taskNumber: 4,');
    const block = source.slice(start, source.indexOf('taskNumber: 5,', start));
    const raw = field(block, 'rawStatement');
    const key = field(block, 'correctAnswer');
    const status = field(block, 'status');
    if (!raw || key === undefined || !status) throw new Error(`${file}: task 4 not found`);
    const options: Task4Option[] = [];
    for (const line of raw.split('\\n')) {
      const m = /^(\d)\)\s*(.+)$/.exec(line.trim());
      if (!m) continue;
      const text = m[2]!.trim();
      const marked = text.split(/\s+/).find((w) => /[А-ЯЁ]/.test(w) && /^[а-яёА-ЯЁ-]+$/.test(w));
      if (!marked) throw new Error(`${file}: no marked word in «${text}»`);
      options.push({
        option: Number(m[1]),
        text,
        marked,
        ...decide(text, marked, byWord.get(flat(marked.toLowerCase())) ?? []),
      });
    }
    const undecided = options.some((o) => o.officialRight === null);
    const expectedKey = undecided
      ? null
      : options
          .filter((o) => o.officialRight)
          .map((o) => String(o.option))
          .join('');
    out.push({
      variant,
      status,
      key,
      options,
      expectedKey,
      verdict:
        expectedKey === null
          ? 'manual'
          : digitsSorted(key) === expectedKey
            ? 'confirmed'
            : 'mismatch',
    });
  }
  return out.sort((a, b) => a.variant - b.variant);
}
