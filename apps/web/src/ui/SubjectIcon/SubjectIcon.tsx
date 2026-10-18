import { useEffect, useRef, type CSSProperties } from 'react';
import { clsx } from '../../lib/clsx.js';
import {
  SUBJECT_ICON_GLOW,
  isSubjectIconId,
  subjectIconSrc,
  type SubjectIconId,
} from './subjectIcons.js';
import { usePointerParallax, usePressFeedback, useRevealOnScroll } from './useSubjectIconMotion.js';
import styles from './SubjectIcon.module.css';

export interface SubjectIconProps {
  /** App subject id (`math`, `russian`, …). Unknown ids render nothing. */
  subjectId: string;
  /** Persistent glow + thin luminous outline; readable without any animation. */
  selected?: boolean;
  /** Fade/rise in when scrolled into view; the number staggers neighbours (~65 ms apart). */
  reveal?: number | boolean;
  /** Light pointer parallax (desktop only). Meant for the larger artwork. */
  parallax?: boolean;
  /** Extra sizing class from the caller; the icon fills its box by default. */
  className?: string;
}

const STAGGER_MS = 65;
const MAX_STAGGER_STEPS = 4;

/**
 * The approved subject artwork with its premium micro-motion:
 * - idle: a very soft halo in the icon's own colour, breathing slowly;
 * - hover (fine pointers only): scale ~1.04, small lift, stronger halo;
 * - press / tap (every pointer, via pointer events): quick dip to 0.97 and a
 *   smooth return;
 * - selected: steady halo and a thin luminous outline;
 * - reveal: opacity + translateY + scale .96 → 1 on first scroll into view.
 *
 * Hover/press react to the icon itself or to the nearest ancestor that
 * carries `data-subject-interactive` (the whole card), so a tap anywhere on a
 * card gives feedback. Only `transform` and `opacity` are animated, and
 * `prefers-reduced-motion` switches all motion off (the glow stays, static).
 * The picture is decorative (`alt=""`): the subject name is always written
 * next to it.
 */
export function SubjectIcon({
  subjectId,
  selected = false,
  reveal = false,
  parallax = false,
  className,
}: SubjectIconProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const revealState = useRevealOnScroll(ref, reveal !== false);
  usePointerParallax(ref, parallax);
  usePressFeedback(ref);

  // Hand the icon's colour to the card it sits in, so the card can glow in it.
  useEffect(() => {
    const host = ref.current?.closest<HTMLElement>('[data-subject-interactive]');
    if (host && isSubjectIconId(subjectId)) {
      host.style.setProperty('--subject-glow', SUBJECT_ICON_GLOW[subjectId]);
    }
  }, [subjectId]);

  if (!isSubjectIconId(subjectId)) return null;
  const id: SubjectIconId = subjectId;
  const step = typeof reveal === 'number' ? Math.min(reveal, MAX_STAGGER_STEPS) : 0;

  return (
    <span
      ref={ref}
      className={clsx(styles.root, className)}
      data-reveal={revealState}
      data-selected={selected || undefined}
      style={
        {
          ['--glow' as string]: SUBJECT_ICON_GLOW[id],
          ['--reveal-delay' as string]: `${step * STAGGER_MS}ms`,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      <span className={styles.halo} />
      <span className={styles.body}>
        <img
          src={subjectIconSrc(id)}
          alt=""
          width={512}
          height={512}
          className={styles.image}
          decoding="async"
          draggable={false}
        />
        <span className={styles.ring} />
      </span>
    </span>
  );
}
