import type { ReactNode } from 'react';
import { Icon } from '../Icon/Icon.js';
import type { IconName } from '../Icon/icons.js';
import { AnimatedNumber } from '../AnimatedNumber/AnimatedNumber.js';
import { SkeletonValue } from '../Skeleton/Skeleton.js';
import styles from './StatTile.module.css';

export interface StatTileProps {
  icon: IconName;
  iconColor: string;
  label: string;
  /** Counted up when `animate` (AnimatedNumber); text without digits ("—", "···") is shown as is. */
  value: number | string;
  suffix?: string;
  deltaLabel?: ReactNode;
  deltaDirection?: 'up' | 'down';
  /** Count the value up on first view — the Statistics screens only; everywhere
   * else (profile, mistakes…) the number is simply there. */
  animate?: boolean;
  /** The value is still loading: a value-sized placeholder instead of the
   * number (and of the caption under it), so the tile never changes size. */
  loading?: boolean;
  className?: string;
}

/**
 * Headline stat card (Statistics — the four top tiles on both
 * platforms: "Решено заданий" / "Правильных ответов" / "Среднее
 * время" / "Текущий уровень"). The value's digits roll into place the
 * first time the tile is seen, keeping its formatting ("70%", "2 мин").
 */
export function StatTile({
  icon,
  iconColor,
  label,
  value,
  suffix,
  deltaLabel,
  deltaDirection,
  animate = false,
  loading = false,
  className,
}: StatTileProps) {
  const text = `${value}${suffix ?? ''}`;
  return (
    <div
      aria-busy={loading || undefined}
      className={`${styles.tile} ${className ?? ''}`}
      style={{ ['--tile-color' as string]: iconColor }}
    >
      <span className={styles.iconBadge}>
        <Icon name={icon} size={20} />
      </span>
      <p className="text-body-sm text-secondary">{label}</p>
      <p className={styles.value}>
        {loading ? (
          <SkeletonValue width="2.5ch" />
        ) : animate ? (
          <AnimatedNumber value={text} />
        ) : (
          text
        )}
      </p>
      {loading && deltaLabel ? (
        <span className={styles.delta}>
          <SkeletonValue width="5rem" />
        </span>
      ) : null}
      {!loading && deltaLabel && (
        <span
          className={`${styles.delta} ${deltaDirection === 'down' ? styles.deltaDown : styles.deltaUp}`}
        >
          <Icon name={deltaDirection === 'down' ? 'trendDown' : 'trend'} size={14} />
          {deltaLabel}
        </span>
      )}
    </div>
  );
}
