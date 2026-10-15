import { useState } from 'react';
import type { Passage } from '@zybrilka/shared';
import { MathText } from '../MathText/MathText.js';
import { clsx } from '../../lib/clsx.js';
import styles from './PassageCard.module.css';

export interface PassageCardProps {
  passage: Passage;
  className?: string;
}

/**
 * The shared reading material a task's own condition refers to
 * ("Прочитайте текст и выполните задание") but doesn't repeat — see
 * `packages/db/src/schema.ts`'s `passages` table doc comment. Rendered
 * ABOVE the task's own condition (the task number/instruction stays
 * with its own card), visually distinct (its own tinted surface) so
 * it reads as shared source material, not part of this one task's
 * wording. A long passage (the literary excerpt is ~2000 characters)
 * defaults to a scrollable, fixed-height region rather than one long
 * wall of text — the full text is always reachable by scrolling even
 * before the toggle is used, never hidden or cut off. "Читать текст
 * полностью" just removes the height cap for a reader who prefers
 * scrolling the whole page instead of an inner scrollbar.
 */
export function PassageCard({ passage, className }: PassageCardProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={clsx(styles.card, className)}>
      <p className={styles.label}>Текст к заданию</p>
      {passage.title && <p className={styles.title}>{passage.title}</p>}
      <div className={clsx(styles.body, expanded && styles.bodyExpanded)}>
        <MathText text={passage.bodyMd} className={styles.paragraph} />
      </div>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded ? 'Свернуть текст' : 'Читать текст полностью'}
      </button>
      {(passage.sourceAuthor || passage.sourceNote) && (
        <div className={styles.attribution}>
          {passage.sourceAuthor && <p className={styles.sourceAuthor}>{passage.sourceAuthor}</p>}
          {passage.sourceNote && <p className={styles.sourceNote}>{passage.sourceNote}</p>}
        </div>
      )}
    </div>
  );
}
