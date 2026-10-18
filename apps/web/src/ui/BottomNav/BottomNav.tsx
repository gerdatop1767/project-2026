import { Icon } from '../Icon/Icon.js';
import type { IconName } from '../Icon/icons.js';
import { clsx } from '../../lib/clsx.js';
import styles from './BottomNav.module.css';

export interface BottomNavItem {
  id: string;
  label: string;
  icon: IconName;
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
    <nav className={clsx(styles.nav, className)} aria-label="Zybrilka">
      {items.map((item) => {
        const isActive = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            className={styles.item}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onSelect(item.id)}
          >
            <Icon name={item.icon} filled={isActive} size={22} />
            <span className={styles.label}>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
