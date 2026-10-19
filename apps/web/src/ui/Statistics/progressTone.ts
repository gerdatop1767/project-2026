import type { TaskNumberProgress } from '../../data/sampleStatistics.js';

/**
 * How far along a task number is, as one of four tones shared by the wave
 * columns and the "Задания по номерам" cards (mobile and desktop):
 * - `empty`   — nothing solved yet: neutral navy, never a fill;
 * - `low`     — under LOW_BELOW percent: a muted red-violet;
 * - `partial` — on the way: violet;
 * - `done`    — every published task of the number solved: green.
 *
 * Purely visual: it reads the row's real `percent`/`completed`/`total` and
 * never changes them.
 */
export type ProgressTone = 'empty' | 'low' | 'partial' | 'done';

/** Below this the progress reads as "barely started". */
export const LOW_BELOW = 20;

export function progressTone(row: TaskNumberProgress): ProgressTone {
  const percent = row.percent ?? 0;
  if (percent <= 0) return 'empty';
  const complete =
    row.total !== undefined && row.total > 0 ? (row.completed ?? 0) >= row.total : percent >= 100;
  if (complete) return 'done';
  return percent < LOW_BELOW ? 'low' : 'partial';
}

/** Short, honest status line for a card. */
export function progressStatusLabel(row: TaskNumberProgress): string {
  const tone = progressTone(row);
  if (tone === 'empty') return 'Не решалось';
  if (tone === 'done') return 'Решено';
  return `${row.percent}%`;
}
