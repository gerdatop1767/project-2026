import { useEffect, useState } from 'react';
import type { TaskPublic } from '@zybrilka/shared';
import { getTask, listFavoriteTaskIds, removeFavorite } from '../../lib/api.js';
import { invalidateFavoritesCache } from '../../lib/useFavorite.js';
import { Icon } from '../Icon/Icon.js';
import { InlineMathText } from '../MathText/MathText.js';
import { clsx } from '../../lib/clsx.js';
import styles from './FavoritesList.module.css';
import { SkeletonList } from '../Skeleton/Skeleton.js';

export interface FavoritesListProps {
  subjectId: string;
  onSelect: (task: TaskPublic) => void;
}

type LoadState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; tasks: readonly TaskPublic[] };

/**
 * The real "Избранное" list (real fix: this used to be a static
 * `ModePlaceholder` — bookmarking a task actually worked server-side,
 * but nothing ever listed the result, so it looked broken). Fetches
 * the account's real favorited task ids, resolves each to its full
 * task data (the favorites API only returns ids — reuses the same
 * `getTask` every Task screen already calls, no new endpoint needed),
 * and scopes the list to the current subject like every other mode
 * tab here. Removing a row calls the real DELETE and drops it from
 * this list immediately — no manual page reload needed.
 */
export function FavoritesList({ subjectId, onSelect }: FavoritesListProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [removingId, setRemovingId] = useState<string | null>(null);
  // Resets to "loading" when `subjectId` changes, evaluated during
  // render rather than as a post-commit setState-in-effect cascade —
  // React's documented "adjusting state when a prop changes" pattern
  // (same as CanvasWorkspaceMobile/Desktop's syncedFor).
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (subjectId !== loadedFor && state.status !== 'loading') {
    setState({ status: 'loading' });
  }

  useEffect(() => {
    let cancelled = false;
    void listFavoriteTaskIds()
      .then((res) => Promise.all(res.taskIds.map((id) => getTask(id))))
      .then((tasks) => {
        if (cancelled) return;
        // `getTask` returns `TaskWithSolution` once the user has an
        // attempt on record, which is a strict superset of `TaskPublic`
        // — every field this list uses is present either way.
        const scoped = (tasks as readonly TaskPublic[])
          .filter((t) => t.subjectId === subjectId)
          .sort((a, b) => a.taskNumber - b.taskNumber);
        setState({ status: 'ready', tasks: scoped });
        setLoadedFor(subjectId);
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: 'error' });
        setLoadedFor(subjectId);
      });
    return () => {
      cancelled = true;
    };
  }, [subjectId]);

  function handleRemove(taskId: string) {
    if (state.status !== 'ready') return;
    setRemovingId(taskId);
    void removeFavorite(taskId)
      .then(() => {
        invalidateFavoritesCache();
        setState((current) =>
          current.status === 'ready'
            ? { status: 'ready', tasks: current.tasks.filter((t) => t.id !== taskId) }
            : current,
        );
      })
      .finally(() => setRemovingId(null));
  }

  if (state.status === 'loading') {
    return <SkeletonList rows={3} />;
  }

  if (state.status === 'error') {
    return <p className="text-body-sm text-secondary">Не удалось загрузить избранное.</p>;
  }

  if (state.tasks.length === 0) {
    return (
      <div className={styles.empty}>
        <span className={styles.emptyIcon}>
          <Icon name="favorite" size={26} />
        </span>
        <p className="text-h3">Избранное</p>
        <p className="text-body-sm text-secondary">
          Сохранённые задания появятся здесь, как только ты добавишь первое.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {state.tasks.map((task) => (
        <div key={task.id} className={styles.row}>
          <button type="button" className={styles.rowMain} onClick={() => onSelect(task)}>
            <span className={styles.rowNumber}>№{task.taskNumber}</span>
            <span className={clsx('text-body-sm', styles.rowCondition)}>
              <InlineMathText text={task.conditionMd} />
            </span>
          </button>
          <button
            type="button"
            className={styles.removeButton}
            aria-label="Убрать из избранного"
            disabled={removingId === task.id}
            onClick={() => handleRemove(task.id)}
          >
            <Icon name="bookmark" size={18} filled />
          </button>
        </div>
      ))}
    </div>
  );
}
