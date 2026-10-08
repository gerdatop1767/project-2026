import { DifficultyTag } from './DifficultyTag.js';
import { InlineMathText } from '../MathText/MathText.js';
import type { TaskVariant } from '../../data/sampleTask.js';
import styles from './VariantPreviewCard.module.css';

export interface VariantPreviewCardProps {
  variant: TaskVariant;
  onSelect: (variant: TaskVariant) => void;
}

/**
 * One "Другие задания №N" / "Похожие задания" preview card — shared by
 * mobile's `OtherVariantsSection` (accordion) and desktop's
 * `OtherVariantsSectionDesktop` (grid), so both ever render the exact
 * same card markup and the exact same math renderer (bugfix: Similar
 * Tasks previews showed raw `$\sqrt{...}$`/`\cdot` as plain text
 * instead of real typesetting). `variant.preview` is the task's full
 * `conditionMd` (never a character-sliced substring — that risks
 * cutting a `$...$` span mid-formula, which is exactly what produced
 * the raw-LaTeX bug); `InlineMathText` renders it properly and the
 * card's CSS clamps it visually to a few lines, same as any other
 * overflowing rich content — a PREVIEW only, never the answer field,
 * "Проверить ответ", solution, hint, canvas or tools from the real
 * task screen.
 *
 * The rendered preview is `aria-hidden` with an explicit `aria-label`
 * on the button instead: KaTeX's MathML twin (rendered for screen
 * readers on every other math span in the app) read as part of a
 * button's accessible name is announced as a confusing jumble rather
 * than real math, so a concise label ("Задание #abc12345, Сложное")
 * serves screen-reader users better here than the formula itself —
 * the full task (with its own properly-labelled math) is one tap away.
 */
export function VariantPreviewCard({ variant, onSelect }: VariantPreviewCardProps) {
  return (
    <button
      type="button"
      className={styles.card}
      onClick={() => onSelect(variant)}
      aria-label={`Задание ${variant.code}, ${variant.difficultyLabel}`}
    >
      <span className={styles.head} aria-hidden="true">
        <span className="text-body-sm" style={{ fontWeight: 700 }}>
          {variant.code}
        </span>
        <DifficultyTag label={variant.difficultyLabel} />
      </span>
      <span className={styles.preview} aria-hidden="true">
        <InlineMathText text={variant.preview} />
      </span>
    </button>
  );
}
