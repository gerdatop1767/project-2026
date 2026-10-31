import { Icon } from '../Icon/Icon.js';
import { Button } from '../Button/Button.js';
import { DifficultyTag } from '../Training/DifficultyTag.js';
import type { Mistake } from '../../data/sampleMistakes.js';
import { getTopicColor } from '../../data/sampleMistakes.js';
import { formatDateLong } from '../../lib/formatDate.js';
import { InlineMathText } from '../MathText/MathText.js';
import styles from './MistakeCardMobile.module.css';

export interface MistakeCardMobileProps {
  mistake: Mistake;
  selected: boolean;
  onToggleSelect: () => void;
  onRetry: () => void;
  onOpen: () => void;
  /** "Решить похожее" — omitted entirely (not just hidden) while the
   * deterministic similarity lookup is unavailable for some reason, so
   * the card never shows a button with nothing real behind it. */
  onSolveSimilar?: () => void;
  solvingSimilar?: boolean;
  /** «Убрать из ошибок» — omitted when the screen can't offer it. */
  onDismiss?: () => void;
  /** The dismiss request is in flight: the × is disabled (no double tap). */
  dismissing?: boolean;
}

/**
 * Mobile "Повторить ошибки" list row (S1 Block 6, approved design —
 * mobile/08_mistakes.png): task-number + topic + difficulty chips and
 * a date on one line, the full condition below, a retry icon and a
 * chevron into the task. Tapping the condition or the chevron opens
 * the task; the checkbox and retry button are independent controls.
 */
export function MistakeCardMobile({
  mistake,
  selected,
  onToggleSelect,
  onRetry,
  onOpen,
  onSolveSimilar,
  solvingSimilar = false,
  onDismiss,
  dismissing = false,
}: MistakeCardMobileProps) {
  const color = getTopicColor(mistake.topic);

  return (
    <div className={styles.card} data-busy={dismissing || undefined}>
      <div className={styles.topRow}>
        <button
          type="button"
          className={`${styles.checkbox} ${selected ? styles.checkboxChecked : ''}`}
          aria-label={selected ? 'Убрать из выбранных' : 'Выбрать ошибку'}
          aria-pressed={selected}
          onClick={onToggleSelect}
        >
          <Icon name={selected ? 'checkboxChecked' : 'checkboxEmpty'} size={20} />
        </button>
        <span className={styles.meta}>
          <span className={styles.metaRow}>
            <span className={styles.numberChip}>№{mistake.taskNumber}</span>
            <span className={styles.topicChip} style={{ background: `${color}26`, color }}>
              {mistake.topic}
            </span>
            <DifficultyTag label={mistake.difficultyLabel} />
          </span>
          <span className={styles.date}>{formatDateLong(mistake.date)}</span>
        </span>
        {onDismiss && (
          <button
            type="button"
            className={styles.dismissButton}
            aria-label={`Убрать из ошибок (задание ${mistake.taskNumber})`}
            disabled={dismissing}
            aria-busy={dismissing || undefined}
            onClick={onDismiss}
          >
            <Icon name={dismissing ? 'spinner' : 'close'} size={18} />
          </button>
        )}
      </div>

      <button type="button" className={styles.condition} onClick={onOpen}>
        <InlineMathText text={mistake.condition} />
      </button>

      <div className={styles.bottomRow}>
        {onSolveSimilar && (
          <Button
            variant="secondary"
            className={styles.solveSimilarButton}
            loading={solvingSimilar}
            onClick={onSolveSimilar}
          >
            Решить похожее
          </Button>
        )}
        <button
          type="button"
          className={styles.retryButton}
          aria-label={`Повторить задание ${mistake.taskNumber}`}
          onClick={onRetry}
        >
          <Icon name="retry" size={16} />
        </button>
        <button type="button" aria-label="Открыть задание" onClick={onOpen}>
          <Icon name="chevronRight" size={18} className={styles.chevron} />
        </button>
      </div>
    </div>
  );
}
