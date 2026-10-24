import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon/Icon.js';
import { clsx } from '../../lib/clsx.js';
import { useStreakContext } from '../../lib/streakContext.js';
import { useAuth } from '../../lib/authContext.js';
import { levelRankFor, levelRankStyle } from '../../lib/levelRanks.js';
import { LevelEmblem } from '../LevelEmblem/LevelEmblem.js';
import { useNavigation, useOptionalNavigation } from '../../lib/navigation.js';
import { streakTier } from '@zybrilka/shared';
import { StreakFlame } from './StreakFlame.js';
import styles from './StatusChips.module.css';

function daysWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'день';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня';
  return 'дней';
}

export interface StatusChipsProps {
  className?: string;
}

/**
 * The streak + level chips that sit in every persistent header across
 * the approved design (S1 Block 6) — mobile and desktop alike, both
 * via this exact same component (MobileShell/DesktopShell), so the
 * two platforms can never show a different streak number: there is
 * one `StreakProvider` fetch, read here on both shells.
 *
 * Level is real too: `GET /progress/xp` (server-side XP ledger, level
 * derived from total XP — docs/XP.md), read from the same provider; the
 * chip is a button that opens the «Уровень» page. Streak is real:
 * `useStreakContext()` reflects `GET /progress/streak`'s
 * server-computed (Europe/Moscow) state — `null` while still loading
 * shows the same "—" placeholder rather than a fabricated 0, but a
 * real `currentStreak: 0` (genuinely no streak yet) renders as an
 * honest "0", not hidden behind the placeholder forever.
 */
export function StatusChips({ className }: StatusChipsProps) {
  const { user } = useAuth();
  if (user === null) return <GuestChip className={className} />;
  return <AccountChips className={className} />;
}

/**
 * Guest mode: in place of streak/level (there is no history to count) a
 * quiet «Гость · Войти» chip — the way into an account, never a nag.
 */
function GuestChip({ className }: StatusChipsProps) {
  const { navigate } = useNavigation();
  return (
    <div className={clsx(styles.row, className)}>
      <button
        type="button"
        className={clsx(styles.chip, styles.guestChip)}
        onClick={() => navigate({ screen: 'login' })}
        aria-label="Гость. Войти или зарегистрироваться"
      >
        <Icon name="profile" size={18} className={styles.guestIcon} />
        <span className={styles.chipText}>
          <span className={styles.chipLabel}>Гость</span>
          <span className={styles.chipValue}>Войти</span>
        </span>
      </button>
    </div>
  );
}

function AccountChips({ className }: StatusChipsProps) {
  const { streak, xp } = useStreakContext();
  const navigation = useOptionalNavigation();
  const previousLevelRef = useRef<number | null>(null);
  const [levelBumped, setLevelBumped] = useState(false);

  useEffect(() => {
    if (xp === null) return;
    const previous = previousLevelRef.current;
    previousLevelRef.current = xp.level;
    // Only a real rise after a known value — never on first load.
    if (previous !== null && xp.level > previous) {
      setLevelBumped(true);
      const id = window.setTimeout(() => setLevelBumped(false), 900);
      return () => window.clearTimeout(id);
    }
  }, [xp]);
  const previousStreakRef = useRef<number | null>(null);
  const [justIncreased, setJustIncreased] = useState(false);
  const [levelUp, setLevelUp] = useState(false);

  useEffect(() => {
    if (streak === null) return;
    const previous = previousStreakRef.current;
    previousStreakRef.current = streak.currentStreak;
    // Only the transition from a real, already-known number to a
    // higher one counts — never on first load (no "previous" to
    // compare against yet) and never on every re-render. Crossing into
    // a new tier additionally plays the flame's one-off burst.
    if (previous !== null && streak.currentStreak > previous) {
      setJustIncreased(true);
      const newTier = streakTier(streak.currentStreak) > streakTier(previous);
      if (newTier) setLevelUp(true);
      const id = window.setTimeout(() => {
        setJustIncreased(false);
        setLevelUp(false);
      }, 900);
      return () => window.clearTimeout(id);
    }
  }, [streak]);

  const streakValue = streak === null ? '—' : String(streak.currentStreak);
  const tier = streakTier(streak?.currentStreak ?? 0);

  return (
    <div className={clsx(styles.row, className)}>
      <div
        className={clsx(styles.chip, styles.streakChip, justIncreased && styles.chipStreakUp)}
        data-tier={tier}
        aria-label={
          streak === null
            ? 'Серия загружается'
            : `Серия: ${streak.currentStreak} ${daysWord(streak.currentStreak)}`
        }
      >
        <StreakFlame tier={tier} levelUp={levelUp} size={22} />
        <span className={styles.chipText}>
          <span className={styles.chipLabel} aria-hidden="true">
            Серия
          </span>
          <span className={styles.chipValue} aria-hidden="true">
            {streakValue}
          </span>
        </span>
      </div>
      <button
        type="button"
        className={clsx(
          styles.chip,
          styles.levelChip,
          styles.levelButton,
          levelBumped && styles.chipStreakUp,
        )}
        data-rank={xp === null ? undefined : levelRankFor(xp.level).id}
        style={xp === null ? undefined : levelRankStyle(levelRankFor(xp.level))}
        onClick={() => navigation?.navigate({ screen: 'level' })}
        aria-label={
          xp === null
            ? 'Уровень загружается. Открыть страницу уровня'
            : xp.isMaxLevel
              ? `Уровень ${xp.level}, максимальный, ранг «${levelRankFor(xp.level).name}». Открыть страницу уровня`
              : `Уровень ${xp.level}, до следующего ${xp.xpToNextLevel} XP, ранг «${levelRankFor(xp.level).name}». Открыть страницу уровня`
        }
      >
        <span className={styles.levelChipRow}>
          {xp === null ? (
            <Icon name="crown" size={20} className={styles.crownIcon} />
          ) : (
            <LevelEmblem rank={levelRankFor(xp.level)} size={22} />
          )}
          <span className={styles.chipText} aria-hidden="true">
            <span className={styles.chipLabel}>Уровень</span>
            <span className={styles.chipValue}>{xp === null ? '—' : xp.level}</span>
          </span>
        </span>
        {xp !== null && (
          <span className={styles.levelBar} aria-hidden="true">
            <span
              className={styles.levelBarFill}
              style={{ width: `${Math.round(xp.progress * 100)}%` }}
            />
          </span>
        )}
      </button>
    </div>
  );
}
