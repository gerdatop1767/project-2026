import type { CSSProperties } from 'react';
import type { TaskNumberProgress } from '../../data/sampleStatistics.js';
import { clsx } from '../../lib/clsx.js';
import { Icon } from '../Icon/Icon.js';
import { progressStatusLabel, progressTone } from './progressTone.js';
import styles from './TaskNumberGrid.module.css';

export interface TaskNumberGridProps {
  rows: readonly TaskNumberProgress[];
  onSelect?: (number: number) => void;
  /** The number whose details are open — outlined, independently of its progress colour. */
  activeNumber?: number | null;
  /** Denser cards (no count line, smaller ring) where every number must
   * stay quickly scannable in little space. */
  compact?: boolean;
}

/** Ring geometry (viewBox 0 0 36 36). */
const R = 15;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * "Задания по номерам": a card per EGE task number — the number, a ring
 * showing how much of it is solved (a check when all of it is), an honest
 * status ("Решено" / "10%" / "Не решалось"), the real "N из M" count and a
 * bar along the bottom. Colour follows the shared progress tones: green
 * done, violet partial, muted red-violet barely started, neutral navy not
 * started (no fill at all). The selected number gets an outline of its own
 * so selection never repaints the progress colour.
 */
export function TaskNumberGrid({
  rows,
  onSelect,
  activeNumber = null,
  compact = false,
}: TaskNumberGridProps) {
  return (
    <div
      className={clsx(styles.grid, compact && styles.gridCompact)}
      role="list"
      aria-label="Прогресс по всем заданиям"
    >
      {rows.map((row) => {
        const tone = progressTone(row);
        const percent = tone === 'empty' ? 0 : (row.percent ?? 0);
        const active = row.number === activeNumber;
        return (
          <button
            key={row.number}
            type="button"
            className={clsx(styles.card, compact && styles.cardCompact)}
            role="listitem"
            data-tone={tone}
            data-active={active || undefined}
            aria-current={active ? 'true' : undefined}
            onClick={() => onSelect?.(row.number)}
            style={{ ['--p' as string]: percent } as CSSProperties}
          >
            <span className={styles.head}>
              <span className={styles.number}>№{row.number}</span>
              <span className={styles.ring} aria-hidden="true">
                {tone === 'done' ? (
                  <span className={styles.ringDone}>
                    <Icon name="check" size={compact ? 12 : 16} />
                  </span>
                ) : (
                  <svg viewBox="0 0 36 36" className={styles.ringSvg}>
                    <circle className={styles.ringTrack} cx="18" cy="18" r={R} />
                    {percent > 0 && (
                      <circle
                        className={styles.ringArc}
                        cx="18"
                        cy="18"
                        r={R}
                        strokeDasharray={`${(percent / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
                      />
                    )}
                  </svg>
                )}
              </span>
            </span>
            <span className={styles.status}>{progressStatusLabel(row)}</span>
            {!compact && (
              <span className={styles.foot}>
                {row.total !== undefined && (
                  <span className={styles.count}>
                    {row.completed ?? 0} из {row.total}
                  </span>
                )}
                <span className={styles.chevron} aria-hidden="true">
                  <Icon name="chevronRight" size={14} />
                </span>
              </span>
            )}
            <span className={styles.track}>
              <span className={styles.fill} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
