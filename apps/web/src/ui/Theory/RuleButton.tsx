import { useState } from 'react';
import { hasTheory, theoryForTask } from '../../data/theory/russianTheory.js';
import { clsx } from '../../lib/clsx.js';
import { Icon } from '../Icon/Icon.js';
import { BottomSheet } from '../BottomSheet/BottomSheet.js';
import { Modal } from '../Modal/Modal.js';
import { TheoryTaskView } from './TheoryTaskView.js';
import styles from './RuleButton.module.css';

export interface RuleButtonProps {
  subjectId: string;
  taskNumber: number;
  /** A bottom sheet on mobile, a wide dialog on desktop. */
  presentation: 'sheet' | 'modal';
  className?: string;
}

/**
 * «Правило» on the task screen: the theory for this exact task number,
 * over the task — the screen underneath stays mounted, so the typed
 * answer, the timer and the hint stay as they were. Shown only for a
 * subject that has a theory catalog; a number with nothing yet says so.
 */
export function RuleButton({ subjectId, taskNumber, presentation, className }: RuleButtonProps) {
  const [open, setOpen] = useState(false);
  if (!hasTheory(subjectId)) return null;
  const task = theoryForTask(subjectId, taskNumber);
  const close = () => setOpen(false);

  const header = {
    title: `Правило к заданию №${taskNumber}`,
    subtitle: task?.title ?? 'Материала пока нет',
    icon: 'topic',
  } as const;
  const content = task ? (
    <TheoryTaskView task={task} />
  ) : (
    <p className="text-body-sm text-secondary">Материала к заданию №{taskNumber} пока нет.</p>
  );

  return (
    <>
      <button
        type="button"
        className={clsx(styles.button, className)}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Icon name="topic" size={16} /> Правило
      </button>
      {presentation === 'sheet' ? (
        <BottomSheet open={open} onClose={close} {...header} className={styles.panel}>
          {content}
        </BottomSheet>
      ) : (
        <Modal
          open={open}
          onClose={close}
          {...header}
          className={clsx(styles.panel, styles.wide)}
          wide
        >
          {content}
        </Modal>
      )}
    </>
  );
}
