import { useState } from 'react';
import { clsx } from '../../lib/clsx.js';
import styles from './RoundSize.module.css';

const key = (gameId: string) => `zybrilka.miniGames.roundSize.${gameId}`;

/** The round size the player picked for this game last time, else `fallback`. */
export function useRoundSize(
  gameId: string,
  choices: readonly number[],
  fallback: number,
): [number, (n: number) => void] {
  const [size, setSize] = useState(() => {
    try {
      const saved = Number(window.localStorage.getItem(key(gameId)));
      return choices.includes(saved) ? saved : fallback;
    } catch {
      return fallback;
    }
  });
  const choose = (n: number) => {
    setSize(n);
    try {
      window.localStorage.setItem(key(gameId), String(n));
    } catch {
      // Not remembered; this round still uses it.
    }
  };
  return [size, choose];
}

/** «Сколько вопросов за раунд»: a row of size chips. */
export function RoundSizePicker({
  choices,
  value,
  onChange,
  unit = 'вопросов',
}: {
  choices: readonly number[];
  value: number;
  onChange: (n: number) => void;
  unit?: string;
}) {
  return (
    <fieldset className={styles.picker}>
      <legend className={styles.legend}>Сколько {unit} за раунд</legend>
      <div className={styles.chips} role="radiogroup">
        {choices.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            className={clsx(styles.chip, value === n && styles.chipOn)}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
