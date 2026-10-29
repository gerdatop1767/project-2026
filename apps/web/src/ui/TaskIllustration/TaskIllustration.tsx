import { getCustomIllustration, illustrationReconstructsOriginal } from './illustrations.js';
import styles from './TaskIllustration.module.css';

/**
 * The custom SVGs in illustrations.tsx were drawn from ЕГЭ 2026 Ященко
 * Вариант 1 — keyed by task number, so on their own they would also
 * land on every other task with that number (another 2026 variant, the
 * 2027 book, a demo task) and show the wrong figure there. They are
 * used only for tasks carrying this import tag.
 */
export const SVG_ILLUSTRATIONS_TAG = 'ege-2026-variant-1';

interface TaskFigureSource {
  subjectId: string;
  taskNumber: number;
  /** The task's own tags (`ege-2026-variant-1`, `ege-2027-variant-2`, …). */
  tags?: readonly string[];
  className?: string;
}

function hasOwnSvg({ subjectId, taskNumber, tags }: TaskFigureSource): boolean {
  return (
    (tags ?? []).includes(SVG_ILLUSTRATIONS_TAG) &&
    getCustomIllustration(subjectId, taskNumber) !== null
  );
}

export interface TaskExamIllustrationProps extends TaskFigureSource {
  /** The figure stored with this very task — an exact crop of the source scan. */
  imageUrl?: string | null;
}

/**
 * The figure printed with the task's condition, rendered inside
 * «Условие». For ЕГЭ 2026 Вариант 1 it is our verified vector
 * reconstruction (tasks 1, 3, 8, 11 — see illustrations.tsx). For any
 * other task it is that task's own `imageUrl`: an exact, unretouched
 * fragment of the source page, shown on a white "paper" ground in both
 * themes. A task with neither renders nothing — never another task's
 * figure.
 */
export function TaskExamIllustration({
  subjectId,
  taskNumber,
  tags,
  imageUrl,
  className,
}: TaskExamIllustrationProps) {
  if (hasOwnSvg({ subjectId, taskNumber, tags })) {
    if (!illustrationReconstructsOriginal(subjectId, taskNumber)) return null;
    return <div className={className}>{getCustomIllustration(subjectId, taskNumber)}</div>;
  }
  if (!imageUrl) return null;
  return (
    <div className={styles.sourceFigure}>
      <img
        className={styles.sourceFigureImage}
        src={imageUrl}
        alt={`Рисунок к заданию ${taskNumber}`}
        loading="lazy"
        decoding="async"
      />
    </div>
  );
}

export type TaskSolutionIllustrationProps = TaskFigureSource;

/**
 * A custom SVG diagram built from the task's own given/derived data,
 * for tasks whose original material prints no diagram at all (2, 14,
 * 17 — text-only Part 2 proofs). Labelled "Иллюстрация к решению" and
 * rendered outside "Условие" — it is our own solving aid, not
 * something the ЕГЭ material actually shows, so it must never be
 * visually mistaken for the original condition (audit Block 5).
 * Renders nothing for a task whose SVG already reconstructs a real
 * original diagram (that one belongs in `TaskExamIllustration` above,
 * not duplicated here), has no custom illustration at all, or is not
 * the task the SVG was drawn for.
 */
export function TaskSolutionIllustration({
  subjectId,
  taskNumber,
  tags,
  className,
}: TaskSolutionIllustrationProps) {
  if (!hasOwnSvg({ subjectId, taskNumber, tags })) return null;
  if (illustrationReconstructsOriginal(subjectId, taskNumber)) return null;
  return (
    <div className={styles.solutionIllustration}>
      <p className={styles.solutionIllustrationLabel}>Иллюстрация к решению</p>
      <div className={className}>{getCustomIllustration(subjectId, taskNumber)}</div>
    </div>
  );
}
