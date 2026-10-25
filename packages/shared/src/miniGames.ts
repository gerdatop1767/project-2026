import { z } from 'zod';

/**
 * Mini-games (docs/MINI_GAMES.md). The registry is data: a new game is one
 * entry here plus its own API module and screen — the hub, cards and
 * progress storage (`mini_game_answers`, `mini_game_item_progress`, keyed
 * by `gameId`) are shared.
 */
export interface MiniGameInfo {
  readonly id: string;
  readonly title: string;
  /** Subject id (the same ids as tasks use). */
  readonly subjectId: string;
  readonly subjectName: string;
  readonly description: string;
  /** Which EGE task it trains, when there is one. */
  readonly egeTask: string | null;
}

export const MINI_GAMES: readonly MiniGameInfo[] = [
  {
    id: 'stress',
    title: 'Ударения',
    subjectId: 'russian',
    subjectName: 'Русский язык',
    description: 'Ставь ударение в словах из орфоэпического словника — задание 4 ЕГЭ.',
    egeTask: 'Задание 4',
  },
];

export const miniGameById = (id: string): MiniGameInfo | undefined =>
  MINI_GAMES.find((g) => g.id === id);

/** Correct answers in a row after which an item counts as learned. */
export const MINI_GAME_LEARNED_STREAK = 2;

// ------------------------------------------------------------------ «Ударения»

/** Russian vowels — the letters a stress can fall on. */
const VOWELS = new Set('аеёиоуыэюяАЕЁИОУЫЭЮЯ');

export const isVowel = (ch: string): boolean => VOWELS.has(ch);

/** Indices of the vowels in a word — the places a player can tap. */
export function vowelIndices(word: string): number[] {
  const out: number[] = [];
  [...word].forEach((ch, i) => {
    if (isVowel(ch)) out.push(i);
  });
  return out;
}

/** «свЁкла» with a stress at index → the marked form. */
export function markStress(word: string, index: number): string {
  const chars = [...word];
  chars[index] = chars[index]!.toUpperCase();
  return chars.join('');
}

/** What the player sees: no stress, and «ё» written «е» — «ё» is always
 * stressed, so showing it would give the answer away. */
export const unstressedDisplay = (word: string): string => word.replace(/ё/g, 'е');

export const STRESS_PARTS_OF_SPEECH = ['сущ.', 'прил.', 'гл.', 'прич.', 'деепр.', 'нар.'] as const;
export type StressPartOfSpeech = (typeof STRESS_PARTS_OF_SPEECH)[number];
const STRESS_FLAGS = ['removed2026'] as const;

export interface ParsedStressEntry {
  /** Identity for upserts: the marked form + its form note. */
  readonly key: string;
  readonly marked: string;
  /** Lowercase, with «ё». */
  readonly word: string;
  readonly stressIndex: number;
  readonly partOfSpeech: StressPartOfSpeech;
  readonly formNote: string | null;
  readonly removed2026: boolean;
}

/**
 * Parses one dictionary line `marked | part of speech | form note | flags`
 * and checks it: exactly one capital letter, and it is a vowel; the rest
 * are lowercase Cyrillic letters (or a hyphen); at least two vowels (one
 * vowel leaves nothing to choose); a word with «ё» is stressed on it.
 * Returns the problem as a string instead of throwing.
 */
export function parseStressEntry(line: string): ParsedStressEntry | string {
  const [rawMarked = '', rawPos = '', rawNote = '', rawFlags = '', ...extra] = line
    .split('|')
    .map((s) => s.trim());
  if (extra.length > 0) return `${line}: too many fields`;
  const marked = rawMarked;
  if (!/^[а-яёА-ЯЁ-]+$/.test(marked)) return `${line}: only Cyrillic letters allowed`;
  const capitals = [...marked]
    .map((ch, i) => ({ ch, i }))
    .filter(({ ch }) => ch !== ch.toLowerCase());
  if (capitals.length !== 1) return `${line}: exactly one capital (stressed) letter expected`;
  const { ch, i: stressIndex } = capitals[0]!;
  if (!isVowel(ch)) return `${line}: the capital letter «${ch}» is not a vowel`;
  const word = marked.toLowerCase();
  if (vowelIndices(word).length < 2) return `${line}: fewer than two vowels — nothing to choose`;
  const yo = word.indexOf('ё');
  if (yo !== -1 && yo !== stressIndex) return `${line}: «ё» must carry the stress`;
  if (!(STRESS_PARTS_OF_SPEECH as readonly string[]).includes(rawPos)) {
    return `${line}: unknown part of speech «${rawPos}»`;
  }
  const flags = rawFlags ? rawFlags.split(',').map((f) => f.trim()) : [];
  const unknown = flags.find((f) => !(STRESS_FLAGS as readonly string[]).includes(f));
  if (unknown) return `${line}: unknown flag «${unknown}»`;
  const formNote = rawNote || null;
  return {
    key: formNote ? `${marked} (${formNote})` : marked,
    marked,
    word,
    stressIndex,
    partOfSpeech: rawPos as StressPartOfSpeech,
    formNote,
    removed2026: flags.includes('removed2026'),
  };
}

