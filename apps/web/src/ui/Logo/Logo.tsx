import { clsx } from '../../lib/clsx.js';
import styles from './Logo.module.css';

export type LogoIconVariant = 'desktop' | 'mobile';

export interface LogoProps {
  /** Rendered icon height in px. */
  size?: number;
  /** The approved package ships two distinct bison-icon crops — a
   * refined one for desktop headers, a simpler one for mobile — not a
   * single asset scaled between them. `null` renders the wordmark alone
   * (the public landing, where the big hero mascot is the only bison). */
  icon?: LogoIconVariant | null;
  /** Hides the "Zybrilka" wordmark, e.g. where space is tight. */
  wordmark?: boolean;
  className?: string;
  /** When given, the whole lockup (wordmark + mascot icon) renders as
   * a single clickable control instead of inert decoration — used by
   * the app headers to send the logo/mascot to Учебный центр. */
  onClick?: () => void;
}

const iconSrc: Record<LogoIconVariant, string> = {
  desktop: '/branding/v2/logo-icon-desktop.png',
  mobile: '/branding/v2/logo-icon-mobile.png',
};

/**
 * The approved Zybrilka logo lockup (S1 Block 6 final design): the
 * bison-icon crop from the approved screenshots + a real "Zybrilka"
 * wordmark rendered as text (white "Zybr", gradient "ilka") — not an
 * image, since it's typography the browser can render natively.
 */
export function Logo({
  size = 32,
  icon = 'desktop',
  wordmark = true,
  className,
  onClick,
}: LogoProps) {
  const content = (
    <>
      {icon && (
        <img
          src={iconSrc[icon]}
          alt={wordmark ? '' : 'Zybrilka'}
          height={size}
          width={size}
          className={styles.icon}
        />
      )}
      {(wordmark || !icon) && (
        <span className={styles.wordmark} style={{ fontSize: size * 0.62 }}>
          Zybr<span className={styles.wordmarkAccent}>ilka</span>
        </span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={clsx(styles.lockup, styles.lockupInteractive, className)}
        onClick={onClick}
        aria-label="Zybrilka — Учебный центр"
      >
        {content}
      </button>
    );
  }

  return <span className={clsx(styles.lockup, className)}>{content}</span>;
}
