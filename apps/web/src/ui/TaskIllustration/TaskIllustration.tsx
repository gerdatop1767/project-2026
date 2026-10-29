import { getCustomIllustration, illustrationReconstructsOriginal } from './illustrations.js';
import styles from './TaskIllustration.module.css';

interface TaskFigureSource {
  subjectId: string;
  taskNumber: number;
  /** The task's own tags (`ege-2026-variant-1`, `ege-2027-variant-2`, …). */
  tags?: readonly string[];
  className?: string;
}

/**
 * The custom SVGs (illustrations.tsx) are keyed by import tag and task
 * number, so a figure lands only on the task it was drawn from — never
 * on another variant's or book's task with the same number.
 */
function hasOwnSvg({ subjectId, taskNumber, tags }: TaskFigureSource): boolean {
  return subjectId === 'math' && getCustomIllustration(tags, taskNumber) !== null;
}

export interface TaskExamIllustrationProps extends TaskFigureSource {
  /** The figure stored with this very task — an exact crop of the source scan. */
  imageUrl?: string | null;
  /** The condition text: used only to notice that it refers to a figure. */
  conditionMd?: string;
}

/** The condition itself says a figure is printed with it. */
export function conditionRefersToFigure(conditionMd: string | undefined): boolean {
  return /на рисунке|изображ[её]н|по рисунку|на клетчатой бумаге/i.test(conditionMd ?? '');
}

/**
 * The figure printed with the task's condition, rendered inside
 * «Условие». When the task has its own SVG drawn from the original
 * (illustrations.tsx — 2026 Вариант 1, and варианты 3–10 №2/8/11) that
 * SVG is shown; the task's `imageUrl` (an exact crop of the source page,
 * kept as the reference the SVG was checked against) is shown only for
 * a task with no SVG, on a white "paper" ground in both themes. A task with neither renders nothing — never another task's
 * figure — or, when its condition refers to a figure, a short note that
 * the figure is missing.
 */
export function TaskExamIllustration({
  subjectId,
  taskNumber,
  tags,
  imageUrl,
  conditionMd,
  className,
}: TaskExamIllustrationProps) {
  if (hasOwnSvg({ subjectId, taskNumber, tags })) {
    if (!illustrationReconstructsOriginal(tags, taskNumber)) return null;
    return <div className={className}>{getCustomIllustration(tags, taskNumber)}</div>;
  }
  if (!imageUrl) {
    // Never another task's figure — but say plainly that this one is missing.
    // Math only: elsewhere «изображён» is ordinary wording (e.g. a literary text).
    if (subjectId !== 'math' || !conditionRefersToFigure(conditionMd)) return null;
    return (
      <p className={styles.missingFigure} role="note">
        Рисунок к этому заданию ещё не добавлен, без него задание не решить. Мы знаем об этом —
        можно выбрать другое задание.
      </p>
    );
  }
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
  if (illustrationReconstructsOriginal(tags, taskNumber)) return null;
  return (
    <div className={styles.solutionIllustration}>
      <p className={styles.solutionIllustrationLabel}>Иллюстрация к решению</p>
      <div className={className}>{getCustomIllustration(tags, taskNumber)}</div>
    </div>
  );
}
