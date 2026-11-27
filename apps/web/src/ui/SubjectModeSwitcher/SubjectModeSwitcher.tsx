import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { SubjectModeId } from '../../data/subjectContent.js';
import { clsx } from '../../lib/clsx.js';
import { Icon } from '../Icon/Icon.js';
import styles from './SubjectModeSwitcher.module.css';

export interface SubjectModeOption {
  id: SubjectModeId;
  label: string;
  /** Shown only in the wide (desktop) layout, under the label. */
  caption: string;
  glyph: ReactNode;
}

/** A 2×2 grid of numbered cells — «По номерам» (no stock icon says it). */
function NumberGridGlyph() {
  const cells = [
    [3, 3, '1'],
    [13, 3, '2'],
    [3, 13, '3'],
    [13, 13, '4'],
  ] as const;
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {cells.map(([x, y, digit]) => (
        <g key={digit}>
          <rect x={x} y={y} width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <text
            x={x + 4}
            y={y + 6.1}
            textAnchor="middle"
            fontSize="5.6"
            fontWeight="700"
            fill="currentColor"
            fontFamily="inherit"
          >
            {digit}
          </text>
        </g>
      ))}
    </svg>
  );
}

export const SUBJECT_MODES: readonly SubjectModeOption[] = [
  {
    id: 'topics',
    label: 'Темы',
    caption: 'Задания по темам',
    glyph: <Icon name="layers" size={22} />,
  },
  {
    id: 'byNumber',
    label: 'По номерам',
    caption: 'Конкретные номера',
    glyph: <NumberGridGlyph />,
  },
  {
    id: 'variants',
    label: 'Варианты',
    caption: 'Собрать вариант ЕГЭ',
    glyph: <Icon name="variant" size={22} />,
  },
  {
    id: 'favorites',
    label: 'Избранное',
    caption: 'Сохранённые задания',
    glyph: <Icon name="star" size={22} />,
  },
];

export interface SubjectModeSwitcherProps {
  value: SubjectModeId;
  onChange: (mode: SubjectModeId) => void;
  /** `stacked`: icon above the label (phones); `wide`: icon beside the
   * label and a caption (desktop). Same four cards, same behaviour. */
  layout: 'stacked' | 'wide';
  /** id of the element the tabs control (the mode's content). */
  panelId: string;
  className?: string;
}

/**
 * The subject page's mode switcher: four equal cards in one tray, the
 * active one marked by a single highlight that slides between them (a CSS
 * transition, so a quick second tap retargets it mid-way instead of
 * restarting). Tabs semantics: ←/→/Home/End move focus, Enter/Space
 * selects — selection is never moved by the arrows alone, because
 * «Избранное» may open the sign-in gate for a guest.
 */
export function SubjectModeSwitcher({
  value,
  onChange,
  layout,
  panelId,
  className,
}: SubjectModeSwitcherProps) {
  const base = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = Math.max(
    SUBJECT_MODES.findIndex((m) => m.id === value),
    0,
  );

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = SUBJECT_MODES.length - 1;
    const target =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    tabs.current[target]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label="Режим"
      className={clsx(styles.tray, layout === 'wide' ? styles.wide : styles.stacked, className)}
      style={{ ['--active-index' as string]: activeIndex }}
    >
      <span className={styles.highlight} aria-hidden="true" />
      {SUBJECT_MODES.map((mode, index) => {
        const selected = index === activeIndex;
        return (
          <button
            key={mode.id}
            ref={(el) => {
              tabs.current[index] = el;
            }}
            id={`${base}-${mode.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId}
            aria-labelledby={`${base}-${mode.id}-label`}
            aria-describedby={layout === 'wide' ? `${base}-${mode.id}-caption` : undefined}
            tabIndex={selected ? 0 : -1}
            className={clsx(styles.tab, selected && styles.active)}
            onClick={() => onChange(mode.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span className={styles.glyph}>{mode.glyph}</span>
            <span className={styles.text}>
              <span id={`${base}-${mode.id}-label`} className={styles.label}>
                {mode.label}
              </span>
              {layout === 'wide' && (
                <span id={`${base}-${mode.id}-caption`} className={styles.caption}>
                  {mode.caption}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
