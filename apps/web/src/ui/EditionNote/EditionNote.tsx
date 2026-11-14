import { YASHCHENKO_2027_PROJECT_COLLECTION } from '@zybrilka/shared';
import { Icon } from '../Icon/Icon.js';
import styles from './EditionNote.module.css';

/**
 * Under a «Сборник» choice: says plainly when the chosen book is an old
 * edition whose numbering differs from the current exam. Nothing for other
 * collections. docs/theory/EXAM-NUMBERING.md.
 */
export function EditionNote({ collectionSlug }: { collectionSlug: string | null | undefined }) {
  if (collectionSlug !== YASHCHENKO_2027_PROJECT_COLLECTION) return null;
  return (
    <p className={styles.note} role="note">
      <Icon name="reference" size={16} className={styles.icon} />
      <span>
        <strong>Старая редакция.</strong> Сборник составлен по проекту КИМ ЕГЭ-2027 (август 2026): в
        нём 20 заданий. В актуальной редакции ЕГЭ-2027 (ФИПИ, 13.11.2026) 19 заданий и нумерация как
        в 2026 году.
      </span>
    </p>
  );
}
