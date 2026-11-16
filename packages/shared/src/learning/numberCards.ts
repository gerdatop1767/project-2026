import { normalizeTaskText } from './taskFeatures.js';
import { MATH_CARDS } from './numberCardsMath.js';
import { RUSSIAN_CARDS } from './numberCardsRussian.js';

/**
 * Methodical cards of EGE numbers (docs/learning/PERSONAL-PLANS.md § База
 * советов). One card per exam skill: how the number is solved, the rule
 * students misapply, the usual slip and how to check it, which part of the
 * condition gets lost, what the hard tasks add, concrete exercises, the
 * subtypes the catalog can tell apart, and — for multi-part numbers — the
 * parts a student can fail separately. `adviceFor` composes a problem type
 * with the card, so the advice of №6 and №13 differ in substance, not by
 * the number in the title.
 *
 * Content rules: only standard EGE methodology; rules are summarised, the
 * full text lives on the theory page, `theory` lists its real headings (a
 * web test checks they exist). Nothing about a task is invented: subtypes
 * and parts are read from the task's own condition and answer key.
 */
export interface CardSubtype {
  readonly key: string;
  readonly label: string;
  /** Task features (`taskFeatures` primary or secondary) that must all be present. */
  readonly all: readonly string[];
  /** Features that must be absent. */
  readonly none?: readonly string[];
  /** How this subtype is recognised and solved. */
  readonly method: string;
}

export interface CardPart {
  readonly key: string;
  readonly label: string;
  /** For parts named in the condition (№8 error types, №22 devices). */
  readonly match?: RegExp;
  readonly howItShows: string;
  readonly cause: string;
  /** Headings of the number's theory page. */
  readonly theory: readonly string[];
  readonly steps: readonly string[];
  readonly exercise: string;
}

export interface SetErrorCard {
  readonly howItShows: string;
  readonly cause: string;
  readonly fix: string;
}

export interface NumberCard {
  readonly skill: string;
  readonly subjectId: 'math' | 'russian';
  /** Short name, e.g. «Уравнения с отбором корней». */
  readonly name: string;
  /** Headings of the theory page of this skill that the advice points to. */
  readonly theory: readonly string[];
  /** The solving algorithm of the number, 3–5 concrete steps. */
  readonly algorithm: readonly string[];
  /** The rule or formula and when it applies — what gets misapplied. */
  readonly rule: string;
  /** The usual slip of this number. */
  readonly slip: string;
  /** How to check an answer of this number. */
  readonly selfCheck: string;
  /** Which part of the condition gets lost. */
  readonly conditionTrap: string;
  /** What hard tasks of the number add. */
  readonly hard: string;
  /** Concrete exercises, at least two. */
  readonly exercises: readonly string[];
  /** For set answers: what a subset / superset of the key means here. */
  readonly missed?: SetErrorCard;
  readonly extra?: SetErrorCard;
  readonly subtypes?: readonly CardSubtype[];
  /** Parts of a multi-part task the student can fail separately. */
  readonly parts?: {
    /** Where the part's key comes from: the letter's text in the condition
     * (№8), the device in the answer's column (№22), or «а/б/в» (№19). */
    readonly source: 'letter-text' | 'answer-term' | 'part-label';
    readonly items: readonly CardPart[];
  };
  /** False for a number the platform cannot check automatically (essay). */
  readonly autoChecked?: boolean;
}

const ALL_CARDS: readonly NumberCard[] = [...MATH_CARDS, ...RUSSIAN_CARDS];
const BY_SKILL = new Map(ALL_CARDS.map((c) => [c.skill, c]));

export function numberCards(): readonly NumberCard[] {
  return ALL_CARDS;
}

export function numberCard(skill: string): NumberCard | null {
  return BY_SKILL.get(skill) ?? null;
}

/** The card's subtype of a task by its features, or null when none fits. */
export function cardSubtypeOf(
  card: NumberCard,
  features: { readonly primary: readonly string[]; readonly secondary: readonly string[] },
): CardSubtype | null {
  if (!card.subtypes) return null;
  const has = new Set([...features.primary, ...features.secondary]);
  return (
    card.subtypes.find(
      (s) => s.all.every((f) => has.has(f)) && !(s.none ?? []).some((f) => has.has(f)),
    ) ?? null
  );
}

// ------------------------------------------------------------ multi-part

interface SpecPart {
  readonly id: string;
  readonly label: string;
  readonly correctAnswer: string;
}

/** Text after «А) » … for every letter of the first column of the condition. */
function letterTexts(conditionMd: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of conditionMd.matchAll(/(?:^|\n)\s*([А-Д])\)\s*([^\n]+)/g)) {
    if (!out.has(m[1]!)) out.set(m[1]!, normalizeTaskText(m[2]!));
  }
  return out;
}

/** Numbered terms of the second column («1) метафора»), after its heading. */
function columnTerms(conditionMd: string, heading: RegExp): Map<string, string> {
  const out = new Map<string, string>();
  const at = conditionMd.search(heading);
  if (at < 0) return out;
  for (const m of conditionMd.slice(at).matchAll(/(?:^|\n)\s*(\d)\)\s*([^\n]+)/g)) {
    out.set(m[1]!, normalizeTaskText(m[2]!));
  }
  return out;
}

/**
 * Maps every part id of a multi-part task to the card's part key, or omits
 * a part whose key cannot be read (never guessed).
 */
export function cardPartKeys(
  card: NumberCard,
  conditionMd: string,
  parts: readonly SpecPart[],
): Map<string, string> {
  const out = new Map<string, string>();
  if (!card.parts) return out;
  const { source, items } = card.parts;
  const find = (text: string) => items.find((i) => i.match?.test(text))?.key;
  if (source === 'letter-text') {
    const texts = letterTexts(conditionMd);
    for (const p of parts) {
      const t = texts.get(p.label.toUpperCase());
      const key = t ? find(t) : undefined;
      if (key) out.set(p.id, key);
    }
  } else if (source === 'answer-term') {
    const terms = columnTerms(conditionMd, /ВЫРАЗИТЕЛЬНЫЕ СРЕДСТВА/);
    for (const p of parts) {
      const t = terms.get(p.correctAnswer.trim());
      const key = t ? find(t) : undefined;
      if (key) out.set(p.id, key);
    }
  } else {
    const byLabel: Record<string, string> = { а: 'part-a', б: 'part-b', в: 'part-c' };
    for (const p of parts) {
      const key = byLabel[p.label.trim().toLowerCase()];
      if (key && items.some((i) => i.key === key)) out.set(p.id, key);
    }
  }
  return out;
}
