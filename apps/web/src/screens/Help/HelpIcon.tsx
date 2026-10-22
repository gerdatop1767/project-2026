import { Icon } from '../../ui/Icon/Icon.js';
import type { HelpCategory } from './helpCategories.js';
import styles from './HelpIcon.module.css';

/** A category glyph with its own small motion (see HelpIcon.module.css). */
export function HelpIcon({ category, index }: { category: HelpCategory; index: number }) {
  return (
    <span
      className={styles.icon}
      data-kind={category.id}
      style={{ ['--i' as string]: index }}
      aria-hidden="true"
    >
      <Icon name={category.icon} size={20} />
    </span>
  );
}
