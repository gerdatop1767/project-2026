import { Icon } from '../Icon/Icon.js';
import { clsx } from '../../lib/clsx.js';
import type { SessionTask } from '../../data/sampleTask.js';
import styles from './SessionTaskListCard.module.css';

export interface SessionTaskListCardProps {
  title: string;
  sessionTasks: readonly SessionTask[];
  onSelect: (index: number) => void;
}

/**
 * Desktop's session task-list sidebar card (S1 Block 6 — Training/
 * Result): title varies per screen ("Другие задания" / "Задания в
 * теме" / "Задания") but the row structure is identical everywhere.
 */
export function SessionTaskListCard({ title, sessionTasks, onSelect }: SessionTaskListCardProps) {
  return (
    <div className={styles.card}>
      <p className="text-h3">{title}</p>
      <div className={styles.list}>
        {sessionTasks.map((task) => (
          <button
            key={task.index}
            type="button"
            className={clsx(styles.row, task.status === 'current' && styles.rowCurrent)}
            onClick={() => onSelect(task.index)}
          >
            <Icon name="chevronLeft" size={14} className={styles.rowChevron} />
            <span className={styles.rowLabel}>Задание {task.index}</span>
            <StatusIcon status={task.status} />
          </button>
        ))}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: SessionTask['status'] }) {
  if (status === 'correct') {
    return (
      <span className={clsx(styles.statusDot, styles.statusCorrect)}>
        <Icon name="check" size={12} />
      </span>
    );
  }
  if (status === 'incorrect') {
    return (
      <span className={clsx(styles.statusDot, styles.statusIncorrect)}>
        <Icon name="close" size={12} />
      </span>
    );
  }
  if (status === 'draft') {
    return (
      <span
        className={clsx(styles.statusDot, styles.statusDraft)}
        aria-label="есть ответ, не проверен"
      />
    );
  }
  if (status === 'opened') {
    return <span className={clsx(styles.statusDot, styles.statusOpened)} aria-label="открыто" />;
  }
  if (status === 'current') {
    return <span className={clsx(styles.statusDot, styles.statusCurrent)} />;
  }
  return <span className={clsx(styles.statusDot, styles.statusPending)} />;
}
