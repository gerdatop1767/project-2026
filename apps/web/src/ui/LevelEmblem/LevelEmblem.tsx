import { clsx } from '../../lib/clsx.js';
import { levelRankStyle, type LevelRank, type LevelRankId } from '../../lib/levelRanks.js';
import styles from './LevelEmblem.module.css';

/** The approved rank artwork (fixed brand assets in public/branding/v2/levels,
 * as provided — 256 px with transparency, sharp from the header to the hero). */
export const LEVEL_EMBLEM_SRC: Record<LevelRankId, string> = {
  novice: '/branding/v2/levels/novice.webp',
  apprentice: '/branding/v2/levels/apprentice.webp',
  scholar: '/branding/v2/levels/scholar.webp',
  expert: '/branding/v2/levels/expert.webp',
  legend: '/branding/v2/levels/legend.webp',
};

export interface LevelEmblemProps {
  rank: LevelRank;
  /** Shown in a small tag under the emblem (the hero on «Уровень»). */
  level?: number;
  size?: number;
  /** A short one-time entrance — for the one large emblem on «Уровень»,
   * never for lists or the header. */
  animated?: boolean;
  /** Greyed out: a rank not reached yet. */
  locked?: boolean;
  /** Eager for the emblem visible on first paint (header, hero). */
  priority?: boolean;
  className?: string;
}

/**
 * A rank emblem — the approved artwork for each of the six ranks. Decorative:
 * the level and rank are always written next to it as text.
 */
export function LevelEmblem({
  rank,
  level,
  size = 56,
  animated = false,
  locked = false,
  priority = false,
  className,
}: LevelEmblemProps) {
  return (
    <span
      className={clsx(
        styles.emblem,
        animated && styles.animated,
        locked && styles.locked,
        className,
      )}
      data-rank={rank.id}
      style={{ ...levelRankStyle(rank), width: size, height: size }}
      aria-hidden="true"
    >
      <img
        className={styles.art}
        src={LEVEL_EMBLEM_SRC[rank.id]}
        width={size}
        height={size}
        alt=""
        draggable={false}
        decoding="async"
        loading={priority ? 'eager' : 'lazy'}
      />
      {level !== undefined && (
        <span className={styles.levelTag} style={{ fontSize: Math.max(11, size * 0.17) }}>
          {level}
        </span>
      )}
    </span>
  );
}
