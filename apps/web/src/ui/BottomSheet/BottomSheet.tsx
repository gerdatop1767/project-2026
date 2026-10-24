import { useId, type ReactNode } from 'react';
import { clsx } from '../../lib/clsx.js';
import { Icon } from '../Icon/Icon.js';
import type { IconName } from '../Icon/icons.js';
import { Overlay, usePanelFocus } from '../Overlay/Overlay.js';
import styles from './BottomSheet.module.css';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** A short line under the title (also the dialog's description). */
  subtitle?: string;
  /** An icon tile before the title. */
  icon?: IconName;
  /** Extra class for the panel, for a dialog with its own surface. */
  className?: string;
  children: ReactNode;
}

/**
 * Bottom sheet (Design Spec Section 12): the preferred mobile pattern
 * for anything that wants full-width real estate or a scrollable list —
 * the scratchboard, filters, Select's option list, achievement detail.
 * Slides up from the bottom, safe-area aware, swipe-to-dismiss is left
 * to a later block (Escape/backdrop/close-button dismissal covers this
 * one).
 */
export function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  icon,
  className,
  children,
}: BottomSheetProps) {
  const titleId = useId();
  const subtitleId = useId();
  const panelRef = usePanelFocus(open);

  return (
    <Overlay open={open} onClose={onClose}>
      {(entered) => (
        <div
          ref={panelRef}
          className={clsx(styles.panel, entered && styles.panelOpen, className)}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-describedby={title && subtitle ? subtitleId : undefined}
          tabIndex={-1}
        >
          <div className={styles.handle} aria-hidden="true" />
          {title && (
            <div className={styles.header}>
              {icon && (
                <span className={styles.headerIcon} aria-hidden="true">
                  <Icon name={icon} size={22} />
                </span>
              )}
              <div className={styles.headerText}>
                <h2 id={titleId} className="text-h3">
                  {title}
                </h2>
                {subtitle && (
                  <p id={subtitleId} className={styles.subtitle}>
                    {subtitle}
                  </p>
                )}
              </div>
              <button
                type="button"
                className={styles.closeButton}
                onClick={onClose}
                aria-label="Закрыть"
              >
                <Icon name="close" size={20} />
              </button>
            </div>
          )}
          {children}
        </div>
      )}
    </Overlay>
  );
}
