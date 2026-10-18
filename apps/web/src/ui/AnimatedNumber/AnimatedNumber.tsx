import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { clsx } from '../../lib/clsx.js';
import styles from './AnimatedNumber.module.css';

export interface AnimatedNumberProps {
  /**
   * The value exactly as it should finally read — already formatted
   * ("1 234+", "70%", "70 с"). A number is formatted with ru-RU grouping.
   * Text without digits ("···", "—", "Полная") is shown as is, unanimated.
   */
  value: string | number;
  className?: string;
}

type Token =
  { kind: 'digit'; digit: number; key: string } | { kind: 'char'; char: string; key: string };

function tokenize(text: string): Token[] {
  const chars = [...text];
  // Keyed from the RIGHT, so the units stay the units when the number grows
  // a digit (9 → 10) and only the new leading column is added.
  return chars.map((char, index) => {
    const fromRight = chars.length - 1 - index;
    return /\d/.test(char)
      ? { kind: 'digit', digit: Number(char), key: `d${fromRight}` }
      : { kind: 'char', char, key: `c${fromRight}` };
  });
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * A number that rolls into place like an odometer: every digit is a column
 * that spins up from 0 and settles on its value, the columns rippling left
 * to right. It plays when the number first scrolls into view — not on every
 * render — and afterwards a changed value rolls from the old digits to the
 * new ones. Formatting (spaces, "+", "%", units) is kept as given.
 *
 * Honest by construction: it only ever animates toward the real value it is
 * given; while the caller has nothing yet it passes its placeholder ("···"),
 * which is shown as is.
 *
 * The moving digits are drawn by CSS (`::before` strips, transform only — no
 * per-frame JavaScript), so the element's text is just the final value, in a
 * visually hidden span for screen readers, copy and tests. With
 * `prefers-reduced-motion` (or no IntersectionObserver) the value is simply
 * shown.
 */
export function AnimatedNumber({ value, className }: AnimatedNumberProps) {
  const text = typeof value === 'number' ? value.toLocaleString('ru-RU') : value;
  const tokens = tokenize(text);
  const hasDigits = tokens.some((token) => token.kind === 'digit');

  const ref = useRef<HTMLSpanElement>(null);
  const [instant] = useState(
    () => typeof IntersectionObserver === 'undefined' || prefersReducedMotion(),
  );
  const [inView, setInView] = useState(instant);
  const [rolled, setRolled] = useState(instant);

  useEffect(() => {
    if (inView) return;
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.6 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [inView]);

  // Roll once the real digits are both here and visible. Two frames: the
  // columns must be painted at 0 first, or there is nothing to transition from.
  useEffect(() => {
    if (instant || rolled || !inView || !hasDigits) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setRolled(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [instant, rolled, inView, hasDigits]);

  let column = 0;

  return (
    <span ref={ref} className={clsx(styles.root, className)} data-instant={instant || undefined}>
      <span className={styles.text}>{text}</span>
      {hasDigits ? (
        <span className={styles.visual} aria-hidden="true">
          {tokens.map((token) => {
            if (token.kind === 'char') {
              return <span key={token.key} className={styles.char} data-char={token.char} />;
            }
            const style = {
              ['--pos' as string]: rolled ? 10 + token.digit : 0,
              ['--col' as string]: column++,
            } as CSSProperties;
            return (
              <span
                key={token.key}
                className={styles.digit}
                data-digit={token.digit}
                style={style}
              />
            );
          })}
        </span>
      ) : (
        <span className={styles.visual} aria-hidden="true">
          <span className={styles.char} data-char={text} />
        </span>
      )}
    </span>
  );
}
