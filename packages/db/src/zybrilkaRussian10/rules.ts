/**
 * The spelling rules of ЕГЭ task 10 («Правописание приставок»), as the
 * authored tasks use them. Every word of a task is written with its gap in
 * brackets — `бе[з]граничный` — and the rule that decides the letter. The
 * rule is checked against the word itself where the language allows it
 * (З/С by the next sound, Ъ only before е/ё/ю/я at a prefix, Ь before a
 * vowel, a fixed prefix by its own letter…), and the explanation of the
 * word is written from the rule, so the letter, the answer and the
 * explanation can never disagree.
 */

export type Rule =
  /** Приставки на з/с: з перед звонким согласным и гласной, с перед глухим. */
  | { readonly k: 'zs' }
  /** Неизменяемая приставка (под-, над-, от-, об-, пред-…): пишется всегда одинаково. */
  | { readonly k: 'inv'; readonly prefix: string }
  /** ПРЕ- в значении «очень» или близком к «пере-». */
  | { readonly k: 'pre'; readonly meaning: 'очень' | 'пере'; readonly test: string }
  /** ПРИ-: приближение, присоединение, близость, неполнота действия, доведение до результата. */
  | { readonly k: 'pri'; readonly meaning: string }
  /** Слово, написание которого определяется по словарю или по значению (пре-/при- без чёткого значения приставки). */
  | { readonly k: 'dict'; readonly letter: 'е' | 'и'; readonly note: string }
  /** Ы после русской приставки на согласный: и → ы. */
  | { readonly k: 'y'; readonly prefix: string; readonly root: string }
  /** И сохраняется. */
  | {
      readonly k: 'i';
      readonly why: 'foreign' | 'sverh' | 'mezh' | 'vzimat' | 'vowel' | 'compound';
      readonly prefix: string;
      /** A compound word's full form: «спортивный инвентарь». */
      readonly note?: string;
    }
  /** Разделительный Ъ. */
  | { readonly k: 'hard'; readonly why: 'prefix' | 'compound' | 'foreign'; readonly prefix: string }
  /** Разделительный Ь внутри слова (не после приставки). */
  | { readonly k: 'soft' }
  /** Роз-/рос- под ударением; раз-/рас- без ударения. */
  | { readonly k: 'roz'; readonly stressed: string }
  | { readonly k: 'raz'; readonly stressed: string }
  /** Пра- «предок, древний, первоначальный». */
  | { readonly k: 'pra'; readonly note: string };

export interface Word {
  /** As written in the data: `(камень) пр[е]ткновения`. */
  readonly raw: string;
  readonly rule: Rule;
}

export interface ParsedWord {
  /** The word with the gap: `(камень) пр..ткновения`. */
  readonly shown: string;
  /** The full word, the inserted letter capitalised: `(камень) прЕткновения`. */
  readonly solved: string;
  /** The missing letter, lowercase. */
  readonly letter: string;
  /** The word itself (without the context in brackets), lowercase. */
  readonly word: string;
  /** Position of the letter in `word`. */
  readonly at: number;
}

const GAP = /\[([^\]]+)\]/;

export function parseWord(raw: string): ParsedWord {
  const gaps = raw.match(/\[[^\]]*\]/g) ?? [];
  if (gaps.length !== 1) throw new Error(`«${raw}»: exactly one [gap] expected`);
  const m = raw.match(GAP)!;
  const letter = m[1]!;
  const shown = raw.replace(GAP, '..');
  const solved = raw.replace(GAP, letter.toUpperCase());
  // The word is the token holding the gap; context sits in (brackets).
  const token = raw
    .replace(/\([^)]*\)/g, ' ')
    .trim()
    .split(/\s+/)
    .find((t) => t.includes('['))!;
  const at = token.indexOf('[');
  const word = token.replace(GAP, letter).toLowerCase();
  return { shown, solved, letter, word, at };
}

const VOWELS = 'аеёиоуыэюя';
const VOICED = 'бвгджзйлмнр';
const VOICELESS = 'кпстфхцчшщ';
const SOFTENED = 'еёюя';

/** «бе» → «без-/бес-»: the pair of a з/с prefix from what stands before the gap. */
const ZS_PREFIX: Record<string, string> = {
  бе: 'БЕЗ-/БЕС-',
  небе: 'БЕЗ-/БЕС-',
  во: 'ВОЗ-/ВОС-',
  в: 'ВЗ-/ВС-',
  и: 'ИЗ-/ИС-',
  ни: 'НИЗ-/НИС-',
  ра: 'РАЗ-/РАС-',
  ро: 'РОЗ-/РОС-',
  чере: 'ЧЕРЕЗ-/ЧЕРЕС-',
};

