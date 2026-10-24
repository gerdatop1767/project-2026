import { useState } from 'react';
import { Icon } from '../Icon/Icon.js';
import { SubjectTile } from '../SubjectTile/SubjectTile.js';
import { TaskNumberStrip, type TaskNumberStripEntry } from './TaskNumberStrip.js';
import { ProgressBar } from '../Progress/ProgressBar.js';
import { BottomSheet } from '../BottomSheet/BottomSheet.js';
import {
  ReportTaskContent,
  reportDialogHeader,
  reportPanelClassName,
} from '../ReportTask/ReportTaskContent.js';
import type { Subject } from '../../data/subjects.js';
import { useFavorite } from '../../lib/useFavorite.js';
import { clsx } from '../../lib/clsx.js';
import styles from './TaskChrome.module.css';

export interface TaskChromeProps {
  subject: Subject;
  /** The task the route points at. Only its id and number are needed,
   * both known from the route before the task itself has loaded — so the
   * chrome (and the strip's active number) can switch the instant a
   * number is picked, while the task's content is still on its way. */
  taskId: string;
  taskNumber: number;
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
  /** Where «Сообщить об ошибке» is sent from (stored with the report). */
  reportScreen?: 'task' | 'result';
  variantId?: string;
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
  taskId,
  taskNumber,
  onBack,
  numberStripRange,
  onSelectNumber,
  previous,
  next,
  onGoTo,
  indexInSession,
  totalInSession,
  reportScreen = 'task',
  variantId,
}: TaskChromeProps) {
  const progressPercent = (indexInSession / totalInSession) * 100;
  const favorite = useFavorite(taskId);
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <>
      <div className={styles.header}>
        <button type="button" className={styles.iconButton} aria-label="Назад" onClick={onBack}>
          <Icon name="back" size={20} />
        </button>
        <SubjectTile glyph={subject.glyph} size={40} />
        <div className={styles.headerText}>
          <p className="text-body" style={{ fontWeight: 700 }}>
            {subject.shortName}
          </p>
          <p className="text-body-sm text-secondary">Задание №{taskNumber}</p>
        </div>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Сообщить об ошибке в задании"
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

      <BottomSheet
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        {...reportDialogHeader}
        className={reportPanelClassName}
      >
        <ReportTaskContent
          key={taskId}
          taskId={taskId}
          screen={reportScreen}
          variantId={variantId}
          onClose={() => setReportOpen(false)}
        />
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
        <TaskNumberStrip activeTaskId={taskId} range={numberStripRange} onSelect={onSelectNumber} />
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
