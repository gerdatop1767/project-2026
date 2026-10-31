import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from '../../lib/clsx.js';
import styles from './Overlay.module.css';

export interface OverlayProps {
  open: boolean;
  onClose: () => void;
  /**
   * The dialog/sheet panel, rendered as a sibling of the backdrop.
   * Receives `entered` so the panel can drive its own enter transition
   * (slide up / scale in) in step with the backdrop fade.
   */
  children: (entered: boolean) => ReactNode;
}

/** How long a closing panel stays on screen to play its exit (the panels'
 * own exit transitions are ≤ 220 ms). */
const EXIT_MS = 220;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Shared backdrop + portal + dismiss behavior for Modal and BottomSheet
 * (Design Spec Section 3 / 12): renders above the app in a portal,
 * closes on Escape or a backdrop tap, and locks body scroll while open.
 * Each caller supplies its own panel markup/animation (center modal vs.
 * bottom sheet), so this only owns what's common to both.
 *
 * Closing plays the panel's exit instead of cutting it: the content stays
 * mounted for a moment with `entered` false. During that moment it is
 * already gone for everything but the eye — `inert` (no clicks, no focus)
 * and `aria-hidden` — so the page underneath is usable at once.
 */
export function Overlay({ open, onClose, children }: OverlayProps) {
  const [mounted, setMounted] = useState(open);
  // Opening is picked up during render (no extra frame with nothing shown).
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open || !mounted) return;
    const timer = window.setTimeout(() => setMounted(false), prefersReducedMotion() ? 0 : EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  if (!mounted) return null;
  return createPortal(
    <OverlayContent onClose={onClose} closing={!open}>
      {children}
    </OverlayContent>,
    document.body,
  );
}

/**
 * Mounted from open until its exit has played, so `entered` naturally
 * starts false on every open — no effect ever needs to reset it back to
 * false itself, which keeps state updates inside effects async
 * (rAF/timeout callbacks) instead of synchronous.
 */
function OverlayContent({
  onClose,
  closing,
  children,
}: Omit<OverlayProps, 'open'> & { closing: boolean }) {
  const [entered, setEntered] = useState(false);
  const shown = entered && !closing;

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    if (closing) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, closing]);

  return (
    <div className={styles.layer} inert={closing} aria-hidden={closing || undefined}>
      <div
        className={clsx(styles.backdrop, shown && styles.backdropOpen)}
        onClick={closing ? undefined : onClose}
        aria-hidden="true"
      />
      {children(shown)}
    </div>
  );
}

/**
 * Autofocuses the panel on open so focus moves into the dialog/sheet, and
 * on close hands it back to whatever opened it — a keyboard user keeps
 * their place. Skipped when the opener is gone (the screen changed) or
 * focus has already moved somewhere else on purpose (e.g. another dialog).
 */
export function usePanelFocus(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = ref.current;
    panel?.focus();
    return () => {
      const active = document.activeElement;
      const focusLeftInPanel = !active || active === document.body || panel?.contains(active);
      if (opener?.isConnected && focusLeftInPanel) opener.focus({ preventScroll: true });
    };
  }, [open]);
  return ref;
}