/** Checks the letter against the rule; returns problems (empty = consistent). */
export function checkWord(w: Word): string[] {
  const p = parseWord(w.raw);
  const before = p.word.slice(0, p.at);
  const next = p.word[p.at + 1] ?? '';
  const out: string[] = [];
  const need = (cond: boolean, msg: string) => {
    if (!cond) out.push(`«${w.raw}»: ${msg}`);
  };
  const r = w.rule;
  switch (r.k) {
    case 'zs':
      need(p.letter === 'з' || p.letter === 'с', 'з/с expected');
      need(before in ZS_PREFIX, `unknown з/с prefix «${before}»`);
      need(
        p.letter === (VOICELESS.includes(next) ? 'с' : 'з'),
        `«${next}» needs ${VOICELESS.includes(next) ? 'с' : 'з'}`,
      );
      need(
        VOWELS.includes(next) || VOICED.includes(next) || VOICELESS.includes(next),
        'next letter?',
      );
      break;
    case 'inv':
      need(
        p.word.slice(p.at + 1 - r.prefix.length, p.at + 1) === r.prefix,
        `not the prefix ${r.prefix}-`,
      );
      break;
    case 'pre':
      need(p.letter === 'е' && before.endsWith('пр'), 'ПРЕ- expected');
      break;
    case 'pri':
      need(p.letter === 'и' && before.endsWith('пр'), 'ПРИ- expected');
      break;
    case 'dict':
      need(p.letter === r.letter && before.endsWith('пр'), 'пре/при dictionary word');
      break;
    case 'y':
      need(p.letter === 'ы', 'Ы expected');
      need(before.endsWith(r.prefix), `prefix ${r.prefix}- expected before the gap`);
      need(!VOWELS.includes(r.prefix.at(-1)!), 'prefix must end in a consonant');
      break;
    case 'i':
      need(p.letter === 'и', 'И expected');
      need(before.endsWith(r.prefix), `${r.prefix} expected before the gap`);
      if (r.why === 'vowel') need(VOWELS.includes(r.prefix.at(-1)!), 'vowel-final prefix expected');
      if (r.why === 'vzimat') need(p.word.startsWith('взим'), 'only ВЗИМАТЬ and its forms');
      break;
    case 'hard':
      need(p.letter === 'ъ', 'Ъ expected');
      need(SOFTENED.includes(next), 'Ъ only before е, ё, ю, я');
      need(before.endsWith(r.prefix), `${r.prefix} expected before the gap`);
      need(!VOWELS.includes(before.at(-1)!), 'Ъ only after a consonant');
      break;
    case 'soft':
      need(p.letter === 'ь', 'Ь expected');
      need((SOFTENED + 'ио').includes(next), 'Ь before a vowel');
      break;
    case 'roz':
      need(p.letter === 'о' && before === 'р', 'РОЗ-/РОС- expected');
      need(
        /[А-ЯЁ]/.test(r.stressed) && r.stressed.toLowerCase().replace(/\s.*/, '') !== '',
        'mark the stress',
      );
      break;
    case 'raz':
      need(p.letter === 'а' && before === 'р', 'РАЗ-/РАС- expected');
      break;
    case 'pra':
      need(p.letter === 'а' && before.endsWith('пр'), 'ПРА- expected');
      break;
  }
  return out;
}

/** The explanation of one word: its letter and why. */
export function explainWord(w: Word): string {
  const p = parseWord(w.raw);
  const next = p.word[p.at + 1] ?? '';
  const L = p.letter.toUpperCase();
  const r = w.rule;
  switch (r.k) {
    case 'zs': {
      const pair = ZS_PREFIX[p.word.slice(0, p.at)]!;
      const sound = VOWELS.includes(next)
        ? 'перед гласной'
        : VOICED.includes(next)
          ? `перед звонким «${next}»`
          : `перед глухим «${next}»`;
      return `${p.solved} — приставка ${pair}: ${sound} пишется ${L}`;
    }
    case 'inv':
      return `${p.solved} — приставка ${r.prefix.toUpperCase()}- неизменяемая: пишется ${L} независимо от следующего звука`;
    case 'pre':
      return r.meaning === 'очень'
        ? `${p.solved} — ПРЕ- в значении «очень» (${r.test})`
        : `${p.solved} — ПРЕ- близка по значению к ПЕРЕ- (${r.test})`;
    case 'pri':
      return `${p.solved} — ПРИ- в значении «${r.meaning}»`;
    case 'dict':
      return `${p.solved} — ${r.note}`;
    case 'y':
      return `${p.solved} — после русской приставки ${r.prefix.toUpperCase()}- на согласный И переходит в Ы (${r.root})`;
    case 'i':
      switch (r.why) {
        case 'foreign':
          return `${p.solved} — после иноязычной приставки ${r.prefix.toUpperCase()}- И сохраняется`;
        case 'sverh':
          return `${p.solved} — после приставки СВЕРХ- И сохраняется`;
        case 'mezh':
          return `${p.solved} — после приставки МЕЖ- И сохраняется`;
        case 'vzimat':
          return `${p.solved} — исключение: ВЗИМАТЬ (и его формы) пишется с И`;
        case 'vowel':
          return `${p.solved} — приставка ${r.prefix.toUpperCase()}- оканчивается на гласную, поэтому И корня не меняется`;
        case 'compound':
          return `${p.solved} — сложносокращённое слово (${r.note ?? r.prefix}): И не меняется`;
      }
      break;
    case 'hard':
      return r.why === 'prefix'
        ? `${p.solved} — разделительный Ъ после приставки ${r.prefix.toUpperCase()}- на согласный перед «${next}»`
        : r.why === 'compound'
          ? `${p.solved} — разделительный Ъ в сложном слове после первой части ${r.prefix.toUpperCase()}- перед «${next}»`
          : `${p.solved} — разделительный Ъ после иноязычной приставки ${r.prefix.toUpperCase()}- перед «${next}»`;
    case 'soft':
      return `${p.solved} — разделительный Ь не на стыке с приставкой, а внутри слова перед «${next}»`;
    case 'roz':
      return `${p.solved} — под ударением пишется РОЗ-/РОС- (${r.stressed})`;
    case 'raz':
      return `${p.solved} — без ударения пишется РАЗ-/РАС- (${r.stressed})`;
    case 'pra':
      return `${p.solved} — ПРА- «${r.note}»`;
  }
  return p.solved;
}

