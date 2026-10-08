import { Icon } from '../Icon/Icon.js';
import { Button } from '../Button/Button.js';
import { Collapse } from '../motion/motion.js';
import { VariantPreviewCard } from './VariantPreviewCard.js';
import type { TaskVariant } from '../../data/sampleTask.js';
import styles from './OtherVariantsSection.module.css';

export interface OtherVariantsSectionProps {
  taskNumber: number;
  variants: readonly TaskVariant[];
  open: boolean;
  onToggle: () => void;
  onSelectVariant: (variant: TaskVariant) => void;
  /** Result screen's collapsed summary reads "Похожие на это задание"
   * instead of Training's "Похожие задания на эту тему". */
  summarySubtitle: string;
}

/**
 * "Другие задания №N" (S1 Block 6 — mobile Training/Result): expanded
 * by default on the Training screen, collapsed on Result — a real
 * toggle either way, never a static list.
 */
export function OtherVariantsSection({
  taskNumber,
  variants,
  open,
  onToggle,
  onSelectVariant,
  summarySubtitle,
}: OtherVariantsSectionProps) {
  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.summary} aria-expanded={open} onClick={onToggle}>
        <Icon name="reference" size={18} className={styles.summaryIcon} />
        <span className={styles.summaryText}>
          <span className="text-body" style={{ fontWeight: 600 }}>
            Другие задания №{taskNumber}
          </span>
          <span className="text-body-sm text-secondary">{summarySubtitle}</span>
        </span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={18} className={styles.summaryIcon} />
      </button>
      <Collapse open={open}>
        <div className={styles.content}>
          <div className={styles.variantRow}>
            {variants.map((variant) => (
              <VariantPreviewCard key={variant.id} variant={variant} onSelect={onSelectVariant} />
            ))}
          </div>
          <Button variant="secondary" fullWidth>
            <Icon name="grid" size={18} /> К списку заданий №{taskNumber}
          </Button>
        </div>
      </Collapse>
    </div>
  );
}
