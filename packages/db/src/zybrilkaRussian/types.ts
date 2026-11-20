/**
 * Зубрилка's own ЕГЭ Russian bank, tasks 4–22 except 10
 * (docs/imports/zybrilka-russian-4-22-plan.md). A task is written as
 * structured data and built by its mechanic's builder: the answer is
 * computed from the structure, never typed, and the explanation is built
 * from the same structure — so they cannot disagree.
 */
export type Difficulty = 1 | 2 | 3;

export type BankAnswer =
  /** Row / sentence / position numbers, ascending, order-insensitive. */
  | { readonly type: 'digits'; readonly digits: string }
  /** One word (or a short form); `accepted` — equally right alternatives. */
  | { readonly type: 'word'; readonly word: string; readonly accepted: readonly string[] }
  /** Matching А–Д → digits 1–9. */
  | {
      readonly type: 'match';
      readonly parts: readonly [string, string, string, string, string];
    };

export interface BankTask {
  /** EGE task number, 4–22. */
  readonly taskNumber: number;
  /** Position in this number's bank, 1–50: the stable import key. */
  readonly n: number;
  readonly difficulty: Difficulty;
  /** Sub-type inside the number (e.g. «плеоназм», «сочетаемость»). */
  readonly kind: string;
  readonly conditionMd: string;
  readonly answer: BankAnswer;
  readonly explanationMd: string;
  readonly hintMd: string;
  /** Set: imported as needs_review (hidden), with this reason. */
  readonly review?: string;
}

/** What every number's data module exports. */
export interface BankNumber {
  readonly taskNumber: number;
  readonly topicSlug: string;
  readonly topicName: string;
  readonly tasks: readonly BankTask[];
}

export const MATCH_LABELS = ['А', 'Б', 'В', 'Г', 'Д'] as const;

/** «Ответ: …» exactly as the explanation must end. */
export function answerText(answer: BankAnswer): string {
  switch (answer.type) {
    case 'digits':
      return answer.digits;
    case 'word':
      return [answer.word, ...answer.accepted].join(' / ');
    case 'match':
      return answer.parts.map((d, i) => `${MATCH_LABELS[i]} — ${d}`).join(', ');
  }
}

/** Digits of rows/positions that hold, ascending: [true,false,true] → «13». */
export function digitsOf(flags: readonly boolean[]): string {
  return flags.map((f, i) => (f ? String(i + 1) : '')).join('');
}

/** Small deterministic PRNG (mulberry32) — generated tasks never change between runs. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(xs: readonly T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
