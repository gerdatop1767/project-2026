import { useState } from 'react';
import { Icon } from '../Icon/Icon.js';
import { SubjectTile } from '../SubjectTile/SubjectTile.js';
import { TaskNumberStrip, type TaskNumberStripEntry } from './TaskNumberStrip.js';
import { ProgressBar } from '../Progress/ProgressBar.js';
import { BottomSheet } from '../BottomSheet/BottomSheet.js';
import { ReportTaskContent } from '../ReportTask/ReportTaskContent.js';
import type { Subject } from '../../data/subjects.js';
import type { SampleTask } from '../../data/sampleTask.js';
import { useFavorite } from '../../lib/useFavorite.js';
import { clsx } from '../../lib/clsx.js';
import styles from './TaskChrome.module.css';

export interface TaskChromeProps {
  subject: Subject;
  task: SampleTask;
  onBack: () => void;
  /** The real ordered task list for the current source/variant — see
   * TaskNumberStrip; empty when there's no source/variant context. */
  numberStripRange: readonly TaskNumberStripEntry[];
  onSelectNumber: (entry: TaskNumberStripEntry) => void;
  previous: TaskNumberStripEntry | null;
  next: TaskNumberStripEntry | null;
  onGoTo: (entry: TaskNumberStripEntry) => void;
  /** Position within the real current session/list (from
   * `buildSessionProgress`, the same ordered list `numberStripRange`
   * comes from) — NOT `task.indexInSession`/`task.totalInSession`,
   * which are just a safe single-item default (see taskAdapter.ts). */
  indexInSession: number;
  totalInSession: number;
}

/**
 * The header + task-number strip + session-progress bar shared by
 * mobile Training and Result (S1 Block 6, approved design) — visually
 * and structurally identical across both screenshots, so it lives
 * once rather than being duplicated per screen. The strip and the
 * prev/next round buttons are both driven by the shared
 * useTaskNavigation hook via the parent screen — this component stays
 * purely presentational.
 */
export function TaskChrome({
  subject,
  task,
  onBack,
  numberStripRange,
  onSelectNumber,
  previous,
  next,
  onGoTo,
  indexInSession,
  totalInSession,
}: TaskChromeProps) {
  const progressPercent = (indexInSession / totalInSession) * 100;
  const favorite = useFavorite(task.id);
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <>
      <div className={styles.header}>
        <button type="button" className={styles.iconButton} aria-label="Назад" onClick={onBack}>
          <Icon name="back" size={20} />
        </button>
        <SubjectTile glyph={subject.glyph} color={subject.color} size={40} />
        <div className={styles.headerText}>
          <p className="text-body" style={{ fontWeight: 700 }}>
            {subject.shortName}
          </p>
          <p className="text-body-sm text-secondary">Задание №{task.number}</p>
        </div>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Пожаловаться на задание"
          onClick={() => setReportOpen(true)}
        >
          <Icon name="warning" size={20} />
        </button>
        <button
          type="button"
          className={clsx(styles.iconButton, favorite.isFavorite && styles.iconButtonActive)}
          aria-label={favorite.isFavorite ? 'Убрать из избранного' : 'В избранное'}
          aria-pressed={favorite.isFavorite ?? false}
          onClick={favorite.toggle}
        >
          <Icon name="bookmark" size={20} filled={favorite.isFavorite ?? false} />
        </button>
      </div>

      <BottomSheet open={reportOpen} onClose={() => setReportOpen(false)} title="Задание">
        <ReportTaskContent taskId={task.id} />
      </BottomSheet>

      <div className={styles.navRow}>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Предыдущий номер задания"
          disabled={!previous}
          onClick={() => previous && onGoTo(previous)}
        >
          <Icon name="chevronLeft" size={20} />
        </button>
        <TaskNumberStrip active={task.number} range={numberStripRange} onSelect={onSelectNumber} />
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Следующий номер задания"
          disabled={!next}
          onClick={() => next && onGoTo(next)}
        >
          <Icon name="chevronRight" size={20} />
        </button>
      </div>

      <div>
        <div className={styles.progressRow}>
          <span className="text-body-sm text-secondary">
            Задание {indexInSession} из {totalInSession}
          </span>
          <span className="text-body-sm text-secondary">{Math.round(progressPercent)}%</span>
        </div>
        <ProgressBar value={progressPercent} label="Прогресс тренировки" />
      </div>
    </>
  );
}
