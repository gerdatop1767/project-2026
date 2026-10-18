import type { FaqItem } from '../../data/siteInfo.js';
import { Icon } from '../../ui/Icon/Icon.js';
import styles from './FaqList.module.css';

/**
 * FAQ accordion on native `<details>`/`<summary>`: keyboard, screen readers
 * and find-in-page work with no script, and several answers can stay open.
 * Only the chevron turns and the answer fades in — opening is occasional,
 * so a short, quiet transition is enough.
 */
export function FaqList({ items }: { items: readonly FaqItem[] }) {
  return (
    <div className={styles.list}>
      {items.map((item) => (
        <details key={item.question} className={styles.item}>
          <summary className={styles.question}>
            <span>{item.question}</span>
            <Icon name="chevronDown" size={20} className={styles.chevron} />
          </summary>
          <p className={styles.answer}>{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
