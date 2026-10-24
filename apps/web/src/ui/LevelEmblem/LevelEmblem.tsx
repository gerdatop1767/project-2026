import { useId } from 'react';
import { clsx } from '../../lib/clsx.js';
import { levelRankStyle, type LevelRank } from '../../lib/levelRanks.js';
import styles from './LevelEmblem.module.css';

export interface LevelEmblemProps {
  rank: LevelRank;
  /** Shown in the middle of the emblem (omit for a plain rank badge). */
  level?: number;
  size?: number;
  /** The rank's idle motion (sheen, halo, orbit…) — for the one large emblem
   * on the «Уровень» page, never for lists or the header. */
  animated?: boolean;
  /** Greyed out: a rank not reached yet. */
  locked?: boolean;
  className?: string;
}

/**
 * A rank emblem: the outline grows richer with every rank — a disc, a
 * shield, a hexagon, a laurelled hexagon, a crowned crest, a radiant
 * laurelled star.
 * Pure SVG + CSS (no images), coloured by the rank's palette. Decorative:
 * the level and rank are always also written as text next to it.
 */
export function LevelEmblem({
  rank,
  level,
  size = 56,
  animated = false,
  locked = false,
  className,
}: LevelEmblemProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const fill = `url(#${id}-fill)`;
  const edge = `url(#${id}-edge)`;
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
      {animated && <span className={styles.halo} />}
      <svg viewBox="0 0 64 64" className={styles.svg}>
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--rank-from)" />
            <stop offset="1" stopColor="var(--rank-to)" />
          </linearGradient>
          <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
            <stop offset="1" stopColor="#fff" stopOpacity="0.15" />
          </linearGradient>
          <clipPath id={`${id}-clip`}>
            <Shape index={rank.index} />
          </clipPath>
        </defs>
        {rank.index >= 3 && <Laurels fill={fill} />}
        {rank.index >= 5 && <Rays fill={fill} />}
        <g fill={fill} stroke={edge} strokeWidth="1.5">
          <Shape index={rank.index} />
        </g>
        {rank.index === 4 && <Crown fill={fill} edge={edge} />}
        {/* A soft light band that sweeps across (animated emblems only). */}
        <g clipPath={`url(#${id}-clip)`}>
          <rect className={styles.sheen} x="-40" y="0" width="22" height="64" fill="#fff" />
        </g>
      </svg>
      {level !== undefined && (
        <span className={styles.level} style={{ fontSize: size * 0.32 }}>
          {level}
        </span>
      )}
    </span>
  );
}

/** The body outline for each rank (centred on 32,34). */
function Shape({ index }: { index: number }) {
  switch (index) {
    case 0:
      return <circle cx="32" cy="34" r="19" />;
    case 1:
      return <path d="M32 13 L50 20 V35 C50 46 42 52 32 56 C22 52 14 46 14 35 V20 Z" />;
    case 2:
      return <path d="M32 13 L50 23.5 V44.5 L32 55 L14 44.5 V23.5 Z" />;
    case 3:
      return <path d="M32 14 L49 24 V44 L32 54 L15 44 V24 Z" />;
    case 4:
      return <path d="M32 20 L48 27 V40 C48 49 41 54 32 57 C23 54 16 49 16 40 V27 Z" />;
    default:
      return (
        <path d="M32.0 11.0 L38.9 17.4 L48.3 17.7 L48.6 27.1 L55.0 34.0 L48.6 40.9 L48.3 50.3 L38.9 50.6 L32.0 57.0 L25.1 50.6 L15.7 50.3 L15.4 40.9 L9.0 34.0 L15.4 27.1 L15.7 17.7 L25.1 17.4 Z" />
      );
  }
}

function Laurels({ fill }: { fill: string }) {
  const leaf = 'M0 0 C3 -3 7 -3 9 0 C7 3 3 3 0 0 Z';
  const leaves = [0, 1, 2, 3];
  return (
    <g fill={fill} opacity="0.85">
      {leaves.map((i) => (
        <path
          key={`l${i}`}
          d={leaf}
          transform={`translate(${12 - i} ${48 - i * 8}) rotate(${-100 + i * 18})`}
        />
      ))}
      {leaves.map((i) => (
        <path
          key={`r${i}`}
          d={leaf}
          transform={`translate(${52 + i} ${48 - i * 8}) rotate(${-80 - i * 18})`}
        />
      ))}
    </g>
  );
}

function Crown({ fill, edge }: { fill: string; edge: string }) {
  return (
    <path
      d="M21 21 L24 9 L29 16 L32 6 L35 16 L40 9 L43 21 Z"
      fill={fill}
      stroke={edge}
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
  );
}

function Rays({ fill }: { fill: string }) {
  return (
    <g fill={fill} opacity="0.35">
      {Array.from({ length: 12 }, (_, i) => (
        <path key={i} d="M31 3 L33 3 L32 12 Z" transform={`rotate(${i * 30} 32 34)`} />
      ))}
    </g>
  );
}
