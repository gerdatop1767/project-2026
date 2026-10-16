import { useState } from 'react';
import { Overlay } from '../Overlay/Overlay.js';
import { Icon } from '../Icon/Icon.js';
import type { IconName } from '../Icon/icons.js';
import {
  useNavigation,
  type MainTabId,
  type OverlayRoute,
  type Route,
} from '../../lib/navigation.js';
import { useAuth } from '../../lib/authContext.js';
import { clsx } from '../../lib/clsx.js';
import styles from './DesktopMenu.module.css';

type MenuRoute = { screen: MainTabId } | OverlayRoute;

interface MenuItem {
  id: string;
  label: string;
  icon: IconName;
  route: MenuRoute;
}

const menuItems: readonly MenuItem[] = [
  { id: 'profile', label: 'Профиль', icon: 'profile', route: { screen: 'profile' } },
  { id: 'help', label: 'Помощь', icon: 'faq', route: { screen: 'help' } },
];

export interface DesktopMenuProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Desktop Menu overlay (approved reference: 00_MENU_DESKTOP.png) — a
 * right-side panel, not a full-screen route. Reuses the shared Overlay
 * (backdrop, Escape-to-close, backdrop-click-to-close, portal, body
 * scroll lock) and existing navigation state; every item routes
 * through the same `navigate()` used everywhere else, so it never
 * duplicates a screen that already exists elsewhere.
 *
 * "Тёмная тема" is a local-only toggle: the app has exactly one (dark)
 * theme today, so there's no real theme system to wire it to yet —
 * it's UI-ready for when one exists, not a fake implementation of one.
 * "Выйти" ends the real server session (see AuthProvider.logout) and
 * reloads to the login page; if the server can't be reached it says so
 * and stays signed in rather than pretending to sign out.
 */
export function DesktopMenu({ open, onClose }: DesktopMenuProps) {
  const { tab, overlay, navigate } = useNavigation();
  const { logout } = useAuth();
  const [logoutError, setLogoutError] = useState(false);
  const [darkTheme, setDarkTheme] = useState(true);
  // The screen Menu is layered over, captured before any item can
  // replace it — Профиль needs this to hand BackRow a real "previous
  // screen" (see Route['from'] on the 'profile' overlay).
  const currentRoute: Route = overlay ?? { screen: tab };

  function go(route: MenuRoute) {
    navigate(route.screen === 'profile' ? { screen: 'profile', from: currentRoute } : route);
    onClose();
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
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Закрыть меню"
          >
            <Icon name="close" size={18} />
          </button>

          <div className={styles.identity}>
            <img
              src="/branding/v2/logo-icon-desktop.png"
              alt=""
              className={styles.mascot}
              aria-hidden="true"
            />
            <p className={styles.brand}>Zybrilka</p>
            <p className="text-body-sm text-secondary">Твой помощник в подготовке к ЕГЭ</p>
          </div>

          <nav className={styles.list} aria-label="Меню">
            {menuItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={styles.row}
                onClick={() => go(item.route)}
              >
                <Icon name={item.icon} size={18} />
                <span className={styles.rowLabel}>{item.label}</span>
                <Icon name="chevronRight" size={16} className={styles.rowChevron} />
              </button>
            ))}
          </nav>

          <div className={styles.divider} />

          <div className={styles.row}>
            <Icon name="theme" size={18} />
            <span className={styles.rowLabel}>Тёмная тема</span>
            <button
              type="button"
              role="switch"
              aria-checked={darkTheme}
              aria-label="Тёмная тема"
              className={clsx(styles.toggle, darkTheme && styles.toggleOn)}
              onClick={() => setDarkTheme((v) => !v)}
            >
              <span className={styles.toggleThumb} />
            </button>
          </div>

          <button
            type="button"
            className={styles.row}
            onClick={() => go({ screen: 'notifications' })}
          >
            <Icon name="notifications" size={18} />
            <span className={styles.rowLabel}>Уведомления</span>
            <Icon name="chevronRight" size={16} className={styles.rowChevron} />
          </button>

          <div className={styles.divider} />

          <button
            type="button"
            className={clsx(styles.row, styles.rowDanger)}
            onClick={() => {
              setLogoutError(false);
              logout().catch(() => setLogoutError(true));
            }}
          >
            <Icon name="logout" size={18} />
            <span className={styles.rowLabel}>Выйти</span>
            <Icon name="chevronRight" size={16} className={styles.rowChevron} />
          </button>
          {logoutError && (
            <p role="alert" className="text-body-sm">
              Не удалось выйти из аккаунта. Проверьте соединение и попробуйте снова.
            </p>
          )}
        </div>
      )}
    </Overlay>
  );
}
