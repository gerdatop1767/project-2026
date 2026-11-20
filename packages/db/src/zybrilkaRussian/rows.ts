import { digitsOf, rng, shuffle, type BankTask, type Difficulty } from './types.js';

/**
 * «Rows with a missing letter» (tasks 9, 11, 12): the author writes each
 * word once — `ист[и]нный` (the letter in brackets, context in
 * parentheses), its spelling category and a note; the generator builds
 * rows and tasks from them. The answer is computed from the letters and
 * the explanation from the notes, so they always agree.
 */
export interface RowWordSpec {
  /** `ист[и]нный`, `(местные) ст[а]рожилы`. */
  readonly raw: string;
  /** Category code; the number's `categories` give its title and difficulty. */
  readonly cat: string;
  readonly note: string;
}

export interface RowWord extends RowWordSpec {
  /** As shown in the task: `ист..нный`. */
  readonly shown: string;
  /** Filled, with the letter as a capital: `истИнный`. */
  readonly filled: string;
  readonly letter: string;
}

export function parseRowWord(spec: RowWordSpec): RowWord {
  const m = spec.raw.match(/^(.*)\[(.+?)\](.*)$/);
  if (!m) throw new Error(`no [letter] in «${spec.raw}»`);
  const [, before, letter, after] = m as unknown as [string, string, string, string];
  return {
    ...spec,
    shown: `${before}..${after}`,
    filled: `${before}${letter.toUpperCase()}${after}`,
    letter: letter.toUpperCase(),
  };
}

export interface RowsNumberSpec {
  readonly taskNumber: number;
  readonly perRow: 2 | 3;
  readonly instruction: string;
  readonly intro: string;
  /** code → [how a word of it is explained, is it a trap (harder)]. */
  readonly categories: Readonly<
    Record<string, { readonly label: string; readonly hard: boolean; readonly quote?: boolean }>
  >;
  /** Tip for «Обрати внимание», by the hardest category present. */
  readonly tips: Readonly<Record<string, string>>;
  readonly hint: string;
  readonly kindOf: (words: readonly RowWord[]) => string;
}

const sameLetter = (row: readonly RowWord[]) => new Set(row.map((w) => w.letter)).size === 1;

export function explainRowWord(w: RowWord, spec: RowsNumberSpec): string {
  const c = spec.categories[w.cat]!;
  const note = w.note ? (c.quote ? ` «${w.note}»` : `: ${w.note}`) : '';
  return `${w.filled} — ${c.label}${note}`;
}

export function buildRowsTask(
  n: number,
  rows: readonly (readonly RowWord[])[],
  difficulty: Difficulty,
  spec: RowsNumberSpec,
): BankTask {
  const flags = rows.map(sameLetter);
  const digits = digitsOf(flags);
  const cats = new Set(rows.flat().map((w) => w.cat));
  const tipCat = Object.keys(spec.tips).find((c) => cats.has(c)) ?? Object.keys(spec.tips).at(-1)!;
  return {
    taskNumber: spec.taskNumber,
    n,
    difficulty,
    kind: spec.kindOf(rows.flat()),
    conditionMd: [
      spec.instruction,
      ...rows.map((r, i) => `${i + 1}) ${r.map((w) => w.shown).join(', ')}`),
    ].join('\n\n'),
    answer: { type: 'digits', digits },
    explanationMd: [
      spec.intro,
      ...rows.map((r, i) => {
        const letters = r.map((w) => w.letter);
        const verdict = flags[i]
          ? `во всех словах ${letters[0]}. Ряд подходит.`
          : `буквы разные (${letters.join(', ')}). Ряд не подходит.`;
        return `${i + 1}) ${r.map((w) => explainRowWord(w, spec)).join('; ')} — ${verdict}`;
      }),
      `**Обрати внимание.** ${spec.tips[tipCat]}`,
      `Ответ: ${digits}.`,
    ].join('\n\n'),
    hintMd: spec.hint,
  };
}

