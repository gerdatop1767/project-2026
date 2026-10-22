import { useState } from 'react';
import { Overlay } from '../Overlay/Overlay.js';
import { Icon } from '../Icon/Icon.js';
import type { IconName } from '../Icon/icons.js';
import { SubjectTile } from '../SubjectTile/SubjectTile.js';
import { Avatar } from '../Leaderboard/Avatar.js';
import { type MainTabId, type OverlayRoute } from '../../lib/navigation.js';
import { useAccountGate } from '../../lib/accountGate.js';
import { useAuth } from '../../lib/authContext.js';
import { displayName } from '../../lib/userDisplay.js';
import { useTheme } from '../../lib/theme.js';
import { clsx } from '../../lib/clsx.js';
import styles from './MobileMenu.module.css';

type MenuRoute = { screen: MainTabId } | OverlayRoute;

interface MenuItem {
  id: string;
  label: string;
  icon: IconName;
  color: string;
  route: MenuRoute;
}

const primaryItems: readonly MenuItem[] = [
  {
    id: 'home',
    label: 'Главная',
    icon: 'home',
    color: 'var(--color-accent-primary-end)',
    route: { screen: 'home' },
  },
  {
    id: 'training',
    label: 'Тренировка',
    icon: 'variant',
    color: 'var(--chart-1)',
    // Opens the real Training setup screen (subject → mode → quantity →
    // start) — Phase 10 made this reachable on mobile too, so this no
    // longer needs to special-case straight into a random task.
    route: { screen: 'training' },
  },
  {
    id: 'statistics',
    label: 'Статистика',
    icon: 'progress',
    color: 'var(--color-success)',
    route: { screen: 'statistics' },
  },
  {
    id: 'mistakes',
    label: 'Мои ошибки',
    icon: 'warning',
    color: 'var(--color-error)',
    route: { screen: 'mistakes' },
  },
  {
    id: 'achievements',
    label: 'Достижения',
    icon: 'achievements',
    color: 'var(--color-gold)',
    route: { screen: 'achievements' },
  },
  {
    id: 'rating',
    label: 'Рейтинг',
    icon: 'crown',
    color: 'var(--color-gold)',
    route: { screen: 'rating' },
  },
];

const libraryItems: readonly MenuItem[] = [
  {
    id: 'subjectCatalog',
    label: 'Все задания',
    icon: 'topic',
    color: 'var(--chart-1)',
    route: { screen: 'subjectCatalog' },
  },
  {
    id: 'favorites',
    label: 'Избранное',
    icon: 'bookmark',
    color: 'var(--color-accent-secondary)',
    route: { screen: 'favorites' },
  },
  {
    id: 'mockExams',
    label: 'Пробники',
    icon: 'gift',
    color: 'var(--color-error)',
    route: { screen: 'mockExams' },
  },
  {
    id: 'topics',
    label: 'Темы',
    icon: 'settings',
    color: 'var(--color-subject-physics)',
    route: { screen: 'topics' },
  },
];

const friendsItem: MenuItem = {
  id: 'friends',
  label: 'Друзья',
  icon: 'friends',
  color: 'var(--color-success)',
  route: { screen: 'friends' },
};

export interface MobileMenuProps {
  open: boolean;
  onClose: () => void;
  activeTab: MainTabId;
}

/**
 * Mobile Menu (S1 Block 6, approved design — mobile/12_menu.png): a
 * real left-edge slide-in drawer over whatever screen is currently
 * showing (built on the same `Overlay` portal/backdrop the BottomSheet
 * uses), not a full-screen swap and not a static image. Uses its own
 * logo lockup (green π tile + "Зубрилка") per the approved
 * screenshot — deliberately not the app's bison/Zybrilka wordmark used
 * everywhere else.
 */
