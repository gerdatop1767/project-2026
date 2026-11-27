import { useEffect, useMemo, useState } from 'react';
import type { TaskPublic } from '@zybrilka/shared';
import { listTasksByTopic } from '../../lib/api.js';
import { clsx } from '../../lib/clsx.js';
import { Button } from '../../ui/Button/Button.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { SkeletonList } from '../../ui/Skeleton/Skeleton.js';
import styles from './UnlimitedTaskPicker.module.css';

export interface UnlimitedTaskPickerProps {
  subjectId: string;
  topicId: string;
  collection: string | null;
  /** «Номера внутри темы»: only these numbers (none = every number). */
  numbers: ReadonlySet<number>;
  /** «Только нерешённые»: tasks without a correct attempt yet. */
  unsolved: boolean;
  /** Picked task ids, kept by the parent (it survives leaving the screen). */
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  /** The tasks in list order, for starting the training. */
  onTasksLoaded: (tasks: readonly TaskPublic[]) => void;
}

/** The first words of a condition, without markdown, for a list row. */
export function conditionPreview(md: string, max = 110): string {
  const text = md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[*_`>#|]/g, '')
    // A simple formula reads fine as text (a, x^2 = a); one with TeX
    // commands (frac, sqrt…) would turn into nonsense — it is cut.
    .replace(/\$([^$]*)\$/g, (_m, tex: string) => {
      const plain = tex.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
      return !tex.includes('\\') && plain.length > 0 && plain.length <= 14 ? plain : '…';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/**
 * «Без ограничения»: the whole list of the topic's real tasks at once —
 * pick any of them, several, or all; the count of picked tasks is always
 * in view. Nothing starts until «Начать тренировку».
 */
export function UnlimitedTaskPicker({
  subjectId,
  topicId,
  collection,
  numbers,
  unsolved,
  selected,
  onChange,
  onTasksLoaded,
}: UnlimitedTaskPickerProps) {
  const key = `${subjectId}:${topicId}:${collection ?? ''}:${unsolved ? 'u' : 'a'}`;
  const [load, setLoad] = useState<{ key: string; tasks: TaskPublic[] | null } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listTasksByTopic({
      subject: subjectId,
      topic: topicId,
      collection: collection ?? undefined,
      unsolved,
    })
      .then((tasks) => {
        if (!cancelled)
          setLoad({
            key,
            tasks: [...tasks].sort((a, b) => a.taskNumber - b.taskNumber),
          });
      })
      .catch(() => {
        if (!cancelled) setLoad({ key, tasks: null });
      });
    return () => {
      cancelled = true;
    };
  }, [key, subjectId, topicId, collection, unsolved, attempt]);

  const all = load?.key === key ? load.tasks : undefined;
  const shown = useMemo(
    () => (all ?? []).filter((t) => numbers.size === 0 || numbers.has(t.taskNumber)),
    [all, numbers],
  );

  useEffect(() => {
    if (all) onTasksLoaded(shown);
  }, [all, shown, onTasksLoaded]);

  const picked = new Set(selected);
  const pickedShown = shown.filter((t) => picked.has(t.id));
  const allPicked = shown.length > 0 && pickedShown.length === shown.length;

  function toggle(id: string) {
    onChange(picked.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  if (all === undefined) return <SkeletonList rows={5} />;
  if (all === null)
    return (
      <div className={styles.error} role="alert">
        <p className="text-body-sm text-secondary">Не удалось загрузить задания.</p>
        <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
          Повторить
        </Button>
      </div>
    );
  if (shown.length === 0)
    return (
      <p className="text-body-sm text-secondary">
        {unsolved
          ? 'Нерешённых заданий здесь нет — выключи «Только нерешённые» или выбери другую тему.'
          : 'В этой теме с такими фильтрами заданий нет.'}
      </p>
    );

  return (
    <div className={styles.picker}>
      <div className={styles.toolbar}>
        <p className={styles.count} aria-live="polite">
          Выбрано <strong>{pickedShown.length}</strong> из {shown.length}
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.action}
            disabled={allPicked}
            onClick={() => onChange([...new Set([...selected, ...shown.map((t) => t.id)])])}
          >
            <Icon name="checkboxChecked" size={16} /> Выбрать все
          </button>
          <button
            type="button"
            className={styles.action}
            disabled={pickedShown.length === 0}
            onClick={() => {
              const ids = new Set(shown.map((t) => t.id));
              onChange(selected.filter((id) => !ids.has(id)));
            }}
          >
            <Icon name="close" size={16} /> Снять выбор
          </button>
        </div>
      </div>

      <ul className={styles.list} aria-label="Задания темы">
        {shown.map((task, i) => {
          const on = picked.has(task.id);
          return (
            <li key={task.id}>
              <label className={clsx(styles.row, on && styles.rowOn)}>
                <input
                  type="checkbox"
                  className={styles.checkbox}
                  checked={on}
                  onChange={() => toggle(task.id)}
                />
                <span className={styles.index}>{i + 1}</span>
                <span className={styles.body}>
                  <span className={styles.meta}>
                    <strong>№{task.taskNumber}</strong> · {task.source}
                  </span>
                  <span className={styles.preview}>{conditionPreview(task.conditionMd)}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
