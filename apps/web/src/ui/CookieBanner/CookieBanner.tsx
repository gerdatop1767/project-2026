import { useId, useState } from 'react';
import { setConsent, useConsent } from '../../lib/consent.js';
import { clsx } from '../../lib/clsx.js';
import styles from './CookieBanner.module.css';

/** What is actually stored (checked against the code — docs/COOKIES.md). */
const categories = [
  {
    title: 'Необходимые',
    state: 'Всегда включены',
    text: 'Вход в аккаунт (cookie сессии, 30 дней), ваш выбор по cookie (1 год), тема оформления и служебные настройки интерфейса в хранилище браузера. Без них сайт не работает.',
  },
  {
    title: 'Аналитика',
    state: 'Только с согласия',
    text: 'Собственная статистика сайта: cookie со случайным идентификатором браузера (до 400 дней), чтобы понимать, какими разделами пользуются. Без имени и без сторонних сервисов.',
  },
  {
    title: 'Реклама',
    state: 'Не используется',
    text: 'Рекламных и сторонних cookie на сайте нет.',
  },
] as const;

/**
 * Cookie consent (docs/COOKIES.md). Shown until the visitor decides; the
 * decision is remembered (lib/consent.ts), so it is not asked on every
 * reload. Optional analytics stays off until «Принять». Not a modal: the
 * page stays usable, and the banner sits clear of the bottom navigation.
 */
export function CookieBanner() {
  const consent = useConsent();
  const [details, setDetails] = useState(false);
  const titleId = useId();
  const detailsId = useId();
  if (consent !== null) return null;

  return (
    <section className={styles.banner} aria-labelledby={titleId} data-cookie-banner>
      <h2 id={titleId} className={styles.title}>
        Мы используем cookies
      </h2>
      <p className={styles.text}>
        Необходимые cookies нужны для входа и работы сайта. С вашего согласия мы также включим
        собственную аналитику, чтобы улучшать тренажёр. Подробнее — в{' '}
        <a href="/privacy" className={styles.link}>
          Политике конфиденциальности
        </a>
        .
      </p>

      {details && (
        <ul id={detailsId} className={styles.categories}>
          {categories.map((c) => (
            <li key={c.title} className={styles.category}>
              <span className={styles.categoryHead}>
                <strong>{c.title}</strong>
                <span className={styles.categoryState}>{c.state}</span>
              </span>
              <span className={styles.categoryText}>{c.text}</span>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={clsx(styles.button, styles.primary)}
          onClick={() => setConsent({ analytics: true })}
        >
          Принять
        </button>
        <button
          type="button"
          className={clsx(styles.button, styles.secondary)}
          onClick={() => setConsent({ analytics: false })}
        >
          Отклонить необязательные
        </button>
        <button
          type="button"
          className={styles.more}
          aria-expanded={details}
          aria-controls={detailsId}
          onClick={() => setDetails((v) => !v)}
        >
          {details ? 'Скрыть подробности' : 'Подробнее'}
        </button>
      </div>
    </section>
  );
}
