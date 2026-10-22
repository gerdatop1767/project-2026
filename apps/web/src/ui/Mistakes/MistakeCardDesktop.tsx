import { Icon } from '../Icon/Icon.js';
import { Button } from '../Button/Button.js';
import type { Mistake } from '../../data/sampleMistakes.js';
import { getTopicColor } from '../../data/sampleMistakes.js';
import { formatDateShort } from '../../lib/formatDate.js';
import { InlineMathText } from '../MathText/MathText.js';
import styles from './MistakeCardDesktop.module.css';

export interface MistakeCardDesktopProps {
  mistake: Mistake;
  selected: boolean;
  onToggleSelect: () => void;
  onReview: () => void;
  onToggleFavorite: () => void;
  favorited: boolean;
  /** "Решить похожее" — omitted entirely (not just hidden) if the
   * caller has no real similarity lookup to back it with. */
  onSolveSimilar?: () => void;
  solvingSimilar?: boolean;
  /** «Убрать из ошибок»; without it the corner shows the plain status glyph. */
  onDismiss?: () => void;
  dismissing?: boolean;
}

/**
 * Desktop "Мои ошибки" list row (S1 Block 6, approved design —
 * desktop/08_mistakes.png): checkbox, topic-colored chip + task title
 * + condition preview + date, a wrong-answer status glyph, and the
 * "Разобрать" / "В избранное" action column.
 */
export function MistakeCardDesktop({
  mistake,
  selected,
  onToggleSelect,
  onReview,
  onToggleFavorite,
  favorited,
  onSolveSimilar,
  solvingSimilar = false,
  onDismiss,
  dismissing = false,
}: MistakeCardDesktopProps) {
  const color = getTopicColor(mistake.topic);

  return (
    <div className={styles.card} data-busy={dismissing || undefined}>
      <button
        type="button"
        className={`${styles.checkbox} ${selected ? styles.checkboxChecked : ''}`}
        aria-label={selected ? 'Убрать из выбранных' : 'Выбрать ошибку'}
        aria-pressed={selected}
        onClick={onToggleSelect}
      >
        <Icon name={selected ? 'checkboxChecked' : 'checkboxEmpty'} size={20} />
      </button>

      <div className={styles.body}>
        <span className={styles.topicChip} style={{ background: `${color}26`, color }}>
          {mistake.topic}
        </span>
        <p className={`text-h3 ${styles.title}`}>Задание {mistake.taskNumber}</p>
        <p className={`text-body-sm ${styles.condition}`}>
          <InlineMathText text={mistake.condition} />
        </p>
        <p className={styles.date}>{formatDateShort(mistake.date)}</p>
      </div>

      {onDismiss ? (
        <button
          type="button"
          className={`${styles.statusIcon} ${styles.dismissButton}`}
          aria-label={`Убрать из ошибок (задание ${mistake.taskNumber})`}
          title="Убрать из ошибок"
          disabled={dismissing}
          aria-busy={dismissing || undefined}
          onClick={onDismiss}
        >
          <Icon name={dismissing ? 'spinner' : 'close'} size={16} />
        </button>
      ) : (
        <span className={styles.statusIcon} aria-hidden="true">
          <Icon name="close" size={16} />
        </span>
      )}

      <div className={styles.actions}>
        <Button variant="primary" fullWidth onClick={onReview}>
          Разобрать <Icon name="arrowRight" size={16} />
        </Button>
        <Button variant="secondary" fullWidth onClick={onToggleFavorite}>
          <Icon name={favorited ? 'favorite' : 'bookmark'} size={16} />В избранное
        </Button>
        {onSolveSimilar && (
          <Button
            variant="secondary"
            fullWidth
            className={styles.solveSimilarButton}
            loading={solvingSimilar}
            onClick={onSolveSimilar}
          >
            Решить похожее
          </Button>
        )}
      </div>
    </div>
  );
}
