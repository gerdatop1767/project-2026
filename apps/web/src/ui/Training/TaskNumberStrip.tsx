import { useEffect, useRef } from 'react';
import { Icon } from '../Icon/Icon.js';
import { clsx } from '../../lib/clsx.js';
import styles from './TaskNumberStrip.module.css';

export interface TaskNumberStripEntry {
  taskId: string;
  taskNumber: number;
}

export interface TaskNumberStripProps {
  /** The current task's id — identifies the active entry. Never
   * matched by `taskNumber`: a "По номерам" session with one number
   * selected (bugfix: correct task navigation) has every entry sharing
   * that same number (V1#N, V2#N, ...), so matching by number would
   * mark every button active at once and scroll to whichever happened
   * to be last in the list. */
  activeTaskId: string;
  /** The real ordered task list for the current source/variant — no
   * default: an empty array renders just the active number with no
   * siblings, rather than inventing a fake 11-19 range. */
  range: readonly TaskNumberStripEntry[];
  onSelect: (entry: TaskNumberStripEntry) => void;
}

/**
 * Mobile's EGE task-number strip (S1 Block 6 — Training screenshots):
 * scrolls the row by one screenful per arrow tap, matching the
 * approved "‹ 11 12 13 14 [15] 16 17 18 19 ›" composition. The arrows
 * only scroll this row horizontally — real prev/next task stepping is
 * a separate affordance (see TaskChrome's round buttons).
 *
 * Each button's label is normally its real exam `taskNumber` (a
 * Вариант/Сборник session: 11, 12, 13, ...). But a "По номерам" session
 * with exactly one number selected (bugfix: correct task navigation)
 * has every entry sharing that one number — labeling them all "13"
 * would render "13 13 13 13 13" and say nothing about position. When
 * every entry in `range` shares the same number, the label is its
 * 1-based POSITION in the list instead ("1 2 3 4 5") — `taskNumber`
 * stays the exam number shown in the header ("Задание №13"), never the
 * list position.
 */
export function TaskNumberStrip({ activeTaskId, range, onSelect }: TaskNumberStripProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeButtonRef = useRef<HTMLButtonElement>(null);
  const sameNumberSession =
    range.length > 1 && range.every((entry) => entry.taskNumber === range[0]!.taskNumber);

  function scrollBy(delta: number) {
    scrollerRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }

  // Keeps the active number in view on first open, Prev/Next, a number
  // click, Skip, and arriving from Result — without this the strip
  // always opens scrolled to its start, so e.g. task #15 of 19 renders
  // off-screen (audit Block 4). Deps are deliberately narrow
  // (`activeTaskId` + the range's length, not the array itself, which
  // is a fresh reference on many unrelated re-renders): this must run
  // only when the active task or the loaded range actually changes,
  // never on every render, or a manual scroll away from the active
  // number would keep getting fought back into place.
  useEffect(() => {
    activeButtonRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [activeTaskId, range.length]);

  return (
    <div className={styles.row}>
      <button
        type="button"
        className={styles.arrow}
        aria-label="Предыдущие номера заданий"
        onClick={() => scrollBy(-160)}
      >
        <Icon name="chevronLeft" size={20} />
      </button>
      <div className={styles.scroller} ref={scrollerRef}>
        {range.map((entry, i) => {
          const isActive = entry.taskId === activeTaskId;
          return (
            <button
              key={entry.taskId}
              ref={isActive ? activeButtonRef : undefined}
              type="button"
              className={clsx(styles.number, isActive && styles.numberActive)}
              aria-current={isActive ? 'true' : undefined}
              onClick={() => onSelect(entry)}
            >
              {sameNumberSession ? i + 1 : entry.taskNumber}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className={styles.arrow}
        aria-label="Следующие номера заданий"
        onClick={() => scrollBy(160)}
      >
        <Icon name="chevronRight" size={20} />
      </button>
    </div>
  );
}
