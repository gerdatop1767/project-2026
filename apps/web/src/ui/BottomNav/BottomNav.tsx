import { Icon } from '../Icon/Icon.js';
import type { IconName } from '../Icon/icons.js';
import { clsx } from '../../lib/clsx.js';
import styles from './BottomNav.module.css';

export interface BottomNavItem {
  id: string;
  label: string;
  icon: IconName;
  /** Needs an account (guest mode): a small lock, and a tap explains why. */
  locked?: boolean;
}

export interface BottomNavProps {
  items: readonly BottomNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  className?: string;
}

/**
 * Primary navigation foundation (Design Spec Section 3): 5 items on
 * mobile and tablet widths (the desktop shell has its own sidebar). Task/battle screens
 * hide this entirely — that's the screen's job, not this component's.
 */
export function BottomNav({ items, activeId, onSelect, className }: BottomNavProps) {
  return (
    <nav className={clsx(styles.nav, className)} aria-label="Zybrilka" data-bottom-nav>
      {items.map((item) => {
        const isActive = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            className={styles.item}
            aria-current={isActive ? 'page' : undefined}
            aria-label={item.locked ? `${item.label} — нужен вход` : undefined}
            data-locked={item.locked || undefined}
            onClick={() => onSelect(item.id)}
          >
            <span className={styles.iconWrap}>
              <Icon name={item.icon} filled={isActive} size={22} />
              {item.locked && (
                <span className={styles.lock} aria-hidden="true">
                  <Icon name="lock" size={10} />
                </span>
              )}
            </span>
            <span className={styles.label}>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
