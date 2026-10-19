import { useEffect, useRef, useState } from 'react';
import { Overlay, usePanelFocus } from '../Overlay/Overlay.js';
import { Icon } from '../Icon/Icon.js';
import type { IconName } from '../Icon/icons.js';
import {
  useNavigation,
  type MainTabId,
  type OverlayRoute,
  type Route,
} from '../../lib/navigation.js';
import { useAuth } from '../../lib/authContext.js';
import { useTheme } from '../../lib/theme.js';
import { clsx } from '../../lib/clsx.js';
import styles from './DesktopMenu.module.css';

type MenuRoute = { screen: MainTabId } | OverlayRoute;

interface MenuItem {
  id: string;
  label: string;
  caption: string;
  icon: IconName;
  route: MenuRoute;
}

const menuItems: readonly MenuItem[] = [
  {
    id: 'profile',
    label: 'Профиль',
    caption: 'Личные данные, прогресс, достижения',
    icon: 'profile',
    route: { screen: 'profile' },
  },
  {
    id: 'help',
    label: 'Помощь',
    caption: 'Ответы на вопросы и поддержка',
    icon: 'faq',
    route: { screen: 'help' },
  },
];

export interface DesktopMenuProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Desktop Menu (the ☰ button, top right): a panel over the current screen,
 * not a route. A dark glass panel with a fine violet rim; the mascot and
 * the name on top; rows for Профиль and Помощь; the theme switch and
 * Уведомления; Выйти apart, in red-pink.
 *
 * Every row does what it did before: Профиль/Помощь/Уведомления navigate
 * through the same `navigate()` as the rest of the app (Уведомления is
 * still a screen being built, and says "скоро"); the theme switch really
 * switches the whole site and remembers it (lib/theme.ts); Выйти ends the
 * real server session (AuthProvider.logout) and says so if it could not.
 *
 * Closes on ×, Escape and a click on the dimmed page (shared Overlay);
 * focus moves into the panel on open and back to the ☰ button on close.
 */
export function DesktopMenu({ open, onClose }: DesktopMenuProps) {
  const { tab, overlay, navigate } = useNavigation();
  const { logout } = useAuth();
  const [theme, setTheme] = useTheme();
  const [logoutError, setLogoutError] = useState(false);
  // The screen Menu is layered over, captured before any item can
  // replace it — Профиль needs this to hand BackRow a real "previous
  // screen" (see Route['from'] on the 'profile' overlay).
  const currentRoute: Route = overlay ?? { screen: tab };

  // Give focus back to whatever opened the menu (the ☰ button).
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      opener.current = document.activeElement as HTMLElement | null;
      return;
    }
    const element = opener.current;
    opener.current = null;
    if (element?.isConnected) element.focus({ preventScroll: true });
  }, [open]);
  // Declared after the opener capture above: effects run in order, so the
  // ☰ button is remembered before focus moves into the panel.
  const panelRef = usePanelFocus(open);

  function go(route: MenuRoute) {
    navigate(route.screen === 'profile' ? { screen: 'profile', from: currentRoute } : route);
    onClose();
  }

  const dark = theme === 'dark';

  return (
    <Overlay open={open} onClose={onClose}>
      {(entered) => (
        <div
          ref={panelRef}
          className={clsx(styles.panel, entered && styles.panelOpen)}
          role="dialog"
          aria-modal="true"
          aria-label="Меню"
          tabIndex={-1}
        >
          <span className={styles.streak} aria-hidden="true" />
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Закрыть меню"
          >
            <Icon name="close" size={18} />
          </button>

          <div className={styles.identity}>
            <span className={styles.crown} aria-hidden="true">
              <Icon name="crown" size={34} />
            </span>
            <span className={styles.avatar}>
              <img src="/branding/v2/logo-icon-desktop.png" alt="" aria-hidden="true" />
            </span>
            <p className={styles.brand}>
              Zybr<span className={styles.brandAccent}>ilka</span>
            </p>
            <p className={styles.tagline}>Твой помощник в подготовке к ЕГЭ</p>
          </div>

          <nav className={styles.group} aria-label="Меню">
            {menuItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={styles.row}
                onClick={() => go(item.route)}
              >
                <span className={styles.rowIcon}>
                  <Icon name={item.icon} size={20} />
                </span>
                <span className={styles.rowText}>
                  <span className={styles.rowLabel}>{item.label}</span>
                  <span className={styles.rowCaption}>{item.caption}</span>
                </span>
                <Icon name="chevronRight" size={18} className={styles.rowChevron} />
              </button>
            ))}
          </nav>

          <div className={styles.divider} role="separator" />

          <div className={styles.group}>
            <div className={styles.row} data-static>
              <span className={styles.rowIcon}>
                <Icon name="theme" size={20} />
              </span>
              <span className={styles.rowText}>
                <span className={styles.rowLabel} id="desktop-menu-theme">
                  Тёмная тема
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={dark}
                aria-labelledby="desktop-menu-theme"
                className={clsx(styles.toggle, dark && styles.toggleOn)}
                onClick={() => setTheme(dark ? 'light' : 'dark')}
              >
                <span className={styles.toggleThumb} />
              </button>
            </div>

            <button
              type="button"
              className={styles.row}
              onClick={() => go({ screen: 'notifications' })}
            >
              <span className={styles.rowIcon}>
                <Icon name="notifications" size={20} />
              </span>
              <span className={styles.rowText}>
                <span className={styles.rowLabel}>Уведомления</span>
                <span className={styles.rowCaption}>Напоминания и новости — скоро</span>
              </span>
              <Icon name="chevronRight" size={18} className={styles.rowChevron} />
            </button>
          </div>

          <div className={styles.divider} role="separator" />

          <button
            type="button"
            className={clsx(styles.row, styles.rowDanger)}
            onClick={() => {
              setLogoutError(false);
              logout().catch(() => setLogoutError(true));
            }}
          >
            <span className={styles.rowIcon}>
              <Icon name="logout" size={20} />
            </span>
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>Выйти</span>
            </span>
            <Icon name="chevronRight" size={18} className={styles.rowChevron} />
          </button>
          {logoutError && (
            <p role="alert" className={styles.error}>
              Не удалось выйти из аккаунта. Проверьте соединение и попробуйте снова.
            </p>
          )}
        </div>
      )}
    </Overlay>
  );
}
