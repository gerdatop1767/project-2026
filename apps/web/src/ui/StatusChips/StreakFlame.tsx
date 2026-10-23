import { useId } from 'react';
import type { StreakTier } from '@zybrilka/shared';
import styles from './StreakFlame.module.css';

/**
 * The streak flame: one drawn flame whose look grows with the streak tier
 * (see @zybrilka/shared streakTiers — 1–4, 5–14, 15–29, 30–39, 40–59, 60+).
 * Same silhouette at every tier; the tier changes its colours, the glow
 * behind it, a brighter core and — from tier 5 — a few sparks. Tier 0 (no
 * active streak) is a quiet grey outline, never a lit flame.
 *
 * Motion is CSS transform/opacity only: tiers 1–2 are still; from tier 3
 * the flame sways gently; `levelUp` plays a one-off burst. Reduced motion:
 * everything static.
 */
const palettes: Record<
  Exclude<StreakTier, 0>,
  { outer: [string, string, string]; core: [string, string]; glow: string }
> = {
  1: { outer: ['#ffb14a', '#ff8a2a', '#ff6a1a'], core: ['#fff1c4', '#ffc85a'], glow: '#ff8a2a' },
  2: { outer: ['#ffa53d', '#ff6a1f', '#f2401b'], core: ['#fff3c9', '#ffb84a'], glow: '#ff6a1f' },
  3: { outer: ['#ffb23d', '#ff4d4d', '#e0247a'], core: ['#fff6d6', '#ffd166'], glow: '#ff4d6d' },
  4: { outer: ['#ff9ad5', '#c04dff', '#7a2cf0'], core: ['#ffffff', '#ffd3f5'], glow: '#c04dff' },
  5: { outer: ['#7fd8ff', '#6c7bff', '#9b3cf6'], core: ['#ffffff', '#ffe08a'], glow: '#7c6bff' },
  6: { outer: ['#5ef0d8', '#7a6bff', '#f04dc2'], core: ['#fffbe6', '#ffd24a'], glow: '#b05cff' },
};

const OUTER =
  'M12 2.2c.6 2.6 2.4 4.2 4 6 1.7 1.9 3 3.9 3 6.6A7 7 0 0 1 12 21.8a7 7 0 0 1-7-7c0-2.2.9-3.9 2.2-5.3.3 1.3 1 2.3 2.1 2.8C9 9.4 9.4 5 12 2.2Z';
const CORE =
  'M12 11.2c.5 1.5 1.6 2.3 2.4 3.4.6.8.9 1.5.9 2.4A3.3 3.3 0 0 1 12 20.3 3.3 3.3 0 0 1 8.7 17c0-1.4.8-2.4 1.6-3.2.3.6.7 1 1.2 1.2-.2-1.3 0-2.6.5-3.8Z';

export function StreakFlame({
  tier,
  levelUp = false,
  size = 22,
  className,
}: {
  tier: StreakTier;
  /** Play the one-off "new tier" burst (only on a real increase). */
  levelUp?: boolean;
  size?: number;
  className?: string;
}) {
  const id = useId().replace(/:/g, '');
  if (tier === 0) {
    return (
      <svg
        className={`${styles.flame} ${className ?? ''}`}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        aria-hidden="true"
        data-tier={0}
      >
        <path
          d={OUTER}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
          opacity="0.55"
        />
      </svg>
    );
  }
  const p = palettes[tier];
  return (
    <svg
      className={`${styles.flame} ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-tier={tier}
      data-level-up={levelUp || undefined}
      overflow="visible"
    >
      <defs>
        <radialGradient id={`g${id}`} cx="50%" cy="62%" r="50%">
          <stop offset="0%" stopColor={p.glow} stopOpacity="0.55" />
          <stop offset="100%" stopColor={p.glow} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`o${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={p.outer[0]} />
          <stop offset="55%" stopColor={p.outer[1]} />
          <stop offset="100%" stopColor={p.outer[2]} />
        </linearGradient>
        <linearGradient id={`c${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={p.core[0]} />
          <stop offset="100%" stopColor={p.core[1]} />
        </linearGradient>
      </defs>
      <circle className={styles.glow} cx="12" cy="14.5" r="11" fill={`url(#g${id})`} />
      {levelUp && (
        <circle
          className={styles.ring}
          cx="12"
          cy="14"
          r="8"
          fill="none"
          stroke={p.glow}
          strokeWidth="1.5"
        />
      )}
      <g className={styles.body}>
        <path d={OUTER} fill={`url(#o${id})`} />
        <path className={styles.core} d={CORE} fill={`url(#c${id})`} />
      </g>
      {tier >= 5 && (
        <g className={styles.sparks} fill={p.core[1]}>
          <circle cx="5.2" cy="7.5" r="0.9" />
          <circle cx="18.6" cy="6.2" r="0.8" />
          {tier === 6 && <circle cx="16.8" cy="2.8" r="0.7" />}
        </g>
      )}
    </svg>
  );
}
