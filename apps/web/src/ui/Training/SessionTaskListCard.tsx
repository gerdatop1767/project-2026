import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { clsx } from '../../lib/clsx.js';
import type { SessionTask } from '../../data/sampleTask.js';
import styles from './SessionTaskListCard.module.css';

export interface SessionTaskListCardProps {
  title: string;
  sessionTasks: readonly SessionTask[];
  onSelect: (index: number) => void;
  /** `card` (default): the desktop sidebar card. `sheet`: the same grid
   * inside a bottom sheet (mobile) — no own title or surface. */
  variant?: 'card' | 'sheet';
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

/** Past this many numbers the grid scrolls inside its own box (about six
 * rows in the sidebar) instead of stretching the page. */
export const SCROLL_AFTER = 42;

/**
 * The session's task navigator (Task / Result sidebars on desktop, a bottom
 * sheet on mobile): a compact grid of numbers. State is shown by tint, not
 * by extra icons: current = accent fill, correct/incorrect = soft
 * success/error tint, draft = accent ring, skipped = dashed outline, not
 * yet opened = plain. A small legend names only the states that occur.
 *
 * A long list (a «По номерам» session can hold 200 tasks) scrolls inside
 * the grid, which keeps the current number in view by moving only its own
 * scroll position — never the page's.
 */
export function SessionTaskListCard({
  title,
  sessionTasks,
  onSelect,
  variant = 'card',
}: SessionTaskListCardProps) {
  const present = new Set(sessionTasks.map((t) => t.status));
  const legend = LEGEND.filter((item) => present.has(item.status));
  // The number just clicked, until it becomes the current task: on a slow
  // network the previous task stays on screen while the next one loads,
  // so the grid answers the click at once instead of looking ignored.
  const currentIndex = sessionTasks.find((t) => t.status === 'current')?.index ?? null;
  const [requested, setRequested] = useState<{ index: number; from: number | null } | null>(null);
  const pendingIndex =
    requested && requested.from === currentIndex && requested.index !== currentIndex
      ? requested.index
      : null;
  const scrollable = sessionTasks.length > SCROLL_AFTER;
  const gridRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });

  // Never pulse forever if that task fails to open (the screen shows the
  // error itself).
  useEffect(() => {
    if (!requested) return;
    const timer = window.setTimeout(() => setRequested(null), 8000);
    return () => window.clearTimeout(timer);
  }, [requested]);

  function updateEdges() {
    const grid = gridRef.current;
    if (!grid) return;
    const top = grid.scrollTop > 2;
    const bottom = grid.scrollTop + grid.clientHeight < grid.scrollHeight - 2;
    setEdges((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
  }

  // Bring the current number into the grid's own view (centred when it was
  // out of view; left alone when already visible, so a reader who scrolled
  // the grid is not fought back).
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!scrollable || !grid || currentIndex === null) return;
    const cell = grid.querySelector<HTMLElement>('[aria-current="step"]');
    if (cell) {
      const top = cell.offsetTop;
      const bottom = top + cell.offsetHeight;
      if (top < grid.scrollTop || bottom > grid.scrollTop + grid.clientHeight)
        grid.scrollTop = top - (grid.clientHeight - cell.offsetHeight) / 2;
    }
    updateEdges();
  }, [scrollable, currentIndex, sessionTasks.length]);

  function select(task: SessionTask) {
    if (task.status !== 'current') {
      setRequested({ index: task.index, from: currentIndex });
      // The sidebar stays in view (sticky) while the page may be scrolled
      // deep into a long condition — bring the newly opened task's top
      // into view instead of leaving the reader mid-page.
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo?.({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    }
    onSelect(task.index);
  }

  return (
    <nav className={clsx(styles.card, variant === 'sheet' && styles.sheet)} aria-label={title}>
      {variant === 'card' && (
        <div className={styles.head}>
          <p className="text-h3">{title}</p>
          {currentIndex !== null && sessionTasks.length > 1 && (
            <span className={styles.counter}>
              <strong>{currentIndex}</strong> из {sessionTasks.length}
            </span>
          )}
        </div>
      )}
      <div
        ref={gridRef}
        className={clsx(
          styles.grid,
          scrollable && styles.scroll,
          edges.top && styles.fadeTop,
          edges.bottom && styles.fadeBottom,
        )}
        onScroll={scrollable ? updateEdges : undefined}
        tabIndex={scrollable ? -1 : undefined}
      >
        {sessionTasks.map((task) => {
          const state = STATUS_LABEL[task.status];
          return (
            <button
              key={task.index}
              type="button"
              className={clsx(
                styles.cell,
                STATUS_CLASS[task.status],
                pendingIndex === task.index && styles.pending,
              )}
              aria-busy={pendingIndex === task.index || undefined}
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
