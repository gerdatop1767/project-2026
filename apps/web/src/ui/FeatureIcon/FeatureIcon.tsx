import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import {
  BookOpenText,
  ChartNoAxesCombined,
  ClipboardCheck,
  Compass,
  FolderOpen,
  LibraryBig,
  NotebookPen,
  type LucideIcon,
} from 'lucide-react';
import { clsx } from '../../lib/clsx.js';
import { useRevealOnScroll } from '../SubjectIcon/useSubjectIconMotion.js';
import styles from './FeatureIcon.module.css';

export type FeatureIconName =
  'subjects' | 'tasks' | 'statistics' | 'theory' | 'practice' | 'strategy' | 'materials';

interface FeatureIconSpec {
  /** The glyph — from Lucide, the icon set the whole app already uses. */
  glyph: LucideIcon;
  /** Its one accent colour: the badge tint, the glyph's gradient end, the glow. */
  accent: string;
}

const specs: Record<FeatureIconName, FeatureIconSpec> = {
  subjects: { glyph: LibraryBig, accent: '#b16cff' },
  tasks: { glyph: ClipboardCheck, accent: '#4da3ff' },
  statistics: { glyph: ChartNoAxesCombined, accent: '#2ee6a6' },
  theory: { glyph: BookOpenText, accent: '#ce3dfd' },
  practice: { glyph: NotebookPen, accent: '#4dd6e8' },
  strategy: { glyph: Compass, accent: '#ffc04d' },
  materials: { glyph: FolderOpen, accent: '#ff7a8a' },
};

/** The icon's accent colour, for a card that wants to light up in it. */
export function featureIconGlow(name: FeatureIconName): string {
  return specs[name].accent;
}

/** The whole first reveal, delays included — see FeatureIcon.module.css. */
const SCENE_MS = 1300;

export interface FeatureIconProps {
  name: FeatureIconName;
  /** Draws itself in when first scrolled into view (default on). */
  reveal?: boolean;
  className?: string;
}

/**
 * A feature icon: a Lucide glyph (the app's own icon set, so every line sits
 * on the same precise 24 px grid) in a softly lit glass badge, its strokes
 * running from white into the accent colour, with a faint glow of that
 * colour behind.
 *
 * Motion: when first seen the badge settles in and the glyph's lines draw
 * themselves; hovering the icon or the card holding it (`data-icon-host`)
 * lifts the glyph a touch and warms the glow. Only `transform`, `opacity`,
 * `stroke-dashoffset` and `box-shadow` change; with `prefers-reduced-motion`
 * the icon is simply there.
 *
 * Decorative (`aria-hidden`): the label is always written next to it.
 */
export function FeatureIcon({ name, reveal = true, className }: FeatureIconProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const state = useRevealOnScroll(ref, reveal);
  const gradientId = `fi-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const { glyph: Glyph, accent } = specs[name];

  // Make every stroke drawable: unit path length and its order (see the CSS).
  // Before the first paint, or the dash pattern would flash in user units.
  useLayoutEffect(() => {
    ref.current?.querySelectorAll<SVGElement>(`.${styles.svg} > *`).forEach((shape, index) => {
      shape.setAttribute('pathLength', '1');
      shape.style.setProperty('--i', String(index));
    });
  }, [name]);

  // After the first reveal, drop its delays so hover answers at once.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (state !== 'shown' || settled) return;
    const timer = window.setTimeout(() => setSettled(true), SCENE_MS);
    return () => window.clearTimeout(timer);
  }, [state, settled]);

  return (
    <span
      ref={ref}
      className={clsx(styles.root, className)}
      data-icon={name}
      data-reveal={state}
      data-settled={settled || undefined}
      style={
        {
          ['--accent' as string]: accent,
          ['--stroke' as string]: `url(#${gradientId})`,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      {/* The glyph's stroke gradient, in the glyph's own 24 px user space. */}
      <svg className={styles.defs} width="0" height="0" focusable="false">
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1="4"
          y1="3"
          x2="20"
          y2="21"
        >
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.5" stopColor="#ffffff" />
          <stop offset="1" stopColor={accent} />
        </linearGradient>
      </svg>
      <span className={styles.glyph}>
        <Glyph className={styles.svg} strokeWidth={1.7} focusable="false" />
      </span>
    </span>
  );
}