/**
 * Generates `count` tasks. Every task has 5 rows; 2–4 of them «same
 * letter». A «different» row usually differs in one word only (the
 * trap). A word is used at most `maxUses` times and never twice in a
 * task; no row repeats. Difficulty ranks the tasks by traps and hard
 * categories into 30 / 40 / 30 per hundred.
 */
export function generateRowsTasks(
  words: readonly RowWord[],
  spec: RowsNumberSpec,
  count: number,
  seed: number,
  firstN = 1,
  maxUses = 8,
): BankTask[] {
  const shownSeen = new Map<string, string>();
  for (const w of words) {
    const prev = shownSeen.get(w.shown);
    if (prev !== undefined)
      throw new Error(`task ${spec.taskNumber}: «${w.shown}» is ambiguous (${prev} / ${w.filled})`);
    shownSeen.set(w.shown, w.filled);
  }
  const rand = rng(seed);
  const uses = new Map<string, number>();
  const seenRows = new Set<string>();
  const byLetter = new Map<string, RowWord[]>();
  for (const w of words) byLetter.set(w.letter, [...(byLetter.get(w.letter) ?? []), w]);
  const letters = [...byLetter.keys()].filter((l) => byLetter.get(l)!.length >= spec.perRow);

  const fresh = (pool: readonly RowWord[], taken: Set<string>) =>
    shuffle(pool, rand)
      .filter((w) => !taken.has(w.filled) && (uses.get(w.filled) ?? 0) < maxUses)
      .sort((a, b) => (uses.get(a.filled) ?? 0) - (uses.get(b.filled) ?? 0));

  const drafts: { rows: RowWord[][]; score: number }[] = [];
  let guard = 0;
  while (drafts.length < count) {
    if (++guard > count * 200)
      throw new Error(`task ${spec.taskNumber}: cannot build enough tasks`);
    const sameCount = [2, 2, 3, 3, 3, 4][Math.floor(rand() * 6)]!;
    const plan = shuffle(
      [0, 1, 2, 3, 4].map((i) => i < sameCount),
      rand,
    );
    const taken = new Set<string>();
    const rows: RowWord[][] = [];
    let ok = true;
    for (const same of plan) {
      let row: RowWord[] | null = null;
      for (let attempt = 0; attempt < 30 && !row; attempt++) {
        const l = letters[Math.floor(rand() * letters.length)]!;
        const pick = fresh(byLetter.get(l)!, taken);
        if (same) {
          if (pick.length >= spec.perRow) row = pick.slice(0, spec.perRow);
        } else {
          const others = fresh(
            words.filter((w) => w.letter !== l),
            taken,
          );
          const k = spec.perRow === 3 && rand() < 0.75 ? 2 : 1;
          if (pick.length >= k && others.length >= spec.perRow - k)
            row = shuffle([...pick.slice(0, k), ...others.slice(0, spec.perRow - k)], rand);
        }
        if (row) {
          const key = row
            .map((w) => w.filled)
            .sort()
            .join('|');
          if (seenRows.has(key) || sameLetter(row) !== same) row = null;
        }
      }
      if (!row) {
        ok = false;
        break;
      }
      for (const w of row) taken.add(w.filled);
      rows.push(row);
    }
    if (!ok) continue;
    for (const r of rows) {
      seenRows.add(
        r
          .map((w) => w.filled)
          .sort()
          .join('|'),
      );
      for (const w of r) uses.set(w.filled, (uses.get(w.filled) ?? 0) + 1);
    }
    const hard = rows.flat().filter((w) => spec.categories[w.cat]!.hard).length;
    const traps = rows.filter(
      (r) => !sameLetter(r) && new Set(r.map((w) => w.letter)).size === 2,
    ).length;
    drafts.push({ rows, score: hard / rows.flat().length + traps * 0.15 + rand() * 0.01 });
  }
  const order = drafts.map((d, i) => ({ i, s: d.score })).sort((a, b) => a.s - b.s);
  const diff = new Map<number, Difficulty>();
  order.forEach((o, rank) => diff.set(o.i, rank < count * 0.3 ? 1 : rank < count * 0.7 ? 2 : 3));
  return drafts.map((d, i) => buildRowsTask(firstN + i, d.rows, diff.get(i)!, spec));
}
