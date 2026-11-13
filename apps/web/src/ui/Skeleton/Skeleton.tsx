import type { CSSProperties } from 'react';
import { clsx } from '../../lib/clsx.js';
import styles from './Skeleton.module.css';

interface BoneProps {
  width?: string | number;
  height?: string | number;
  className?: string;
}

/** Presentational shimmer block. Not exported — always used through a labeled composite below. */
function Bone({ width, height, className }: BoneProps) {
  const style: CSSProperties = { width, height };
  return <div className={clsx(styles.skeleton, className)} style={style} aria-hidden="true" />;
}

export interface SkeletonProps extends BoneProps {
  'aria-label'?: string;
}

/**
 * Base skeleton block (Design Spec Section 9 / 12): a lightweight CSS
 * shimmer, no JS animation loop. Carries its own `role="status"` when
 * used standalone; the composites below (paragraph, list, task,
 * progress) wrap several bones under one status region instead of
 * announcing each piece separately.
 */
export function Skeleton({ width, height, className, 'aria-label': ariaLabel }: SkeletonProps) {
  return (
    <div role="status" aria-label={ariaLabel ?? 'Загрузка'}>
      <Bone width={width} height={height} className={className} />
    </div>
  );
}

/** A single line of placeholder text. `width` narrows the last line of a paragraph. */
export function SkeletonText({ width = '100%' }: { width?: string | number }) {
  return <Skeleton className={styles.text} width={width} aria-label="Загрузка текста" />;
}

/** A paragraph of 2-4 placeholder lines, one status region for the whole block. */
export function SkeletonParagraph({ lines = 3 }: { lines?: number }) {
  return (
    <div className={styles.stack} role="status" aria-label="Загрузка текста">
      {Array.from({ length: lines }, (_, i) => (
        <Bone key={i} className={styles.text} width={i === lines - 1 ? '60%' : '100%'} />
      ))}
    </div>
  );
}

export function SkeletonAvatar({ size = 40 }: { size?: number }) {
  return (
    <Skeleton className={styles.avatar} width={size} height={size} aria-label="Загрузка аватара" />
  );
}

/** A generic card placeholder — the shape most task/progress/achievement cards share. */
export function SkeletonCard({ height = 96 }: { height?: number }) {
  return <Skeleton className={styles.card} height={height} aria-label="Загрузка карточки" />;
}

function SkeletonListRow() {
  return (
    <div className={styles.listItem}>
      <Bone className={styles.avatar} width={36} height={36} />
      <Bone className={styles.text} width="70%" />
    </div>
  );
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Загрузка списка">
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonListRow key={i} />
      ))}
    </div>
  );
}

/** Placeholder for a Training screen while the next task loads. */
export function SkeletonTask() {
  return (
    <div className={styles.stack} role="status" aria-label="Загрузка задания">
      <Bone className={styles.text} width="40%" />
      <Bone className={styles.text} width="100%" />
      <Bone className={styles.text} width="100%" />
      <Bone className={styles.text} width="60%" />
      <Bone className={styles.card} height={48} />
      <Bone className={styles.card} height={48} />
    </div>
  );
}

/** Placeholder for a progress bar/ring while stats load. */
export function SkeletonProgress() {
  return (
    <div className={styles.row} role="status" aria-label="Загрузка прогресса">
      <Bone className={styles.avatar} width={48} height={48} />
      <div className={styles.stack} style={{ flex: 1 }}>
        <Bone className={styles.text} width="50%" />
        <Bone className={styles.text} height={8} />
      </div>
    </div>
  );
}

/**
 * A number/word placeholder INSIDE a line of text (a stat tile's value, a
 * "N из M" caption): an inline bone, so it can sit in a <p> or <span>
 * without breaking the line box. The surrounding element carries the
 * loading semantics (aria-busy); this piece is decorative.
 */
export function SkeletonValue({ width = '3ch' }: { width?: string | number }) {
  return (
    <span
      className={clsx(styles.skeleton, styles.value)}
      style={{ width }}
      aria-hidden="true"
      data-testid="skeleton-value"
    />
  );
}

/** Same-shaped cards in a responsive grid (topic groups, variant chips, tiles). */
export function SkeletonGrid({
  count = 6,
  height = 52,
  minColumnWidth = '16rem',
  'aria-label': ariaLabel = 'Загрузка',
}: {
  count?: number;
  height?: number;
  minColumnWidth?: string;
  'aria-label'?: string;
}) {
  return (
    <div
      className={styles.grid}
      style={{ ['--skeleton-min-col' as string]: minColumnWidth }}
      role="status"
      aria-label={ariaLabel}
    >
      {Array.from({ length: count }, (_, i) => (
        <Bone key={i} className={styles.card} height={height} />
      ))}
    </div>
  );
}

/**
 * The app's frame while the session check (`/auth/me`) is in flight —
 * shaped like the real shell (header with logo and status chips; on
 * desktop the sidebar too) so nothing jumps when the real one mounts.
 */
export function SkeletonAppShell({ desktop }: { desktop: boolean }) {
  return (
    <div
      className={clsx(styles.shell, !desktop && styles.shellMobile)}
      role="status"
      aria-live="polite"
      aria-label="Загрузка"
    >
      <div className={styles.shellHeader}>
        <div className={styles.row}>
          <Bone className={styles.avatar} width={desktop ? 40 : 34} height={desktop ? 40 : 34} />
          <Bone className={styles.text} width={desktop ? 120 : 96} height={20} />
        </div>
        <div className={styles.shellChips}>
          {Array.from({ length: desktop ? 4 : 3 }, (_, i) => (
            <Bone
              key={i}
              className={styles.card}
              width={desktop ? 88 : 56}
              height={desktop ? 48 : 40}
            />
          ))}
        </div>
      </div>
      <div className={styles.shellBody}>
        {desktop && (
          <div className={styles.shellSidebar}>
            {Array.from({ length: 8 }, (_, i) => (
              <Bone key={i} className={styles.text} width={i === 0 ? '90%' : '70%'} height={18} />
            ))}
          </div>
        )}
        <div className={styles.shellMain}>
          <Bone className={styles.text} width={desktop ? 280 : 200} height={28} />
          <Bone className={styles.text} width={desktop ? 360 : '70%'} />
          <Bone className={styles.card} height={desktop ? 150 : 140} />
          <div
            className={styles.grid}
            style={{ ['--skeleton-min-col' as string]: desktop ? '14rem' : '9rem' }}
          >
            {Array.from({ length: desktop ? 4 : 2 }, (_, i) => (
              <Bone key={i} className={styles.card} height={desktop ? 140 : 110} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
