import { useEffect, useId, useState } from 'react';
import { LONG_GAME_MIN, roundSizeLimits } from '@zybrilka/shared';
import { getMiniGameSettings, saveMiniGameSettings } from '../../lib/api.js';
import { useAuth } from '../../lib/authContext.js';
import { clsx } from '../../lib/clsx.js';
import { registerPrivateCacheReset } from '../../lib/privateCaches.js';
import styles from './RoundSize.module.css';

const key = (gameId: string) => `zybrilka.miniGames.roundSize.${gameId}`;

function readLocal(gameId: string): number | null {
  try {
    const n = Number(window.localStorage.getItem(key(gameId)));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writeLocal(gameId: string, n: number) {
  try {
    window.localStorage.setItem(key(gameId), String(n));
  } catch {
    // Not remembered in this browser; the account (if any) still keeps it.
  }
}

/** The account's saved sizes, read once per sign-in (shared by every game). */
let accountSettings: Promise<Record<string, { roundSize: number }>> | null = null;
registerPrivateCacheReset(() => {
  accountSettings = null;
});
function loadAccountSettings() {
  accountSettings ??= getMiniGameSettings().then(
    (r) => ({ ...r.settings }),
    () => {
      accountSettings = null;
      return {};
    },
  );
  return accountSettings;
}

const inLimits = (gameId: string, n: number) => {
  const { min, max } = roundSizeLimits(gameId);
  return Number.isInteger(n) && n >= min && n <= max;
};

/**
 * The round size for this game: what the player chose last time — saved in
 * the account when signed in (so it survives a reload, another device and a
 * new sign-in) and in this browser as well; else `fallback`.
 */
export function useRoundSize(gameId: string, fallback: number): [number, (n: number) => void] {
  const { user } = useAuth();
  const signedIn = Boolean(user);
  const [size, setSize] = useState(() => {
    const local = readLocal(gameId);
    return local !== null && inLimits(gameId, local) ? local : fallback;
  });
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    void loadAccountSettings().then((all) => {
      const saved = all[gameId]?.roundSize;
      if (live && saved !== undefined && inLimits(gameId, saved)) {
        setSize(saved);
        writeLocal(gameId, saved);
      }
    });
    return () => {
      live = false;
    };
  }, [gameId, signedIn]);
  const choose = (n: number) => {
    if (!inLimits(gameId, n)) return;
    setSize(n);
    writeLocal(gameId, n);
    if (signedIn) {
      void loadAccountSettings().then((all) => {
        all[gameId] = { roundSize: n };
      });
      saveMiniGameSettings(gameId, n).catch(() => undefined);
    }
  };
  return [size, choose];
}

/** The size a round will really have: never more than the questions there are. */
export const effectiveRoundSize = (size: number, available: number | null) =>
  available === null ? size : Math.min(size, available);

/**
 * «Сколько за раунд»: quick sizes plus «Своё» — a number within the game's
 * limits and never more than the questions it has (`available`, when known).
 */
export function RoundSizePicker({
  gameId,
  value,
  onChange,
  available,
  unit = 'вопросов',
}: {
  gameId: string;
  value: number;
  onChange: (n: number) => void;
  /** Questions (words) the game has right now; null while unknown. */
  available: number | null;
  unit?: string;
}) {
  const limits = roundSizeLimits(gameId);
  const max = available === null ? limits.max : Math.max(1, Math.min(limits.max, available));
  const presets = limits.preset.filter((n) => n <= max);
  // «Длинная игра»: 100…500 in one saved session — only what the game has.
  const long = limits.long.filter((n) => n <= max);
  const custom = !presets.includes(value) && !long.includes(value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputId = useId();
  const hintId = useId();
  const draftNumber = Number(draft);
  const draftError =
    draft.trim() === ''
      ? null
      : !Number.isInteger(draftNumber)
        ? 'Введи целое число.'
        : draftNumber < limits.min
          ? `Не меньше ${limits.min}.`
          : draftNumber > max
            ? available !== null && available < limits.max
              ? `Сейчас в игре ${available} — больше не получится.`
              : `Не больше ${limits.max}.`
            : null;

  const apply = () => {
    if (draftError || draft.trim() === '') return;
    onChange(draftNumber);
    setEditing(false);
  };

  return (
    <fieldset className={styles.picker}>
      <legend className={styles.legend}>Сколько {unit} за раунд</legend>
      <div className={styles.chips} role="radiogroup" aria-label={`Сколько ${unit} за раунд`}>
        {presets.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n && !editing}
            className={clsx(styles.chip, value === n && !editing && styles.chipOn)}
            onClick={() => {
              setEditing(false);
              onChange(n);
            }}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={editing || custom}
          className={clsx(styles.chip, (editing || custom) && styles.chipOn)}
          onClick={() => {
            setDraft(custom ? String(value) : '');
            setEditing(true);
          }}
        >
          {custom && !editing ? value : 'Своё'}
        </button>
      </div>
      <p className={styles.groupLabel}>Длинная игра — сохраняется, можно продолжить позже</p>
      {long.length > 0 ? (
        <div className={styles.chips} role="radiogroup" aria-label="Длинная игра">
          {long.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n && !editing}
              className={clsx(styles.chip, value === n && !editing && styles.chipOn)}
              onClick={() => {
                setEditing(false);
                onChange(n);
              }}
            >
              {n}
            </button>
          ))}
        </div>
      ) : (
        <p className={styles.hint} role="status">
          {available !== null
            ? `Для длинной игры нужно от ${LONG_GAME_MIN} ${unit} — сейчас в игре ${available}.`
            : `Длинная игра — от ${LONG_GAME_MIN} ${unit}.`}
        </p>
      )}
      {editing && (
        <form
          className={styles.customRow}
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <label htmlFor={inputId} className={styles.customLabel}>
            Своё число ({limits.min}–{max})
          </label>
          <div className={styles.customField}>
            <input
              id={inputId}
              className={styles.input}
              type="number"
              inputMode="numeric"
              min={limits.min}
              max={max}
              step={1}
              value={draft}
              autoFocus
              aria-invalid={draftError !== null}
              aria-describedby={hintId}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button
              type="submit"
              className={styles.ok}
              disabled={draftError !== null || draft.trim() === ''}
            >
              Готово
            </button>
          </div>
          <p id={hintId} className={draftError ? styles.error : styles.hint} role="status">
            {draftError ?? `От ${limits.min} до ${max} ${unit}.`}
          </p>
        </form>
      )}
      {available !== null && value > available && !editing && (
        <p className={styles.warn} role="status">
          Сейчас в игре только {available} — раунд будет из {available}.{' '}
          <button type="button" className={styles.link} onClick={() => onChange(available)}>
            Выбрать {available}
          </button>
        </p>
      )}
    </fieldset>
  );
}
