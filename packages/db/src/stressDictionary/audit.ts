import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateStressEntries } from '@zybrilka/shared';
import { STRESS_ENTRIES } from './data.js';

/**
 * Cross-check of the stress dictionary against an AUXILIARY source: task 4
 * of the EGE Russian 2027 variants (Дощинский) imported into this project
 * (docs/imports/stress-dictionary-audit-2026.md). Not an official source —
 * it can confirm that independent exam material agrees with a stress, or
 * reveal a disagreement for a human to resolve; it never changes the
 * dictionary by itself.
 *
 * Each task-4 option is a marked word («аэропортЫ»); the task's answer
 * says whether that marking is right. An option agrees with the
 * dictionary when (right and same marking) or (wrong and a different
 * marking). «ё» is compared as «е», like the variants write it.
 */
export interface Task4Option {
  readonly variant: number;
  readonly option: number;
  /** As printed, e.g. «отзЫв (на книгу)». */
  readonly text: string;
  /** Just the marked word. */
  readonly marked: string;
  readonly markedRight: boolean;
}

export type AuditVerdict = 'agrees' | 'conflict' | 'not_in_dictionary';

export interface AuditRow extends Task4Option {
  readonly verdict: AuditVerdict;
  /** The dictionary's marking of this word, when it has the word. */
  readonly dictionary: readonly string[];
}

const folder = fileURLToPath(new URL('..', import.meta.url));
const flat = (s: string) => s.replace(/ё/g, 'е').replace(/Ё/g, 'Е');

/** Task 4 of every imported Дощинский 2027 variant, parsed from its importer. */
export function readTask4Options(): Task4Option[] {
  const files = readdirSync(folder).filter((f) =>
    /^importRussianDoshchinsky2027Variant\d+\.ts$/.test(f),
  );
  const out: Task4Option[] = [];
  for (const file of files) {
    const variant = Number(/Variant(\d+)\.ts$/.exec(file)![1]);
    const source = readFileSync(`${folder}/${file}`, 'utf-8');
    const block = source.slice(source.indexOf('taskNumber: 4,'));
    const raw = /rawStatement:\s*'([^']*)'/.exec(block)?.[1];
    const answer = /correctAnswer: '(\d+)'/.exec(block)?.[1];
    if (!raw || !answer) throw new Error(`${file}: task 4 not found`);
    for (const line of raw.split('\\n')) {
      const m = /^(\d)\)\s*(.+)$/.exec(line.trim());
      if (!m) continue;
      const text = m[2]!.trim();
      const word = text.split(/\s+/).find((w) => /[А-ЯЁ]/.test(w) && /^[а-яёА-ЯЁ-]+$/.test(w));
      if (!word) throw new Error(`${file}: no marked word in «${text}»`);
      out.push({
        variant,
        option: Number(m[1]),
        text,
        marked: word,
        markedRight: answer.includes(m[1]!),
      });
    }
  }
  return out.sort((a, b) => a.variant - b.variant || a.option - b.option);
}

export function auditDictionary(options: readonly Task4Option[] = readTask4Options()): AuditRow[] {
  const { entries } = validateStressEntries(STRESS_ENTRIES);
  const byWord = new Map<string, string[]>();
  for (const e of entries) {
    const key = flat(e.word);
    byWord.set(key, [...(byWord.get(key) ?? []), flat(e.marked)]);
  }
  return options.map((o) => {
    const dictionary = byWord.get(flat(o.marked.toLowerCase())) ?? [];
    if (dictionary.length === 0) return { ...o, verdict: 'not_in_dictionary', dictionary };
    const same = dictionary.includes(flat(o.marked));
    const agrees = o.markedRight ? same : !same;
    return { ...o, verdict: agrees ? 'agrees' : 'conflict', dictionary };
  });
}
