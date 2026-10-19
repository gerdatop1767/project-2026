import { Icon } from '../../ui/Icon/Icon.js';
import type { IconName } from '../../ui/Icon/icons.js';
import { TELEGRAM_SUPPORT_URL } from '../../lib/telegram.js';
import { clsx } from '../../lib/clsx.js';
import styles from './HelpDesktop.module.css';

interface HelpCategory {
  id: string;
  icon: IconName;
  color: string;
  title: string;
  description: string;
}

const categories: readonly HelpCategory[] = [
  {
    id: 'suggestions',
    icon: 'hint',
    color: 'var(--color-warning)',
    title: 'Предложения',
    description: 'Идеи по улучшению сайта',
  },
  {
    id: 'technical',
    icon: 'settings',
    color: 'var(--chart-1)',
    title: 'Технические проблемы',
    description: 'Сайт не работает или что-то не загружается',
  },
  {
    id: 'login',
    icon: 'profile',
    color: 'var(--chart-6)',
    title: 'Проблемы с входом',
    description: 'Не удаётся войти или восстановить доступ',
  },
  {
    id: 'other',
    icon: 'chat',
    color: 'var(--chart-2)',
    title: 'Другие запросы',
    description: 'Любые другие вопросы и обращения',
  },
];

/**
 * Desktop "Помощь" (approved reference:
 * 10_help_screen_APPROVED_SECOND_GENERATION.png — second generation).
 * A single support channel: Telegram. No in-app ticket/chat system
 * exists, so the 4 category cards are informational entry points into
 * the same Telegram bot, not separate flows — clicking one still opens
 * "Открыть бот" via `TELEGRAM_SUPPORT_URL`, which is empty (and the
 * CTA disabled) until a real support bot is connected.
 */
export function HelpDesktop() {
  const hasBotUrl = TELEGRAM_SUPPORT_URL.length > 0;

  return (
    <div>
      <div className={styles.hero}>
        <div className={styles.heroText}>
          <span className={styles.badge}>Помощь</span>
          <h1 className={`text-h1 ${styles.heading}`}>
            Нужна <span className={styles.headingAccent}>помощь?</span>
          </h1>
          <p className="text-body text-secondary">
            Напишите нам в Telegram — мы обязательно поможем и ответим как можно скорее!
          </p>
          {hasBotUrl ? (
            <a
              href={TELEGRAM_SUPPORT_URL}
              target="_blank"
              rel="noreferrer"
              className={styles.ctaButton}
            >
              <Icon name="chat" size={18} /> Открыть бот
            </a>
          ) : (
            <span className={clsx(styles.ctaButton, styles.ctaDisabled)} aria-disabled="true">
              <Icon name="chat" size={18} /> Бот скоро будет подключён
            </span>
          )}
        </div>
        <img
          src="/branding/v2/hero-mascot-desktop.webp"
          alt=""
          aria-hidden="true"
          className={styles.mascot}
        />
      </div>

      <div className={styles.grid}>
        {categories.map((category) =>
          hasBotUrl ? (
            <a
              key={category.id}
              href={TELEGRAM_SUPPORT_URL}
              target="_blank"
              rel="noreferrer"
              className={styles.categoryCard}
              style={{ ['--accent' as string]: category.color }}
            >
              <span className={styles.categoryIcon}>
                <Icon name={category.icon} size={20} />
              </span>
              <span className={styles.categoryBody}>
                <p className="text-body" style={{ fontWeight: 700 }}>
                  {category.title}
                </p>
                <p className="text-body-sm text-secondary">{category.description}</p>
              </span>
              <Icon name="chevronRight" size={18} className={styles.categoryChevron} />
            </a>
          ) : (
            <div
              key={category.id}
              className={styles.categoryCard}
              style={{ ['--accent' as string]: category.color }}
            >
              <span className={styles.categoryIcon}>
                <Icon name={category.icon} size={20} />
              </span>
              <span className={styles.categoryBody}>
                <p className="text-body" style={{ fontWeight: 700 }}>
                  {category.title}
                </p>
                <p className="text-body-sm text-secondary">{category.description}</p>
              </span>
              <Icon name="chevronRight" size={18} className={styles.categoryChevron} />
            </div>
          ),
        )}
      </div>
    </div>
  );
}
