import type { ReactNode } from 'react';
import { Icon } from '../Icon/Icon.js';
import type { IconName } from '../Icon/icons.js';
import { AnimatedNumber } from '../AnimatedNumber/AnimatedNumber.js';
import styles from './StatTile.module.css';

export interface StatTileProps {
  icon: IconName;
  iconColor: string;
  label: string;
  /** Its digits roll into place (AnimatedNumber); text without digits ("—", "···") is shown as is. */
  value: number | string;
  suffix?: string;
  deltaLabel?: ReactNode;
  deltaDirection?: 'up' | 'down';
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
  className,
}: StatTileProps) {
  return (
    <div
      className={`${styles.tile} ${className ?? ''}`}
      style={{ ['--tile-color' as string]: iconColor }}
    >
      <span className={styles.iconBadge}>
        <Icon name={icon} size={20} />
      </span>
      <p className="text-body-sm text-secondary">{label}</p>
      <p className={styles.value}>
        <AnimatedNumber value={`${value}${suffix ?? ''}`} />
      </p>
      {deltaLabel && (
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