/**
 * Validates a whole dictionary: every line parses, no key twice, and no
 * form listed twice with the same stress under different notes. The same
 * spelling with DIFFERENT stresses (another form) is allowed — those are
 * never merged.
 */
export function validateStressEntries(lines: readonly string[]): {
  entries: ParsedStressEntry[];
  problems: string[];
} {
  const entries: ParsedStressEntry[] = [];
  const problems: string[] = [];
  const keys = new Set<string>();
  const marks = new Map<string, string>();
  for (const line of lines) {
    const parsed = parseStressEntry(line);
    if (typeof parsed === 'string') {
      problems.push(parsed);
      continue;
    }
    if (keys.has(parsed.key)) problems.push(`${line}: duplicate`);
    else if (marks.has(parsed.marked)) {
      problems.push(`${line}: same stressed form already listed as «${marks.get(parsed.marked)}»`);
    }
    keys.add(parsed.key);
    marks.set(parsed.marked, parsed.key);
    entries.push(parsed);
  }
  return { entries, problems };
}

export const stressModes = ['all', 'mistakes', 'hard'] as const;
export type StressMode = (typeof stressModes)[number];

export const stressRoundQuerySchema = z.object({
  mode: z.enum(stressModes).default('all'),
  size: z.coerce.number().int().min(5).max(40).default(20),
});
export type StressRoundQuery = z.infer<typeof stressRoundQuerySchema>;

/** A question — the answer is not in it; the server checks it. */
export interface StressQuestion {
  readonly wordId: string;
  /** No stress, «ё» as «е». */
  readonly display: string;
  /** Where the player may tap (indices into `display`). */
  readonly vowels: readonly number[];
  readonly partOfSpeech: string;
  readonly formNote: string | null;
}

export interface StressRoundResponse {
  readonly mode: StressMode;
  readonly questions: readonly StressQuestion[];
  /** Words in the dictionary the game asks (confirmed, active). */
  readonly dictionarySize: number;
}

export const stressAnswerRequestSchema = z.object({
  wordId: z.uuid(),
  index: z.number().int().min(0).max(60),
  /** Makes a re-sent answer count once. */
  clientAnswerId: z.uuid(),
});
export type StressAnswerRequest = z.infer<typeof stressAnswerRequestSchema>;

export interface StressAnswerResponse {
  readonly correct: boolean;
  readonly correctIndex: number;
  /** «свЁкла». */
  readonly marked: string;
  readonly formNote: string | null;
  /** «По сообщениям, нет в списке 2026» and the like. */
  readonly note: string | null;
  /** Saved for this account (false for a guest). */
  readonly recorded: boolean;
}

export interface StressHardWord {
  readonly wordId: string;
  readonly marked: string;
  readonly wrong: number;
  readonly correct: number;
}

export interface StressProgressResponse {
  readonly dictionarySize: number;
  /** Words answered right `MINI_GAME_LEARNED_STREAK` times in a row. */
  readonly learned: number;
  /** Words ever answered. */
  readonly seen: number;
  readonly answers: number;
  readonly correct: number;
  readonly wrong: number;
  readonly accuracyPercent: number | null;
  /** Words to train in «Мои ошибки» (last answer wrong). */
  readonly mistakes: number;
  /** Most often confused, worst first. */
  readonly hardWords: readonly StressHardWord[];
  /** Last 14 Moscow days, oldest first; only days with answers. */
  readonly daily: readonly { date: string; answers: number; correct: number }[];
}

export interface MiniGamesResponse {
  readonly games: readonly (MiniGameInfo & {
    /** For the signed-in player; null for a guest. */
    readonly progress: { learned: number; total: number } | null;
  })[];
}