export function MobileMenu({ open, onClose, activeTab }: MobileMenuProps) {
  const { navigateGuarded: navigate, isGuest } = useAccountGate();
  const { user, logout } = useAuth();
  const [logoutError, setLogoutError] = useState(false);
  const [theme, setTheme] = useTheme();
  const darkTheme = theme === 'dark';

  function go(route: MenuRoute) {
    // `navigate` already replaces the 'menu' overlay with the new tab
    // or overlay route, which closes the drawer on its own — calling
    // `onClose` (== `back`, which clears the overlay) here as well
    // would immediately wipe out whatever `navigate` just set for any
    // overlay destination (task/mistakes/rating/help/…).
    navigate(route);
  }

  // The whole site follows (and remembers) this switch — see lib/theme.ts.
  function toggleTheme() {
    setTheme(darkTheme ? 'light' : 'dark');
  }

  return (
    <Overlay open={open} onClose={onClose}>
      {(entered) => (
        <div
          className={clsx(styles.panel, entered && styles.panelOpen)}
          role="dialog"
          aria-modal="true"
          aria-label="Меню"
        >
          <div className={styles.header}>
            <SubjectTile glyph="pi" size={48} />
            <div className={styles.headerBody}>
              <p className={`text-h3 ${styles.headerTitle}`}>Зубрилка</p>
              <p className={`text-body-sm text-secondary ${styles.headerSubtitle}`}>
                Твой тренажёр для ЕГЭ
              </p>
            </div>
            <button
              type="button"
              className={styles.closeButton}
              aria-label="Закрыть меню"
              onClick={onClose}
            >
              <Icon name="close" size={20} />
            </button>
          </div>

          <button
            type="button"
            className={styles.profileRow}
            onClick={() => go({ screen: 'profile' })}
          >
            <Avatar
              username={displayName(user) ?? '?'}
              color="var(--color-accent-primary)"
              size={48}
              avatarUrl={user?.avatarUrl ?? undefined}
            />
            <div className={styles.profileBody}>
              <p className={`text-body ${styles.profileName}`} style={{ fontWeight: 700 }}>
                Профиль
              </p>
              <p className="text-body-sm text-secondary">
                {isGuest ? 'Гость — без аккаунта' : (displayName(user) ?? 'Имя не задано')}
              </p>
            </div>
            <Icon name="chevronRight" size={18} className={styles.navChevron} />
          </button>

          <nav className={styles.navGroup} aria-label="Основная навигация">
            {primaryItems.map((item) => {
              const isActive = item.route.screen === activeTab;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={clsx(styles.navItem, isActive && styles.navItemActive)}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => go(item.route)}
                  style={{ ['--accent' as string]: item.color }}
                >
                  <span className={styles.navIcon}>
                    <Icon name={item.icon} size={18} />
                  </span>
                  <span className={styles.navLabel}>{item.label}</span>
                  {!isActive && (
                    <Icon name="chevronRight" size={18} className={styles.navChevron} />
                  )}
                </button>
              );
            })}
          </nav>

          <hr className={styles.divider} />

          <nav className={styles.navGroup} aria-label="Библиотека">
            {libraryItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={styles.navItem}
                onClick={() => go(item.route)}
                style={{ ['--accent' as string]: item.color }}
              >
                <span className={styles.navIcon}>
                  <Icon name={item.icon} size={18} />
                </span>
                <span className={styles.navLabel}>{item.label}</span>
                <Icon name="chevronRight" size={18} className={styles.navChevron} />
              </button>
            ))}
          </nav>

          <hr className={styles.divider} />

          <nav className={styles.navGroup} aria-label="Сообщество">
            <button
              type="button"
              className={styles.navItem}
              onClick={() => go(friendsItem.route)}
              style={{ ['--accent' as string]: friendsItem.color }}
            >
              <span className={styles.navIcon}>
                <Icon name={friendsItem.icon} size={18} />
              </span>
              <span className={styles.navLabel}>{friendsItem.label}</span>
              <Icon name="chevronRight" size={18} className={styles.navChevron} />
            </button>
          </nav>

          <hr className={styles.divider} />

          <div className={styles.plainGroup}>
            <button
              type="button"
              className={styles.plainItem}
              aria-pressed={darkTheme}
              onClick={toggleTheme}
            >
              <span className={styles.plainIcon}>
                <Icon name="theme" size={20} />
              </span>
              <span className={styles.plainLabel}>Тёмная тема</span>
              <span
                className={clsx(styles.toggle, darkTheme && styles.toggleOn)}
                aria-hidden="true"
              >
                <span className={styles.toggleKnob} />
              </span>
            </button>
            <button
              type="button"
              className={styles.plainItem}
              onClick={() => go({ screen: 'settings' })}
            >
              <span className={styles.plainIcon}>
                <Icon name="settings" size={20} />
              </span>
              <span className={styles.plainLabel}>Настройки</span>
              <Icon name="chevronRight" size={18} className={styles.navChevron} />
            </button>
            <button
              type="button"
              className={styles.plainItem}
              onClick={() => go({ screen: 'help' })}
            >
              <span className={styles.plainIcon}>
                <Icon name="faq" size={20} />
              </span>
              <span className={styles.plainLabel}>Помощь</span>
              <Icon name="chevronRight" size={18} className={styles.navChevron} />
            </button>
            {isGuest ? (
              <button
                type="button"
                className={styles.plainItem}
                onClick={() => go({ screen: 'login' })}
              >
                <span className={styles.plainIcon}>
                  <Icon name="profile" size={20} />
                </span>
                <span className={styles.plainLabel}>Войти или зарегистрироваться</span>
                <Icon name="chevronRight" size={18} className={styles.navChevron} />
              </button>
            ) : (
              <button
                type="button"
                className={styles.plainItem}
                aria-label="Выйти из аккаунта"
                onClick={() => {
                  setLogoutError(false);
                  logout().catch(() => setLogoutError(true));
                }}
              >
                <span className={styles.plainIcon}>
                  <Icon name="logout" size={20} />
                </span>
                <span className={styles.plainLabel}>Выйти</span>
                <Icon name="chevronRight" size={18} className={styles.navChevron} />
              </button>
            )}
            {logoutError && (
              <p role="alert" className="text-body-sm">
                Не удалось выйти из аккаунта. Проверьте соединение и попробуйте снова.
              </p>
            )}
          </div>
        </div>
      )}
    </Overlay>
  );
}
