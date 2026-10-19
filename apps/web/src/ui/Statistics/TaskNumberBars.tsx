import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { TaskNumberProgress } from '../../data/sampleStatistics.js';
import { progressTone } from './progressTone.js';
import styles from './TaskNumberBars.module.css';

export interface TaskNumberBarsProps {
  rows: readonly TaskNumberProgress[];
  onSelect?: (number: number) => void;
  /** The number the visitor is looking at — outlined, independently of its progress colour. */
  activeNumber?: number | null;
}

/** One wave crest, drawn twice side by side so it can slide seamlessly. */
const WAVE_PATH =
  'M0 6 C 12.5 0, 37.5 0, 50 6 S 87.5 12, 100 6 S 137.5 0, 150 6 S 187.5 12, 200 6 V 20 H 0 Z';

/**
 * "Прогресс по заданиям": a column per EGE task number, filled to its real
 * percent with a liquid that gently sways — the level is the data, only the
 * surface moves. Colour follows the shared progress tones (green done,
 * violet partial, red-violet barely started); a number with nothing solved
 * has no liquid at all. The active number is outlined on its label, so
 * selection never repaints the progress colour.
 *
 * Motion: the surface sways with two transform-only keyframes per column,
 * paused while the strip is off screen; the level rises into place once.
 * With `prefers-reduced-motion` the liquid is still and simply at its level.
 */
export function TaskNumberBars({ rows, onSelect, activeNumber = null }: TaskNumberBarsProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(true);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) =>
      setOnScreen(entries.some((entry) => entry.isIntersecting)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={styles.scroller}
      role="list"
      aria-label="Прогресс по номерам заданий"
      data-paused={onScreen ? undefined : true}
    >
      {rows.map((row, index) => {
        const tone = progressTone(row);
        const percent = row.percent ?? 0;
        const active = row.number === activeNumber;
        return (
          <button
            key={row.number}
            type="button"
            className={styles.col}
            role="listitem"
            data-tone={tone}
            data-active={active || undefined}
            aria-current={active ? 'true' : undefined}
            onClick={() => onSelect?.(row.number)}
            aria-label={
              tone === 'empty'
                ? `Задание ${row.number}, не решалось`
                : `Задание ${row.number}: ${percent}%`
            }
            style={
              {
                ['--level' as string]: `${100 - percent}%`,
                ['--i' as string]: index,
              } as CSSProperties
            }
          >
            <span className={styles.track}>
              <span className={styles.percent}>{percent}%</span>
              {tone !== 'empty' && (
                <span className={styles.liquid}>
                  <svg className={styles.waveBack} viewBox="0 0 200 20" preserveAspectRatio="none">
                    <path d={WAVE_PATH} />
                  </svg>
                  <svg className={styles.wave} viewBox="0 0 200 20" preserveAspectRatio="none">
                    <path d={WAVE_PATH} />
                  </svg>
                  <span className={styles.body} />
                </span>
              )}
            </span>
            <span className={styles.number}>{row.number}</span>
          </button>
        );
      })}
    </div>
  );
}
