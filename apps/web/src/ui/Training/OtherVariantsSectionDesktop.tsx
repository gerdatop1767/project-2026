import { VariantPreviewCard } from './VariantPreviewCard.js';
import { Icon } from '../Icon/Icon.js';
import { Button } from '../Button/Button.js';
import { Collapse } from '../motion/motion.js';
import type { TaskVariant } from '../../data/sampleTask.js';
import styles from './OtherVariantsSectionDesktop.module.css';

export interface OtherVariantsSectionDesktopProps {
  taskNumber: number;
  variants: readonly TaskVariant[];
  open: boolean;
  onToggle: () => void;
  onSelectVariant: (variant: TaskVariant) => void;
  /** "К списку заданий №N" — same as mobile's `onGoToList` (see its doc
   * comment on `OtherVariantsSection`): takes the user to Тренировка →
   * По номерам with this taskNumber pre-selected, never auto-starting
   * training. */
  onGoToList: () => void;
  /** Mirrors mobile's `summarySubtitle` (Training vs Result wording). */
  subtitle: string;
}

/**
 * Desktop's "Другие задания №N" — same collapsible-accordion UX as
 * mobile's `OtherVariantsSection` (collapsed by default, a header
 * click toggles it), the same cards (`VariantPreviewCard`), same data
 * source and click behavior — only the expanded content's layout
 * differs (a grid rather than a single mobile-width column). Lives at
 * the bottom of the page, full width, below the main/sidebar grid —
 * never inside either column.
 */
export function OtherVariantsSectionDesktop({
  taskNumber,
  variants,
  open,
  onToggle,
  onSelectVariant,
  onGoToList,
  subtitle,
}: OtherVariantsSectionDesktopProps) {
  if (variants.length === 0) return null;
  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.summary} aria-expanded={open} onClick={onToggle}>
        <Icon name="reference" size={18} className={styles.summaryIcon} />
        <span className={styles.summaryText}>
          <span className="text-body" style={{ fontWeight: 600 }}>
            Другие задания №{taskNumber}
          </span>
          <span className="text-body-sm text-secondary">{subtitle}</span>
        </span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={18} className={styles.summaryIcon} />
      </button>
      <Collapse open={open}>
        <div className={styles.content}>
          <div className={styles.grid}>
            {variants.map((variant) => (
              <VariantPreviewCard key={variant.id} variant={variant} onSelect={onSelectVariant} />
            ))}
          </div>
          <Button variant="secondary" onClick={onGoToList}>
            <Icon name="grid" size={18} /> К списку заданий №{taskNumber}
          </Button>
        </div>
      </Collapse>
    </div>
  );
}
