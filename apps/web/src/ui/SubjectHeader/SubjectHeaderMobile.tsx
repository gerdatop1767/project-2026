import type { ReactNode } from 'react';
import { Icon } from '../Icon/Icon.js';
import { SubjectTile } from '../SubjectTile/SubjectTile.js';
import type { Subject } from '../../data/subjects.js';
import styles from './SubjectHeaderMobile.module.css';

export interface SubjectHeaderMobileProps {
  subject: Subject;
  title: string;
  onBack?: () => void;
  trailing?: ReactNode;
  /** When given, the subject name + chevron becomes a real picker
   * trigger (Statistics' subject filter) — other callers (Мои ошибки)
   * that don't pass it keep today's purely decorative row. */
  onSelectSubject?: () => void;
}

/**
 * Shared mobile header for subject-scoped screens outside the
 * Training flow — Statistics ("Математика ▾ / Статистика") and Мои
 * ошибки ("Математика ▾ / Мои ошибки"), per the approved screenshots.
 * Statistics is a persistent tab with nowhere to go "back" to, so
 * `onBack` is optional; Mistakes (an overlay reached from Home/Menu)
 * passes it.
 */
export function SubjectHeaderMobile({
  subject,
  title,
  onBack,
  trailing,
  onSelectSubject,
}: SubjectHeaderMobileProps) {
  const subjectRow = (
    <span className={styles.subjectRow}>
      <p className="text-body" style={{ fontWeight: 700 }}>
        {subject.shortName}
      </p>
      <Icon name="chevronDown" size={16} />
    </span>
  );

  return (
    <div className={styles.header}>
      {onBack && (
        <button
          type="button"
          className={`${styles.iconButton} ${styles.leadingButton}`}
          aria-label="Назад"
          onClick={onBack}
        >
          <Icon name="back" size={20} />
        </button>
      )}
      <SubjectTile glyph={subject.glyph} size={40} />
      <div className={styles.headerText}>
        {onSelectSubject ? (
          <button
            type="button"
            className={styles.subjectRowButton}
            onClick={onSelectSubject}
            aria-haspopup="listbox"
          >
            {subjectRow}
          </button>
        ) : (
          subjectRow
        )}
        <p className="text-body-sm text-secondary">{title}</p>
      </div>
      {trailing}
    </div>
  );
}
