import type { ReactNode } from 'react';
import styles from './LandingIcons.module.css';

/**
 * Line icons drawn for the landing's feature and source lists — one family:
 * 24 px grid, 1.6 px round strokes, exactly one purple accent element each.
 *
 * Every shape carries `pathLength="1"`, so CSS can "draw" any of them with
 * the same `stroke-dashoffset: 1 → 0` once its list item is revealed (see
 * LandingIcons.module.css). The drawing plays once; nothing loops.
 */
export type LandingIconName =
  'numbers' | 'variant' | 'check' | 'mistakes' | 'stats' | 'scratch' | 'bookMath' | 'bookRussian';

const base = { pathLength: 1, className: styles.draw } as const;
const accent = { pathLength: 1, className: `${styles.draw} ${styles.accent}` } as const;

const shapes: Record<LandingIconName, ReactNode> = {
  // A 2×2 grid of task cells, one picked.
  numbers: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" {...base} />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" {...base} />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" {...base} />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" {...accent} />
    </>
  ),
  // A full sheet with a folded corner; its lines are the accent.
  variant: (
    <>
      <path d="M14.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5z" {...base} />
      <path d="M14.5 3v4.5H19" {...base} />
      <path d="M8.5 12.5h7M8.5 16h4.5" {...accent} />
    </>
  ),
  // The check after an answer.
  check: (
    <>
      <circle cx="12" cy="12" r="8.5" {...base} />
      <path d="M8.2 12.4l2.6 2.6 5-5.4" {...accent} />
    </>
  ),
  // A loop back to the wrong answer.
  mistakes: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" {...base} />
      <path d="M19.5 4.5v4h-4" {...base} />
      <path d="M10 10l4 4M14 10l-4 4" {...accent} />
    </>
  ),
  // Bars by task number; the tallest one is where you are strong.
  stats: (
    <>
      <path d="M4 20.5h16" {...base} />
      <rect x="5.5" y="12.5" width="3" height="5" rx="1" {...base} />
      <rect x="10.5" y="8.5" width="3" height="9" rx="1" {...base} />
      <rect x="15.5" y="4.5" width="3" height="13" rx="1" {...accent} />
    </>
  ),
  // A stylus and the stroke it leaves.
  scratch: (
    <>
      <path d="M15.2 4.8l4 4L9 19l-4.5.5L5 15z" {...base} />
      <path d="M13 7l4 4" {...base} />
      <path d="M13.5 20.5c1.4-1.2 2.8-1.2 4.2 0 .9.8 1.8.8 2.8 0" {...accent} />
    </>
  ),
  // Book + a function curve (mathematics).
  bookMath: (
    <>
      <path
        d="M5 18V6a2.5 2.5 0 0 1 2.5-2.5H19v13H7.5A2.5 2.5 0 0 0 5 19a2.5 2.5 0 0 0 2.5 2.5H19"
        {...base}
      />
      <path d="M8.5 11c1.1-2.4 2.4-2.4 3.5 0s2.4 2.4 3.5 0" {...accent} />
    </>
  ),
  // Book + lines of text (Russian language).
  bookRussian: (
    <>
      <path
        d="M5 18V6a2.5 2.5 0 0 1 2.5-2.5H19v13H7.5A2.5 2.5 0 0 0 5 19a2.5 2.5 0 0 0 2.5 2.5H19"
        {...base}
      />
      <path d="M9 8h6.5M9 11h4.5" {...accent} />
    </>
  ),
};

export function LandingIcon({ name }: { name: LandingIconName }) {
  return (
    <span className={styles.tile} aria-hidden="true">
      <svg
        className={styles.svg}
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {shapes[name]}
      </svg>
    </span>
  );
}
