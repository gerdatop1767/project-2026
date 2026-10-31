import type { HTMLAttributes, ReactNode } from 'react';
import { clsx } from '../../lib/clsx.js';
import styles from './motion.module.css';

interface MotionProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Stagger this entrance by N ms — small lists per the Design Spec's "staggered ~30-40ms" rule. */
  delayMs?: number;
}

function withDelay(delayMs?: number) {
  return delayMs ? { animationDelay: `${delayMs}ms` } : undefined;
}

/**
 * Lightweight entrance-motion primitives (Design Spec Section 6 / 13).
 * Thin CSS-animation wrappers, not an animation framework: each mount
 * plays its keyframe once and settles — there is no exit variant here
 * (Overlay/Toast own their own enter+exit transitions where that's
 * needed). All respect `prefers-reduced-motion` via tokens.css.
 */
export function FadeIn({ children, delayMs, className, style, ...rest }: MotionProps) {
  return (
    <div
      className={clsx(styles.fadeIn, className)}
      style={{ ...style, ...withDelay(delayMs) }}
      {...rest}
    >
      {children}
    </div>
  );
}

export function SlideUp({ children, delayMs, className, style, ...rest }: MotionProps) {
  return (
    <div
      className={clsx(styles.slideUp, className)}
      style={{ ...style, ...withDelay(delayMs) }}
      {...rest}
    >
      {children}
    </div>
  );
}

export function ScaleIn({ children, delayMs, className, style, ...rest }: MotionProps) {
  return (
    <div
      className={clsx(styles.scaleIn, className)}
      style={{ ...style, ...withDelay(delayMs) }}
      {...rest}
    >
      {children}
    </div>
  );
}

/** The step and cap every list cascade shares: siblings appear ~28 ms
 * apart and anything past the 7th item arrives with it — a list reads
 * as one block, never a long drip. */
export const STAGGER_STEP_MS = 28;
export const STAGGER_MAX_INDEX = 6;
export function staggerDelay(index: number): number {
  return Math.min(Math.max(index, 0), STAGGER_MAX_INDEX) * STAGGER_STEP_MS;
}

/**
 * Its direct children rise in one after another (~28 ms apart, capped).
 * For a screen's top-level sections or a short grid of cards.
 */
export function Stagger({ children, className, ...rest }: Omit<MotionProps, 'delayMs'>) {
  return (
    <div className={clsx(styles.stagger, className)} {...rest}>
      {children}
    </div>
  );
}

/** Same stagger as `<Stagger>`, as a class for an element that is not a div (a `<ul>`, a grid). */
export const staggerClassName = styles.stagger;

/**
 * Wraps the current screen inside the app shells. Keyed by screen, so it
 * re-plays only when the visitor actually moves to another screen (not on
 * data updates): the whole screen fades in while settling a few px.
 */
export function ScreenEnter({ screenKey, children }: { screenKey: string; children: ReactNode }) {
  return (
    <div key={screenKey} className={styles.screen} data-screen={screenKey}>
      {children}
    </div>
  );
}

/**
 * New content arriving in place of old (another task, another tab's
 * panel): its children fade in with a short rise. Key it by what it shows
 * (`key={taskId}`) so it re-plays on each swap. Adds no box of its own.
 */
export function ContentSwap({ children }: { children: ReactNode }) {
  return <div className={styles.contentSwap}>{children}</div>;
}

export interface CollapseProps {
  open: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Expand/collapse without measuring heights in JS: the CSS
 * `grid-template-rows: 0fr -> 1fr` technique animates to the content's
 * natural height directly.
 */
export function Collapse({ open, children, className }: CollapseProps) {
  return (
    <div
      className={clsx(styles.collapse, open && styles.collapseOpen, className)}
      aria-hidden={!open}
    >
      <div className={styles.collapseInner}>{children}</div>
    </div>
  );
}
