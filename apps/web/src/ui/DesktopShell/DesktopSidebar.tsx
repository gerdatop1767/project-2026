import { useNavigation, type Route } from '../../lib/navigation.js';
import { Icon } from '../Icon/Icon.js';
import type { IconName } from '../Icon/icons.js';
import { clsx } from '../../lib/clsx.js';
import styles from './DesktopShell.module.css';

interface SidebarItem {
  id: string;
  label: string;
  icon: IconName;
  route: Route;
}

const sidebarItems: readonly SidebarItem[] = [
  {
    id: 'learningCenter',
    label: 'Учебный центр',
    icon: 'topic',
    route: { screen: 'learningCenter' },
  },
  {
    id: 'subjectCatalog',
    label: 'Предметы',
    icon: 'grid',
    route: { screen: 'subjectCatalog' },
  },
  { id: 'training', label: 'Тренировка', icon: 'training', route: { screen: 'training' } },
  { id: 'statistics', label: 'Статистика', icon: 'progress', route: { screen: 'statistics' } },
  { id: 'mistakes', label: 'Мои ошибки', icon: 'warning', route: { screen: 'mistakes' } },
  {
    id: 'achievements',
    label: 'Достижения',
    icon: 'achievements',
    route: { screen: 'achievements' },
  },
  { id: 'rating', label: 'Рейтинг', icon: 'crown', route: { screen: 'rating' } },
  { id: 'friends', label: 'Друзья', icon: 'friends', route: { screen: 'friends' } },
];

/**
 * Desktop's persistent left sidebar. Home has no entry of its own: for a
 * signed-in visitor `/` IS the Учебный центр, so that entry is the active
 * one there. Home is still the tab underneath every overlay and the
 * target of BackRow.
 */
export function DesktopSidebar() {
  const { tab, overlay, navigate } = useNavigation();
  const currentId = overlay?.screen ?? (tab === 'home' ? 'learningCenter' : tab);

  return (
    <nav className={styles.sidebar} aria-label="Zybrilka">
      {sidebarItems.map((item) => {
        const isActive = item.id === currentId;
        return (
          <button
            key={item.id}
            type="button"
            className={clsx(styles.sidebarItem, isActive && styles.sidebarItemActive)}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => navigate(item.route)}
          >
            <Icon name={item.icon} size={20} filled={isActive} />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
