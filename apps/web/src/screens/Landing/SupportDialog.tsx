import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { SUPPORT_BOT_HANDLE, SUPPORT_BOT_URL } from '../../lib/telegram.js';
import { Icon } from '../../ui/Icon/Icon.js';
import styles from './SupportDialog.module.css';

/** Keep in step with the `--exit` duration in SupportDialog.module.css. */
const EXIT_MS = 160;

interface SupportDialogContextValue {
  /** Opens the support window over the current page. Pass the element that
   * triggered it (`event.currentTarget`) so focus can return to it on close —
   * Safari/iOS do not focus a button on click, so `document.activeElement`
   * cannot be relied on to find it. */
  open: (trigger?: HTMLElement | null) => void;
}

const SupportDialogContext = createContext<SupportDialogContextValue | null>(null);

export function useSupportDialog(): SupportDialogContextValue {
  const ctx = useContext(SupportDialogContext);
  if (!ctx) throw new Error('useSupportDialog must be used within a SupportDialogProvider');
  return ctx;
}

type Phase = 'closed' | 'open' | 'closing';

/**
 * The public pages' support window (landing, FAQ, legal pages): a modal that
 * opens OVER the page the visitor is on — nothing navigates, so the page,
 * its scroll position and any open FAQ answers stay exactly as they were —
 * instead of sending a signed-out visitor into the app's internal Help screen.
 *
 * Behaviour: closes on ×, Escape and a tap on the dimmed backdrop; Tab stays
 * inside the window; the page behind is inert and does not scroll; focus
 * moves into the window on open and back to the trigger on close.
 */
export function SupportDialogProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('closed');
  const trigger = useRef<HTMLElement | null>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  const open = useCallback((element?: HTMLElement | null) => {
    trigger.current = element ?? null;
    setPhase('open');
  }, []);

  const requestClose = useCallback(() => {
    setPhase((current) => (current === 'open' ? 'closing' : current));
  }, []);

  const finishClose = useCallback(() => {
    returnFocusTo.current = trigger.current;
    trigger.current = null;
    setPhase('closed');
  }, []);

  // Focus goes back to the trigger only once the window is GONE. Doing it in
  // `finishClose` itself is too early: the page is still `inert` until the
  // window's cleanup has run, and an inert element silently refuses focus
  // (jsdom has no `inert`, so only a real browser shows this).
  useEffect(() => {
    if (phase !== 'closed') return;
    const element = returnFocusTo.current;
    returnFocusTo.current = null;
    if (element && element.isConnected) element.focus({ preventScroll: true });
  }, [phase]);

  const value = useMemo(() => ({ open }), [open]);

  return (
    <SupportDialogContext.Provider value={value}>
      {children}
      {phase !== 'closed' &&
        createPortal(
          <SupportDialogView
            closing={phase === 'closing'}
            onRequestClose={requestClose}
            onClosed={finishClose}
          />,
          document.body,
        )}
    </SupportDialogContext.Provider>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled])';

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

interface ViewProps {
  closing: boolean;
  onRequestClose: () => void;
  onClosed: () => void;
}

function SupportDialogView({ closing, onRequestClose, onClosed }: ViewProps) {
  const titleId = useId();
  const textId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);
  const shown = entered && !closing;

  // Enter on the next frame so the transition runs from the hidden state.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Leave: the fade-out is driven by `shown` going false; once it has played,
  // report back so the window unmounts and focus returns to the trigger.
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(onClosed, prefersReducedMotion() ? 0 : EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [closing, onClosed]);

  // While open: move focus in, make the page behind inert, stop it scrolling
  // (without the content jumping sideways when the scrollbar disappears).
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });

    const root = document.getElementById('root');
    root?.setAttribute('inert', '');

    const { body } = document;
    const previous = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

    return () => {
      root?.removeAttribute('inert');
      body.style.overflow = previous.overflow;
      body.style.paddingRight = previous.paddingRight;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') onRequestClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onRequestClose]);

  // Tab / Shift+Tab wrap inside the window.
  function trapTab(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab' || !panel.current) return;
    const nodes = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (nodes.length === 0) return;
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className={styles.root}>
      <div
        className={styles.backdrop}
        data-shown={shown || undefined}
        onClick={onRequestClose}
        aria-hidden="true"
      />
      <div
        ref={panel}
        className={styles.panel}
        data-shown={shown || undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        tabIndex={-1}
        onKeyDown={trapTab}
      >
        <button
          type="button"
          className={styles.close}
          onClick={onRequestClose}
          aria-label="Закрыть"
        >
          <Icon name="close" size={20} />
        </button>

        <div className={styles.copy}>
          <p className={styles.badge}>Поддержка</p>
          <h2 id={titleId} className={styles.title}>
            Нужна <span className={styles.accent}>помощь?</span>
          </h2>
          <p id={textId} className={styles.text}>
            Что-то не работает, нашли ошибку в задании или есть идея? Напишите нашему боту в
            Telegram.
          </p>
          <a
            className={styles.action}
            href={SUPPORT_BOT_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="chat" size={20} />
            Открыть Telegram-бота
            <span className={styles.srOnly}> (откроется в новой вкладке)</span>
          </a>
          <p className={styles.handle}>{SUPPORT_BOT_HANDLE}</p>
        </div>

        <div className={styles.art} aria-hidden="true">
          <span className={styles.glow} />
          <img
            src="/branding/v2/support-bison.webp"
            alt=""
            width={560}
            height={672}
            className={styles.mascot}
            decoding="async"
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}
