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

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * A number that is revealed from left to right: its characters come into
 * view one after another, each wiped in from its left edge with a slight
 * glide, so the whole value reads like it is being written out. It plays
 * when the number first scrolls into view — not on every render; a value
 * that changes later simply updates. Formatting (spaces, "+", "%", units)
 * is kept as given.
 *
 * Every character is laid out at its final place from the first frame (only
 * its visibility animates), so nothing around the number shifts or jumps
 * while it plays, whatever the length or grouping of the value.
 *
 * Honest by construction: it only ever shows the real value it is given;
 * while the caller has nothing yet it passes its placeholder ("···"), which
 * is shown as is.
 *
 * The visible characters are drawn by CSS (`::before`), so the element's
 * text is just the value, in a visually hidden span for screen readers,
 * copy and tests. With `prefers-reduced-motion` (or no
 * IntersectionObserver) the value is simply shown.
 */
export function AnimatedNumber({ value, className }: AnimatedNumberProps) {
  const text = typeof value === 'number' ? value.toLocaleString('ru-RU') : value;
  const chars = [...text];
  const hasDigits = chars.some((char) => /\d/.test(char));

  const ref = useRef<HTMLSpanElement>(null);
  const [instant] = useState(
    () => typeof IntersectionObserver === 'undefined' || prefersReducedMotion(),
  );
  const [inView, setInView] = useState(instant);
  const [revealed, setRevealed] = useState(instant);

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

  // Reveal once the real digits are both here and visible. Two frames: the
  // hidden state must be painted first, or there is nothing to transition from.
  useEffect(() => {
    if (instant || revealed || !inView || !hasDigits) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setRevealed(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [instant, revealed, inView, hasDigits]);

  return (
    <span
      ref={ref}
      className={clsx(styles.root, className)}
      data-animated-number
      data-instant={instant || undefined}
      data-revealed={revealed || !hasDigits || undefined}
    >
      <span className={styles.text}>{text}</span>
      <span className={styles.visual} aria-hidden="true">
        {hasDigits ? (
          chars.map((char, index) => (
            <span
              // Keyed from the right: the units stay the units when the value grows a digit.
              key={chars.length - 1 - index}
              className={styles.glyph}
              data-char={char}
              style={{ ['--i' as string]: index } as CSSProperties}
            />
          ))
        ) : (
          <span className={styles.plain} data-char={text} />
        )}
      </span>
    </span>
  );
}
