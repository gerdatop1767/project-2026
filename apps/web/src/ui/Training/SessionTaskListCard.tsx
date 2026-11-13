import { clsx } from '../../lib/clsx.js';
import type { SessionTask } from '../../data/sampleTask.js';
import styles from './SessionTaskListCard.module.css';

export interface SessionTaskListCardProps {
  title: string;
  sessionTasks: readonly SessionTask[];
  onSelect: (index: number) => void;
}

type Status = SessionTask['status'];

/** Spoken state for each number; `pending` and `current` add nothing
 * beyond the number itself (current is announced via aria-current). */
const STATUS_LABEL: Partial<Record<Status, string>> = {
  correct: 'верно',
  incorrect: 'неверно',
  draft: 'есть ответ, не проверен',
  opened: 'пропущено',
};

/** Legend order; only the states actually present are shown. */
const LEGEND: readonly { status: Status; label: string }[] = [
  { status: 'correct', label: 'Верно' },
  { status: 'incorrect', label: 'Ошибка' },
  { status: 'draft', label: 'Есть ответ' },
  { status: 'opened', label: 'Пропущено' },
];

const STATUS_CLASS: Record<Status, string | undefined> = {
  correct: styles.correct,
  incorrect: styles.incorrect,
  draft: styles.draft,
  opened: styles.opened,
  current: styles.current,
  pending: undefined,
};

/**
 * Desktop's session task navigator (Task / Result sidebars): a compact grid
 * of numbers — all 27 of a variant fit in a few rows, so any task is one
 * click away without scrolling a long list. State is shown by tint, not by
 * extra icons: current = accent fill, correct/incorrect = soft success/error
 * tint, draft = accent ring, skipped = dashed outline, not yet opened =
 * plain. A small legend names only the states that occur.
 */
export function SessionTaskListCard({ title, sessionTasks, onSelect }: SessionTaskListCardProps) {
  const present = new Set(sessionTasks.map((t) => t.status));
  const legend = LEGEND.filter((item) => present.has(item.status));

  function select(task: SessionTask) {
    if (task.status !== 'current') {
      // The sidebar stays in view (sticky) while the page may be scrolled
      // deep into a long condition — bring the newly opened task's top
      // into view instead of leaving the reader mid-page.
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo?.({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    }
    onSelect(task.index);
  }

  return (
    <nav className={styles.card} aria-label={title}>
      <p className="text-h3">{title}</p>
      <div className={styles.grid}>
        {sessionTasks.map((task) => {
          const state = STATUS_LABEL[task.status];
          return (
            <button
              key={task.index}
              type="button"
              className={clsx(styles.cell, STATUS_CLASS[task.status])}
              aria-label={state ? `Задание ${task.index} — ${state}` : `Задание ${task.index}`}
              aria-current={task.status === 'current' ? 'step' : undefined}
              title={state ? `Задание ${task.index}: ${state}` : `Задание ${task.index}`}
              onClick={() => select(task)}
            >
              {task.index}
            </button>
          );
        })}
      </div>
      {legend.length > 0 && (
        <ul className={styles.legend} aria-hidden="true">
          {legend.map((item) => (
            <li key={item.status} className={styles.legendItem}>
              <span className={clsx(styles.swatch, STATUS_CLASS[item.status])} />
              {item.label}
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
