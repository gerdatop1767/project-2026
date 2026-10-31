import type { CSSProperties } from 'react';
import styles from './ChartTooltip.module.css';

export interface ChartTooltipContent {
  title: string;
  value: string;
  detail?: string;
}

/**
 * The exact numbers of the picked day. Anchored at `x` (0–100 % of the
 * chart's width) and shifted by the same share of its own width, so it
 * is centred mid-chart but never sticks out past either edge — no
 * clipping on a narrow phone.
 */
export function ChartTooltip({ x, content }: { x: number; content: ChartTooltipContent }) {
  return (
    <div
      className={styles.tooltip}
      style={{ ['--x' as string]: x } as CSSProperties}
      aria-hidden="true"
    >
      <span className={styles.title}>{content.title}</span>
      <span className={styles.value}>{content.value}</span>
      {content.detail && <span className={styles.detail}>{content.detail}</span>}
    </div>
  );
}

/** Screen-reader echo of the picked day (the visual tooltip is aria-hidden). */
export function chartAnnouncement(content: ChartTooltipContent | null): string {
  if (!content) return '';
  return [content.title, content.value, content.detail].filter(Boolean).join(', ');
}
