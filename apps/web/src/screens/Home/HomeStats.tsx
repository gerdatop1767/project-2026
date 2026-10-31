import type { ReactNode } from 'react';
import { clsx } from '../../lib/clsx.js';
import { Icon } from '../../ui/Icon/Icon.js';
import type { IconName } from '../../ui/Icon/icons.js';
import styles from './HomeStats.module.css';

export interface HomeStat {
  id: string;
  tone: 'gold' | 'green' | 'purple';
  icon: IconName;
  /** The value as shown: a real number, «—» (none / failed) or «···» (loading). */
  value: string;
  label: string;
  /** True once a real answer is in (a number or an honest «—»). */
  ready: boolean;
  /** Makes the whole cell a button (the place opens the rating). */
  onClick?: () => void;
  ariaLabel?: string;
}

/**
 * Mobile home stats (approved reference mobile-stats-design-reference):
 * one dark glass panel with a thin glowing edge, three cells — place
 * (gold), solved (green), accuracy (purple). The panel fades in once; a
 * value that changes re-mounts its own span, which plays a short rise and
 * a soft glow behind the icon — once, never in a loop. Cells are equal
 * grid columns, so a longer number never moves its neighbours. Narrow
 * phones stack icon over text (container query), wider ones put them
 * side by side as in the reference.
 */
export function HomeStats({ items }: { items: readonly HomeStat[] }) {
  return (
    <div className={styles.panel}>
      <div className={styles.grid}>
        {items.map((item) => {
          const body: ReactNode = (
            <>
              {/* Keyed by the value: a new value plays the glow once. */}
              {item.ready && <span key={item.value} className={styles.flash} aria-hidden="true" />}
              <span
                className={styles.tile}
                data-ready={item.ready ? '' : undefined}
                aria-hidden="true"
              >
                <Icon name={item.icon} size={20} />
              </span>
              <span className={styles.text}>
                <span key={item.value} className={styles.value}>
                  {item.value}
                </span>
                <span className={styles.label} data-stat-label>
                  {item.label}
                </span>
              </span>
            </>
          );
          return item.onClick ? (
            <button
              key={item.id}
              type="button"
              className={clsx(styles.cell, styles.cellButton)}
              data-tone={item.tone}
              aria-label={item.ariaLabel}
              onClick={item.onClick}
            >
              {body}
            </button>
          ) : (
            <div key={item.id} className={styles.cell} data-tone={item.tone}>
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}
