import { useState, type ReactNode } from 'react';
import styles from './MistakeStats.module.css';

export interface MistakeStatsProps {
  total: number;
  repeatedPercent: number;
  improvementPercent: number;
  reviewedAgainCount: number;
}

/**
 * The four «Мои ошибки» figures as one family of tiles: each has its own
 * drawn icon and accent (violet / sky / green / amber) on the same tile
 * shape. Icons rise in once; a number gives a small bump only when its
 * value really changes (a removed mistake, a new subject) — never on the
 * first render, never on a loop. Reduced motion: static.
 */
export function MistakeStats({
  total,
  repeatedPercent,
  improvementPercent,
  reviewedAgainCount,
}: MistakeStatsProps) {
  return (
    <div className={styles.grid}>
      <Tile tone="violet" icon={<TotalIcon />} label="Всего ошибок" value={total} />
      <Tile
        tone="sky"
        icon={<RepeatIcon />}
        label="Повторяются"
        value={repeatedPercent}
        suffix="%"
      />
      <Tile
        tone="green"
        icon={<ImproveIcon />}
        label="Улучшение"
        value={improvementPercent}
        suffix="%"
      />
      <Tile
        tone="amber"
        icon={<ReviewedIcon />}
        label="Решено повторно"
        value={reviewedAgainCount}
      />
    </div>
  );
}

function Tile({
  tone,
  icon,
  label,
  value,
  suffix,
}: {
  tone: 'violet' | 'sky' | 'green' | 'amber';
  icon: ReactNode;
  label: string;
  value: number;
  suffix?: string;
}) {
  // Adjusted during render (not in an effect): a changed value bumps once.
  const [shown, setShown] = useState(value);
  const [bumps, setBumps] = useState(0);
  if (value !== shown) {
    setShown(value);
    setBumps((n) => n + 1);
  }
  return (
    <div className={styles.tile} data-tone={tone}>
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      <span key={bumps} className={styles.value} data-bump={bumps > 0 || undefined}>
        {value}
        {suffix && <span className={styles.suffix}>{suffix}</span>}
      </span>
      <span className={styles.label}>{label}</span>
    </div>
  );
}

const common = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** A sheet with a cross — "wrong answers". */
function TotalIcon() {
  return (
    <svg {...common}>
      <path d="M7 3.5h7.5L19 8v11a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1-1.5Z" />
      <path d="M14 3.5V8h4.5" opacity="0.7" />
      <path d="m10 12.5 4 4m0-4-4 4" />
    </svg>
  );
}

/** Two arrows chasing each other — "the same mistake again". */
function RepeatIcon() {
  return (
    <svg {...common}>
      <path d="M17.5 8.5A6.5 6.5 0 0 0 6 7.2" />
      <path d="M17.8 4.5v4h-4" />
      <path d="M6.5 15.5A6.5 6.5 0 0 0 18 16.8" />
      <path d="M6.2 19.5v-4h4" />
    </svg>
  );
}

/** Rising bars with an arrow — "getting better". */
function ImproveIcon() {
  return (
    <svg {...common}>
      <path d="M5 19v-4M10 19v-7M15 19v-5M20 19V9" opacity="0.55" />
      <path d="m4 11 5-5 4 3 6-5" />
      <path d="M15.5 4H19v3.5" />
    </svg>
  );
}

/** A check inside a looping badge — "solved on a second try". */
function ReviewedIcon() {
  return (
    <svg {...common}>
      <path d="M12 3.2 14.3 5l2.9-.2.9 2.8 2.4 1.7-1 2.7 1 2.7-2.4 1.7-.9 2.8-2.9-.2L12 20.8 9.7 19l-2.9.2-.9-2.8-2.4-1.7 1-2.7-1-2.7 2.4-1.7.9-2.8 2.9.2Z" />
      <path d="m8.8 12.2 2.2 2.2 4.2-4.6" />
    </svg>
  );
}
