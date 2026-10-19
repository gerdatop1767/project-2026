import { useNavigation } from '../../lib/navigation.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { SUPPORT_BOT_URL } from '../../lib/telegram.js';
import { helpCategories } from './helpCategories.js';
import { HelpIcon } from './HelpIcon.js';
import { SlideUp } from '../../ui/motion/motion.js';
import styles from './HelpMobile.module.css';

/**
 * Mobile "Помощь" (approved reference:
 * 10_help_screen_APPROVED_SECOND_GENERATION.png — second generation),
 * adapted to a single column for phone widths. Same single Telegram
 * support channel as the desktop screen — see HelpDesktop for why the
 * 4 categories all point at the same bot link.
 */
export function HelpMobile() {
  const { back } = useNavigation();

  return (
    <SlideUp className={styles.stack}>
      <div className={styles.header}>
        <button type="button" className={styles.backButton} aria-label="Назад" onClick={back}>
          <Icon name="back" size={20} />
        </button>
        <p className="text-body" style={{ fontWeight: 700 }}>
          Помощь
        </p>
      </div>

      <div className={styles.hero}>
        <span className={styles.badge}>Помощь</span>
        <h1 className={`text-h1 ${styles.heading}`}>
          Нужна <span className={styles.headingAccent}>помощь?</span>
        </h1>
        <p className="text-body-sm text-secondary">
          Напишите нам в Telegram — мы обязательно поможем и ответим как можно скорее!
        </p>
        <img
          src="/branding/v2/hero-mascot-desktop.webp"
          alt=""
          aria-hidden="true"
          className={styles.mascot}
        />
        <a
          href={SUPPORT_BOT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.ctaButton}
        >
          <Icon name="chat" size={18} /> Открыть Telegram-бота
          <span className={styles.srOnly}> (откроется в новой вкладке)</span>
        </a>
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
              <span className="text-body-sm" style={{ fontWeight: 700 }}>
                {category.title}
              </span>
              <span className="text-body-sm text-secondary">{category.description}</span>
            </span>
            <Icon name="chevronRight" size={18} className={styles.categoryChevron} />
          </a>
        ))}
      </div>
    </SlideUp>
  );
}
