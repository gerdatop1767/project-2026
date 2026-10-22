import { useState } from 'react';
import { Icon } from '../../ui/Icon/Icon.js';
import type { IconName } from '../../ui/Icon/icons.js';
import { Logo } from '../../ui/Logo/Logo.js';
import styles from './TelegramReturn.module.css';

/**
 * The external browser's last page in a VK ID sign-in started from the
 * Telegram Mini App (apps/api auth routes → `/telegram-return?status=…`).
 * The account is NOT handed over here: the Mini App collects its own
 * session once the visitor is back in Telegram. A browser can't switch
 * apps by itself, so this says plainly how to get back.
 *
 * `status` only picks one of four fixed texts — nothing from the URL is
 * ever rendered.
 */
type Status = 'ok' | 'cancelled' | 'error' | 'expired';

const content: Record<Status, { icon: IconName; tone: 'ok' | 'bad'; title: string; text: string }> =
  {
    ok: {
      icon: 'success',
      tone: 'ok',
      title: 'Готово, вы вошли через VK ID',
      text: 'Вернитесь в Telegram — Зубрилка подхватит вход сама, через пару секунд.',
    },
    cancelled: {
      icon: 'errorCircle',
      tone: 'bad',
      title: 'Вход отменён',
      text: 'Вернитесь в Telegram и, если нужно, нажмите «Продолжить через VK ID» ещё раз.',
    },
    error: {
      icon: 'errorCircle',
      tone: 'bad',
      title: 'Не удалось войти через VK ID',
      text: 'Вернитесь в Telegram и попробуйте ещё раз — или войдите по почте.',
    },
    expired: {
      icon: 'errorCircle',
      tone: 'bad',
      title: 'Ссылка для входа устарела',
      text: 'Вернитесь в Telegram и нажмите «Продолжить через VK ID» ещё раз — появится новая.',
    },
  };

function readStatus(): Status {
  const raw = new URLSearchParams(window.location.search).get('status');
  return raw === 'ok' || raw === 'cancelled' || raw === 'error' ? raw : 'expired';
}

/** Optional deep link back into the Mini App (e.g. https://t.me/<bot>/<app>),
 * set at build time; without it the page explains how to switch back. */
const MINI_APP_URL: string = import.meta.env.VITE_TELEGRAM_MINI_APP_URL ?? '';

export function TelegramReturn() {
  const [status] = useState(readStatus);
  const view = content[status];

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <Logo icon="desktop" size={36} />
        <span className={styles.icon} data-tone={view.tone}>
          <Icon name={view.icon} size={36} />
        </span>
        <h1 className={styles.title}>{view.title}</h1>
        <p className={styles.text}>{view.text}</p>
        {MINI_APP_URL ? (
          <a className={styles.action} href={MINI_APP_URL}>
            <Icon name="chat" size={18} /> Вернуться в Telegram
          </a>
        ) : null}
        <ol className={styles.steps}>
          <li>Откройте приложение Telegram — окно Зубрилки там осталось открытым.</li>
          <li>Если оно закрылось, откройте бота Зубрилки и нажмите кнопку приложения.</li>
          <li>Эту вкладку браузера можно закрыть.</li>
        </ol>
      </div>
    </main>
  );
}
