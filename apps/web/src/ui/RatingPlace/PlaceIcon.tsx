import { clsx } from '../../lib/clsx.js';
import { Icon } from '../Icon/Icon.js';
import styles from './PlaceIcon.module.css';

export type PlaceVariant = 'gold' | 'silver' | 'bronze' | 'place' | 'none';

/** 1–3 get their medal metal; any other place the brand accent; no place
 * (no points yet / not loaded) a muted badge. */
export function placeVariant(rank: number | null | undefined): PlaceVariant {
  if (rank === 1) return 'gold';
  if (rank === 2) return 'silver';
  if (rank === 3) return 'bronze';
  return rank ? 'place' : 'none';
}

/** «#6», or «—» without a place — never a made-up number. */
export function formatPlace(rank: number | null | undefined): string {
  return rank ? `#${rank}` : '—';
}

export interface PlaceIconProps {
  rank: number | null | undefined;
  size?: number;
  className?: string;
}

/**
 * The rating-place badge (a place in the rating — never the level, which has
 * its own emblem): a round badge with the same trophy glyph as the rest of
 * the interface (lucide). Gold, silver and bronze for places 1–3, the accent
 * for any other place. Decorative: the place is always written next to it.
 */
export function PlaceIcon({ rank, size = 22, className }: PlaceIconProps) {
  return (
    <span
      className={clsx(styles.badge, className)}
      data-variant={placeVariant(rank)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Icon name="achievements" size={Math.round(size * 0.58)} />
    </span>
  );
}
