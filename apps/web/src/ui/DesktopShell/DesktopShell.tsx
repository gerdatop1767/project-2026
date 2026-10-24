import { useEffect, useState, type ReactNode } from 'react';
import { useNavigation } from '../../lib/navigation.js';
import { Logo } from '../Logo/Logo.js';
import { StatusChips } from '../StatusChips/StatusChips.js';
import { Icon } from '../Icon/Icon.js';
import { DesktopSidebar } from './DesktopSidebar.js';
import { DesktopMenu } from '../DesktopMenu/DesktopMenu.js';
import { clsx } from '../../lib/clsx.js';
import { ScreenEnter } from '../motion/motion.js';
import styles from './DesktopShell.module.css';

export interface DesktopShellProps {
  /** Header content: 'status' = the streak/level chips (every screen). */
  header?: 'status';
  /** Whether the persistent left sidebar renders — independent of the
   * header, since Task/Result use the status header WITHOUT a sidebar
   * (no approved desktop screenshot shows one there). */
  sidebar?: boolean;
  children: ReactNode;
}

/**
 * Desktop app shell (S1 Block 6 — approved design): the status header
 * (streak/level chips + menu) and, for most screens, a persistent left
 * sidebar — except Task/Result, which show the header but no sidebar.
 * The public marketing page is NOT part of this shell any more: it is the
 * standalone landing (screens/Landing), shown to signed-out visitors only.
 */
export function DesktopShell({ header = 'status', sidebar = true, children }: DesktopShellProps) {
  const { navigate, tab, overlay } = useNavigation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Each screen starts scrolled to its top, never wherever the
  // previous screen happened to be left scrolled.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [tab, overlay?.screen]);

  return (
    <div className={styles.shell}>
      <header className={clsx(styles.topHeader, sidebar && styles.topHeaderApp)}>
        <div className={styles.topHeaderInner}>
          <Logo icon="desktop" size={50} onClick={() => navigate({ screen: 'learningCenter' })} />
          <div className={styles.topHeaderActions}>
            {header === 'status' && <StatusChips />}
            <button
              type="button"
              className={styles.menuButton}
              aria-label="Меню"
              onClick={() => setMenuOpen(true)}
            >
              <Icon name="menu" size={20} />
            </button>
          </div>
        </div>
      </header>
      <div className={clsx(styles.body, sidebar && styles.bodyApp)}>
        {sidebar && <DesktopSidebar />}
        <main className={styles.content}>
          <ScreenEnter screenKey={overlay?.screen ?? tab}>{children}</ScreenEnter>
        </main>
      </div>
      {/* Local panel state (not the shared tab/overlay route mobile's
       * own Menu uses): it layers over whichever screen is already
       * showing instead of replacing it, matching the approved
       * reference where the page stays visible behind the panel. */}
      <DesktopMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </div>
  );
}
