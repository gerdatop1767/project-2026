import { Icon } from '../../ui/Icon/Icon.js';
import { SUPPORT_BOT_HANDLE, SUPPORT_BOT_URL } from '../../lib/telegram.js';
import { helpCategories } from './helpCategories.js';
import { HelpIcon } from './HelpIcon.js';
import styles from './HelpDesktop.module.css';

/**
 * Desktop "Помощь" (approved reference:
 * 10_help_screen_APPROVED_SECOND_GENERATION.png — second generation).
 * A single support channel: the same Telegram bot the public
 * landing's support window links to (`SUPPORT_BOT_URL`). No in-app
 * ticket/chat system exists, so the 4 category cards are entry points
 * into that same bot, not separate flows. The mascot is the landing's
 * support bison, so both help surfaces look like one thing.
 */
export function HelpDesktop() {
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
          <a
            href={SUPPORT_BOT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.ctaButton}
          >
            <Icon name="chat" size={18} /> Открыть Telegram-бота
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
            decoding="async"
            draggable={false}
            className={styles.mascot}
          />
        </div>
      </div>

      <div className={styles.grid}>
        {helpCategories.map((category, index) => (
          <a
            key={category.id}
            href={SUPPORT_BOT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.categoryCard}
            data-help-card
            style={{ ['--accent' as string]: category.color }}
          >
            <span className={styles.categoryIcon}>
              <HelpIcon category={category} index={index} />
            </span>
            <span className={styles.categoryBody}>
              <span className={`text-body ${styles.categoryTitle}`}>{category.title}</span>
              <span className="text-body-sm text-secondary">{category.description}</span>
            </span>
            <Icon name="chevronRight" size={18} className={styles.categoryChevron} />
          </a>
        ))}
      </div>
    </div>
  );
}
