import { useEffect, useRef, useState } from 'react';
import { Icon } from '../Icon/Icon.js';
import { clsx } from '../../lib/clsx.js';
import { useStreakContext } from '../../lib/streakContext.js';
import { useAuth } from '../../lib/authContext.js';
import { useNavigation } from '../../lib/navigation.js';
import styles from './StatusChips.module.css';

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
 * Level/XP has no backend behind it yet (see CLAUDE.md — explicitly
 * deferred) and keeps the neutral "—" placeholder. Streak is real:
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
  const { streak } = useStreakContext();
  const previousStreakRef = useRef<number | null>(null);
  const [justIncreased, setJustIncreased] = useState(false);

  useEffect(() => {
    if (streak === null) return;
    const previous = previousStreakRef.current;
    // Only the transition from a real, already-known number to a
    // higher one counts — never on first load (no "previous" to
    // compare against yet) and never on every re-render.
    if (previous !== null && streak.currentStreak > previous) {
      setJustIncreased(true);
      const id = window.setTimeout(() => setJustIncreased(false), 900);
      previousStreakRef.current = streak.currentStreak;
      return () => window.clearTimeout(id);
    }
    previousStreakRef.current = streak.currentStreak;
  }, [streak]);

  const streakValue = streak === null ? '—' : String(streak.currentStreak);

  return (
    <div className={clsx(styles.row, className)}>
      <div className={clsx(styles.chip, justIncreased && styles.chipStreakUp)}>
        <Icon
          name="flame"
          size={20}
          className={clsx(styles.flameIcon, justIncreased && styles.flameIconUp)}
        />
        <span className={styles.chipText}>
          <span className={styles.chipLabel}>Серия</span>
          <span className={styles.chipValue}>{streakValue}</span>
        </span>
      </div>
      <div className={clsx(styles.chip, styles.levelChip)}>
        <div className={styles.levelChipRow}>
          <Icon name="crown" size={20} className={styles.crownIcon} />
          <span className={styles.chipText}>
            <span className={styles.chipLabel}>Уровень</span>
            <span className={styles.chipValue}>—</span>
          </span>
        </div>
      </div>
    </div>
  );
}
