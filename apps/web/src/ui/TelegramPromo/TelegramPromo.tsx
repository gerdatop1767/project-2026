import { useEffect, useState } from 'react';
import { hidePromo, isPromoHidden, TELEGRAM_CHANNEL_URL } from '../../lib/telegramPromo.js';
import { Icon } from '../Icon/Icon.js';
import styles from './TelegramPromo.module.css';

/** The pause before it appears: the page settles first, then it slides in. */
export const PROMO_DELAY_MS = 1800;

/**
 * Floating «Подписывайся на наш Telegram» in the bottom-right corner (the
 * owner's artwork, public/branding/telegram). Shown on a visit unless it
 * was closed or followed within the last 24 hours (lib/telegramPromo).
 * Compact on phones and lifted above the bottom navigation; the parent
 * (FloatingLayer) keeps it away from the cookie banner and task screens.
 */
export function TelegramPromo() {
  const [visible, setVisible] = useState(false);
  const [hidden, setHidden] = useState(() => isPromoHidden());

  useEffect(() => {
    if (hidden) return;
    const timer = setTimeout(() => setVisible(true), PROMO_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hidden]);

  if (hidden || !visible) return null;

  const dismiss = () => {
    hidePromo();
    setHidden(true);
  };

  return (
    <aside className={styles.promo} aria-label="Telegram-канал Зубрилки" data-telegram-promo>
      <a
        href={TELEGRAM_CHANNEL_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.link}
        aria-label="Подписаться на Telegram-канал Зубрилки (откроется в новой вкладке)"
        // Followed: no need to offer it again today.
        onClick={() => {
          hidePromo();
          // Let the navigation start before the button goes away.
          setTimeout(() => setHidden(true), 0);
        }}
      >
        <picture>
          <source media="(min-width: 1024px)" srcSet="/branding/telegram/promo-720.webp" />
          <img
            src="/branding/telegram/promo-400.webp"
            alt=""
            className={styles.image}
            width={400}
            height={209}
            decoding="async"
            draggable={false}
          />
        </picture>
      </a>
      <button type="button" className={styles.close} aria-label="Скрыть на сутки" onClick={dismiss}>
        <Icon name="close" size={14} />
      </button>
    </aside>
  );
}
