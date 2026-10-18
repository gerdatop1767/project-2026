import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useAuth } from '../../lib/authContext.js';
import { useNavigation, type OverlayRoute } from '../../lib/navigation.js';
import { pathForRoute } from '../../lib/routes.js';
import { Logo } from '../../ui/Logo/Logo.js';
import { useSupportDialog } from './SupportDialog.js';
import styles from './SiteChrome.module.css';

/** A real `<a href>` (crawlers, middle-click, "copy link") that still
 * navigates in-app on a plain click. */
export function useRouteLink() {
  const { navigate } = useNavigation();
  return (route: OverlayRoute | { screen: 'home' }) => ({
    href: pathForRoute(route) ?? '/',
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
        return;
      }
      event.preventDefault();
      navigate(route);
    },
  });
}

/** In-page anchor that scrolls instead of touching the router (the
 * landing's sections are not routes). Smooth unless reduced motion. */
export function scrollToSection(event: MouseEvent<HTMLAnchorElement>, id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  event.preventDefault();
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

/** True once the page has scrolled off its very top: the header only
 * gains a fill and hairline then, so the first screen reads as one surface. */
function useScrolled() {
  const sentinel = useRef<HTMLSpanElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const element = sentinel.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry?.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { sentinel, scrolled };
}

export interface SiteHeaderProps {
  /** Landing only: the in-page section links (Предметы, Возможности, FAQ). */
  sectionLinks?: boolean;
}

/**
 * Compact public header shared by the landing and the info pages:
 * wordmark left; quiet text navigation and one filled CTA right.
 */
export function SiteHeader({ sectionLinks = false }: SiteHeaderProps) {
  const { navigate } = useNavigation();
  const { user } = useAuth();
  const link = useRouteLink();
  const { sentinel, scrolled } = useScrolled();
  const signedIn = Boolean(user);

  // iOS Safari (and Telegram's iOS WebView) applies `:active` on touch only
  // when some touch listener exists — without it no button below would
  // show its pressed state on an iPhone.
  useEffect(() => {
    const noop = () => {};
    document.addEventListener('touchstart', noop, { passive: true });
    return () => document.removeEventListener('touchstart', noop);
  }, []);

  return (
    <>
      <span ref={sentinel} className={styles.sentinel} aria-hidden="true" />
      <header className={styles.header} data-scrolled={scrolled || undefined}>
        <div className={styles.headerInner}>
          <a
            {...link({ screen: 'home' })}
            className={styles.brand}
            aria-label="Zybrilka — на главную"
          >
            <Logo size={34} icon={null} />
          </a>

          <nav className={styles.nav} aria-label="Разделы">
            {sectionLinks && (
              <>
                <a href="#subjects" onClick={(event) => scrollToSection(event, 'subjects')}>
                  Предметы
                </a>
                <a href="#features" onClick={(event) => scrollToSection(event, 'features')}>
                  Возможности
                </a>
              </>
            )}
            {sectionLinks ? (
              <a href="#faq" onClick={(event) => scrollToSection(event, 'faq')}>
                FAQ
              </a>
            ) : (
              <a {...link({ screen: 'faq' })}>FAQ</a>
            )}
          </nav>

          <div className={styles.actions}>
            {signedIn ? (
              <button
                type="button"
                className={styles.cta}
                onClick={() => navigate({ screen: 'home' })}
              >
                Открыть тренажёр
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.signIn}
                  onClick={() => navigate({ screen: 'login' })}
                >
                  Войти
                </button>
                <button
                  type="button"
                  className={styles.cta}
                  onClick={() => navigate({ screen: 'login' })}
                >
                  <span className={styles.ctaLong}>Начать бесплатно</span>
                  <span className={styles.ctaShort} aria-hidden="true">
                    Начать
                  </span>
                </button>
              </>
            )}
          </div>
        </div>
      </header>
    </>
  );
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.footerColumn}>
      <p className={styles.footerTitle}>{title}</p>
      <ul className={styles.footerList}>{children}</ul>
    </div>
  );
}

/** Public footer: project info, support (opens a window) and the legal documents. */
export function SiteFooter() {
  const link = useRouteLink();
  const support = useSupportDialog();

  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerBrand}>
          <Logo size={28} icon={null} />
          <p className={styles.footerTagline}>Бесплатный онлайн-тренажёр ЕГЭ</p>
        </div>

        <div className={styles.footerColumns}>
          <FooterColumn title="Проект">
            <li>
              <a {...link({ screen: 'faq' })}>Вопросы и ответы</a>
            </li>
            <li>
              {/* A button, not a link to /help: for a signed-out visitor that
                  screen is the app's internal shell. The window opens over
                  the page instead. */}
              <button
                type="button"
                className={styles.footerButton}
                onClick={(event) => support.open(event.currentTarget)}
              >
                Поддержка
              </button>
            </li>
          </FooterColumn>
          <FooterColumn title="Документы">
            <li>
              <a {...link({ screen: 'privacy' })}>Политика конфиденциальности</a>
            </li>
            <li>
              <a {...link({ screen: 'terms' })}>Пользовательское соглашение</a>
            </li>
          </FooterColumn>
        </div>

        <p className={styles.copyright}>© {new Date().getFullYear()} Zybrilka</p>
      </div>
    </footer>
  );
}