/** What kind of spelling a word checks — for the task's «Что дано» and hint. */
export function orthogramOf(rule: Rule): string {
  switch (rule.k) {
    case 'zs':
      return 'приставки на З/С';
    case 'inv':
      return 'неизменяемые приставки';
    case 'pre':
    case 'pri':
    case 'dict':
      return 'ПРЕ-/ПРИ-';
    case 'y':
    case 'i':
      return 'Ы/И после приставок';
    case 'hard':
    case 'soft':
      return 'разделительные Ъ и Ь';
    case 'roz':
    case 'raz':
      return 'РАЗ-/РОЗ- (РАС-/РОС-)';
    case 'pra':
      return 'ПРА-';
  }
}

// ------------------------------------------------------- short constructors
export const Z = (raw: string): Word => ({ raw, rule: { k: 'zs' } });
export const INV = (raw: string, prefix: string): Word => ({ raw, rule: { k: 'inv', prefix } });
export const PRE = (raw: string, meaning: 'очень' | 'пере', test: string): Word => ({
  raw,
  rule: { k: 'pre', meaning, test },
});
export const PRI = (raw: string, meaning: string): Word => ({ raw, rule: { k: 'pri', meaning } });
export const DE = (raw: string, note: string): Word => ({
  raw,
  rule: { k: 'dict', letter: 'е', note },
});
export const DI = (raw: string, note: string): Word => ({
  raw,
  rule: { k: 'dict', letter: 'и', note },
});
export const Y = (raw: string, prefix: string, root: string): Word => ({
  raw,
  rule: { k: 'y', prefix, root },
});
export const IF = (raw: string, prefix: string): Word => ({
  raw,
  rule: { k: 'i', why: 'foreign', prefix },
});
export const ISV = (raw: string): Word => ({
  raw,
  rule: { k: 'i', why: 'sverh', prefix: 'сверх' },
});
export const IME = (raw: string): Word => ({ raw, rule: { k: 'i', why: 'mezh', prefix: 'меж' } });
export const IVZ = (raw: string): Word => ({ raw, rule: { k: 'i', why: 'vzimat', prefix: 'вз' } });
export const IV = (raw: string, prefix: string): Word => ({
  raw,
  rule: { k: 'i', why: 'vowel', prefix },
});
export const IC = (raw: string, prefix: string, note: string): Word => ({
  raw,
  rule: { k: 'i', why: 'compound', prefix, note },
});
export const HP = (raw: string, prefix: string): Word => ({
  raw,
  rule: { k: 'hard', why: 'prefix', prefix },
});
export const HC = (raw: string, prefix: string): Word => ({
  raw,
  rule: { k: 'hard', why: 'compound', prefix },
});
export const HF = (raw: string, prefix: string): Word => ({
  raw,
  rule: { k: 'hard', why: 'foreign', prefix },
});
export const S = (raw: string): Word => ({ raw, rule: { k: 'soft' } });
export const RO = (raw: string, stressed: string): Word => ({ raw, rule: { k: 'roz', stressed } });
export const RA = (raw: string, stressed: string): Word => ({ raw, rule: { k: 'raz', stressed } });
export const PRA = (raw: string, note: string): Word => ({ raw, rule: { k: 'pra', note } });
