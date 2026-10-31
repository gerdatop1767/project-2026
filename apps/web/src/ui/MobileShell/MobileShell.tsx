import { useEffect, useRef, type ReactNode } from 'react';
import { clsx } from '../../lib/clsx.js';
import { Logo } from '../Logo/Logo.js';
import { StatusChips } from '../StatusChips/StatusChips.js';
import { useNavigation } from '../../lib/navigation.js';
import { ScreenEnter } from '../motion/motion.js';
import styles from './MobileShell.module.css';

export interface MobileShellProps {
  children: ReactNode;
  /** Omit on task/result/onboarding screens, which hide navigation entirely. */
  nav?: ReactNode;
}

/**
 * Mobile app shell (S1 Block 6 — approved design): a phone-proportioned
 * column with the bison-icon logo + streak/level chips as a persistent
 * header, and the bottom tab bar. Only ever mounted when `useIsDesktop`
 * is false — desktop gets its own separate `DesktopShell`, not a
 * responsive collapse of this one.
 *
 * The scrollable content always reserves enough bottom padding to
 * clear both the fixed BottomNav (when present) and the iOS
 * safe-area-inset-bottom, so the last card/button on any screen is
 * never covered by the nav.
 */
export function MobileShell({ children, nav }: MobileShellProps) {
  const { tab, overlay } = useNavigation();
  const contentRef = useRef<HTMLElement>(null);

  // Each screen starts scrolled to its top, never wherever the
  // previous screen happened to be left scrolled.
  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [tab, overlay?.screen]);

  return (
    <div className={styles.shell}>
      {nav && (
        <header className={styles.header}>
          <Logo icon="mobile" size={38} />
          <StatusChips />
        </header>
      )}
      <main
        ref={contentRef}
        className={clsx(
          styles.content,
          !nav && styles.contentNoHeader,
          Boolean(nav) && styles.contentWithNav,
        )}
      >
        <ScreenEnter screenKey={overlay ? overlay.screen : tab}>{children}</ScreenEnter>
      </main>
      {nav && <div className={styles.nav}>{nav}</div>}
    </div>
  );
}
