import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { clsx } from '../../lib/clsx.js';
import styles from './Landing.module.css';

type RevealState = 'off' | 'pending' | 'shown';

interface RevealProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  /** Element to render — sections reveal as <section>, list items as <li>, … */
  as?: ElementType;
  /** Stagger step among siblings that enter together (~60 ms apart). */
  step?: number;
}

const STAGGER_MS = 60;
const MAX_STEPS = 5;

function initialState(): RevealState {
  if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return 'off';
  // Reduced motion still reveals — as a plain fade (see Landing.module.css).
  return 'pending';
}

/**
 * One-shot scroll reveal for the landing's sections: opacity + a short
 * rise, played once when the block first nears the viewport. The hidden
 * state only exists while an IntersectionObserver is actually waiting,
 * so a missing API (old WebView, jsdom) can never leave content invisible.
 * Driven by a CSS transition rather than a keyframe, so a fast scroll that
 * flips the state mid-way retargets smoothly instead of restarting.
 */
export function Reveal({
  children,
  as: Tag = 'div',
  step = 0,
  className,
  style,
  ...rest
}: RevealProps) {
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState<RevealState>(initialState);

  useEffect(() => {
    if (state !== 'pending') return;
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setState('shown');
          observer.disconnect();
        }
      },
      // Bottom: start once the block is a little way into view. Top: the root
      // reaches far above the viewport, so a block that a fast fling, End
      // key or anchor jump carried past without ever "crossing" the screen
      // still counts as seen — nothing can stay hidden above the fold.
      { rootMargin: '100000px 0px -8% 0px', threshold: 0.12 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [state]);

  const delay = Math.min(step, MAX_STEPS) * STAGGER_MS;

  return (
    <Tag
      ref={ref}
      className={clsx(styles.reveal, className)}
      data-reveal={state}
      style={{ ...style, ['--reveal-delay' as string]: `${delay}ms` } as CSSProperties}
      {...rest}
    >
      {children}
    </Tag>
  );
}
