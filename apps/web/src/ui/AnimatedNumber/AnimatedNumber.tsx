import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { clsx } from '../../lib/clsx.js';
import styles from './AnimatedNumber.module.css';

export interface AnimatedNumberProps {
  /**
   * The value exactly as it should finally read — already formatted
   * ("1 234+", "70%", "70 с"). A number is formatted with ru-RU grouping.
   * Text without a whole number in it ("···", "—", "Полная", "2,5") is
   * shown as is, unanimated.
   */
  value: string | number;
  className?: string;
}

/** Count-up length: quick, so the real figure is there almost at once. */
const DURATION_MS = 520;

/** The first whole number in the text (with ru-RU group spaces). */
const NUMBER = /\d{1,3}(?:[\s\u00a0\u202f]\d{3})+|\d+/;

interface Parsed {
  prefix: string;
  target: number;
  suffix: string;
}

function parse(text: string): Parsed | null {
  const match = NUMBER.exec(text);
  if (!match) return null;
  const after = text.slice(match.index + match[0].length);
  // A fraction ("2,5", "3.14") is not counted: it would read as noise.
  if (/^[.,]\d/.test(after)) return null;
  const target = Number(match[0].replace(/\D/g, ''));
  if (!Number.isSafeInteger(target)) return null;
  return { prefix: text.slice(0, match.index), target, suffix: after };
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * A number that counts up to its real value — 0, 1, 2, 3… — and lands on
 * it in about half a second (ease-out: fast at first, settling at the end).
 * It plays once, when the number is first on screen and the real value has
 * arrived; while the caller has nothing yet it passes its placeholder
 * ("···"), which is shown as is — it never counts toward a guess. When the
 * real value later changes (another subject, another period) it counts from
 * the old figure to the new one; a re-render with the same value does
 * nothing. Formatting (group spaces, "+", "%", units) is kept.
 *
 * The final value is laid out (invisibly) under the counting one, so the
 * number's box has its final width from the first frame — nothing around
 * it shifts while it counts. The visible figures are drawn by CSS
 * (`::before`), so the element's text is just the final value, in a
 * visually hidden span for screen readers, copy and tests. With
 * `prefers-reduced-motion` (or no IntersectionObserver) the value is
 * simply shown.
 */
export function AnimatedNumber({ value, className }: AnimatedNumberProps) {
  const text = typeof value === 'number' ? value.toLocaleString('ru-RU') : value;
  const parsed = parse(text);
  const target = parsed?.target ?? null;

  const ref = useRef<HTMLSpanElement>(null);
  const [instant] = useState(
    () => typeof IntersectionObserver === 'undefined' || prefersReducedMotion(),
  );
  const [inView, setInView] = useState(instant);
  // The figure on screen while counting; null = the final text.
  const [shown, setShown] = useState<number | null>(instant ? null : 0);
  const from = useRef(0);

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
      { threshold: 0.4 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [inView]);

  // Layout effect: when the value changes, the count restarts from the old
  // figure before paint — never a frame of the new value, then a jump back.
  useLayoutEffect(() => {
    if (instant || !inView || target === null) return;
    const start = from.current;
    if (start !== target) setShown(start);
    const begin = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const progress = start === target ? 1 : Math.min(1, (now - begin) / DURATION_MS);
      if (progress < 1) {
        const eased = 1 - Math.pow(1 - progress, 3);
        setShown(Math.round(start + (target - start) * eased));
        frame = requestAnimationFrame(tick);
      } else {
        from.current = target;
        setShown(null);
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      // Interrupted (the value changed mid-count): carry on from the new one.
      from.current = target;
    };
  }, [instant, inView, target]);

  const counting = parsed !== null && shown !== null;
  const figure = counting
    ? `${parsed.prefix}${shown.toLocaleString('ru-RU')}${parsed.suffix}`
    : text;

  return (
    <span
      ref={ref}
      className={clsx(styles.root, className)}
      data-animated-number
      data-counting={counting || undefined}
    >
      <span className={styles.text}>{text}</span>
      <span className={styles.visual} aria-hidden="true">
        {/* Holds the final width; the counting figure sits on top of it. */}
        <span className={styles.sizer} data-text={text} />
        <span className={styles.figure} data-text={figure} />
      </span>
    </span>
  );
}
