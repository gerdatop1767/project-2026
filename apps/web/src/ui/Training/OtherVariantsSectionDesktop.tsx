import { VariantPreviewCard } from './VariantPreviewCard.js';
import { Icon } from '../Icon/Icon.js';
import { Button } from '../Button/Button.js';
import type { TaskVariant } from '../../data/sampleTask.js';
import styles from './OtherVariantsSectionDesktop.module.css';

export interface OtherVariantsSectionDesktopProps {
  taskNumber: number;
  variants: readonly TaskVariant[];
  onSelectVariant: (variant: TaskVariant) => void;
  /** Mirrors mobile's `summarySubtitle` (Training vs Result wording). */
  subtitle: string;
}

/**
 * Desktop's "Другие задания №N" — same feature, same cards
 * (`VariantPreviewCard`), same data source and click behavior as
 * mobile's `OtherVariantsSection`, just laid out as an always-visible
 * grid instead of a collapsible accordion (desktop has the vertical
 * space; the mobile accordion pattern exists to save it, not because
 * the content itself differs). Lives at the bottom of the page, full
 * width, below the main/sidebar grid — never inside either column.
 */
export function OtherVariantsSectionDesktop({
  taskNumber,
  variants,
  onSelectVariant,
  subtitle,
}: OtherVariantsSectionDesktopProps) {
  if (variants.length === 0) return null;
  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <Icon name="reference" size={18} className={styles.headerIcon} />
        <div>
          <p className="text-h3">Другие задания №{taskNumber}</p>
          <p className="text-body-sm text-secondary">{subtitle}</p>
        </div>
      </div>
      <div className={styles.grid}>
        {variants.map((variant) => (
          <VariantPreviewCard key={variant.id} variant={variant} onSelect={onSelectVariant} />
        ))}
      </div>
      <Button variant="secondary">
        <Icon name="grid" size={18} /> К списку заданий №{taskNumber}
      </Button>
    </div>
  );
}
