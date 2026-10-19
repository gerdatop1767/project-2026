import { useId, type ReactNode } from 'react';
import { clsx } from '../../lib/clsx.js';
import { Icon } from '../Icon/Icon.js';
import { Overlay, usePanelFocus } from '../Overlay/Overlay.js';
import styles from './Modal.module.css';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** A wider panel for a list (e.g. the subject picker) instead of a short confirmation. */
  wide?: boolean;
}

/**
 * Centered confirmation modal (Design Spec Section 12): short
 * confirmations and choices. For scratchboard/filters/achievement
 * detail — anything that wants full-width mobile real estate — prefer
 * BottomSheet instead, per the spec's "prefer bottom sheet on mobile"
 * guidance.
 */
export function Modal({ open, onClose, title, children, wide = false }: ModalProps) {
  const titleId = useId();
  const panelRef = usePanelFocus(open);

  return (
    <Overlay open={open} onClose={onClose}>
      {(entered) => (
        <div
          ref={panelRef}
          className={clsx(styles.panel, wide && styles.wide, entered && styles.panelOpen)}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          tabIndex={-1}
        >
          {title && (
            <div className={styles.header}>
              <h2 id={titleId} className="text-h3">
                {title}
              </h2>
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
