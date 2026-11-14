import { useState, type ReactNode } from 'react';
import { examEdition, examTaskSpec, type ExamEditionId } from '@zybrilka/shared';
import { hasTheory, theoryForTask } from '../../data/theory/russianTheory.js';
import { mathMaterialFor } from '../../data/theory/mathTheory.js';
import { clsx } from '../../lib/clsx.js';
import { Icon } from '../Icon/Icon.js';
import { BottomSheet } from '../BottomSheet/BottomSheet.js';
import { Modal } from '../Modal/Modal.js';
import { TheoryTaskView } from './TheoryTaskView.js';
import { MathTopicTheory } from './MathTopicTheory.js';
import styles from './RuleButton.module.css';

export interface RuleButtonProps {
  subjectId: string;
  taskNumber: number;
  /** The exam edition whose numbering the task uses (`examEditionForTask`).
   * Math needs it: the old Ященко-2027 №6 and ЕГЭ-2027 №6 are different
   * topics. Defaults to the current edition. */
  edition?: ExamEditionId;
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
export function RuleButton({
  subjectId,
  taskNumber,
  edition = 'ege-2027',
  presentation,
  className,
}: RuleButtonProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  let header: { title: string; subtitle: string; icon: 'topic' };
  let content: ReactNode;
  if (subjectId === 'math') {
    const spec = examTaskSpec('math', edition, taskNumber);
    if (!spec) return null;
    // Only once at least one topic of this number has written theory.
    if (!spec.topics.some((b) => b.status !== 'unclear' && mathMaterialFor(b.topicKey))) {
      return null;
    }
    header = {
      title: `Теория к заданию №${taskNumber}`,
      subtitle: `${examEdition(edition)!.shortTitle} · ${spec.title}`,
      icon: 'topic',
    };
    content = spec.topics
      .filter((b) => b.status !== 'unclear')
      .map((b) => (
        <MathTopicTheory
          key={b.topicKey}
          topicKey={b.topicKey}
          note={b.status !== 'official' || b.relation !== 'same' ? b.note : undefined}
          partOf={b.relation === 'part-of'}
          showTitle={spec.topics.length > 1}
        />
      ));
  } else {
    if (!hasTheory(subjectId)) return null;
    const task = theoryForTask(subjectId, taskNumber);
    header = {
      title: `Правило к заданию №${taskNumber}`,
      subtitle: task?.title ?? 'Материала пока нет',
      icon: 'topic',
    };
    content = task ? (
      <TheoryTaskView task={task} />
    ) : (
      <p className="text-body-sm text-secondary">Материала к заданию №{taskNumber} пока нет.</p>
    );
  }

  return (
    <>
      <button
        type="button"
        className={clsx(styles.button, className)}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Icon name="topic" size={16} /> {subjectId === 'math' ? 'Теория' : 'Правило'}
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
