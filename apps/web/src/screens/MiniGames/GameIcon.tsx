import type { CSSProperties } from 'react';
import {
  ArrowLeftRight,
  AudioLines,
  BookOpenText,
  CaseSensitive,
  Calculator,
  Combine,
  Dices,
  DraftingCompass,
  DoorOpen,
  Highlighter,
  PenLine,
  Pilcrow,
  Puzzle,
  SearchCheck,
  Sigma,
  Sparkles,
  SpellCheck,
  Sprout,
  TextCursorInput,
  Unlink,
  type LucideIcon,
} from 'lucide-react';
import { clsx } from '../../lib/clsx.js';
import styles from './GameIcon.module.css';

/**
 * Each mini-game's emblem: a lucide icon chosen for what the game trains
 * (no hand-drawn art), on a soft gradient tile in its topic's colour.
 */
export const GAME_ICONS: Record<string, LucideIcon> = {
  stress: AudioLines, // ударение — звучание слова
  'root-vowels': Sprout, // корень
  prefixes: DoorOpen, // приставка — «вход» в слово
  'suffixes-endings': Puzzle, // части слова
  'ne-together': Unlink, // слитно / раздельно
  hyphen: Combine, // слитно, раздельно, через дефис
  nn: CaseSensitive, // Н или НН — выбор буквы
  'one-comma': Pilcrow, // одна запятая
  commas: PenLine, // расставить знаки
  'grammar-detective': SearchCheck, // найти ошибку
  paronyms: ArrowLeftRight, // похожие слова
  'word-errors': SpellCheck, // ошибка в форме
  'gap-word': TextCursorInput, // вставить слово
  'word-meaning': BookOpenText, // значение слова
  expressive: Sparkles, // средства выразительности
  'find-in-text': Highlighter, // найти в тексте
  'probability-blitz': Dices, // вероятность
  'expressions-blitz': Sigma, // вычисления
  'theory-practice': DraftingCompass, // теория: правила и теоремы
};

/** Topic → the tile's two gradient colours. */
const TONES: Record<string, readonly [string, string]> = {
  orthography: ['#3ec9f5', '#2b7fff'],
  punctuation: ['#a78bfa', '#6d5dfc'],
  norms: ['#34d399', '#0ea5a4'],
  text: ['#fbbf24', '#f97316'],
  'math-part1': ['#f472b6', '#8b5cf6'],
  'math-theory': ['#22d3ee', '#3b82f6'],
};

export function GameIcon({
  gameId,
  topic,
  size = 'md',
  index = 0,
}: {
  gameId: string;
  topic: string;
  size?: 'md' | 'lg';
  /** Position in the list, to stagger the appearance. */
  index?: number;
}) {
  const Icon = GAME_ICONS[gameId] ?? Calculator;
  const [from, to] = TONES[topic] ?? TONES.orthography!;
  return (
    <span
      className={clsx(styles.tile, size === 'lg' && styles.large)}
      style={
        {
          '--icon-from': from,
          '--icon-to': to,
          '--icon-delay': `${Math.min(index, 12) * 45}ms`,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      <Icon className={styles.glyph} strokeWidth={2} />
    </span>
  );
}
