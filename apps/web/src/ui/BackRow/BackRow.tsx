import { mainTabIds, useNavigation, type MainTabId, type Route } from '../../lib/navigation.js';
import { Icon } from '../Icon/Icon.js';
import styles from './BackRow.module.css';

const tabLabels: Record<MainTabId, string> = {
  home: 'Главная',
  training: 'Тренировка',
  statistics: 'Статистика',
  achievements: 'Достижения',
};

export interface BackRowProps {
  /**
   * Explicit parent screen + label, for a drill-down this router's
   * single-overlay-slot state can't otherwise return to correctly
   * (e.g. "Предметы → Математика → назад → Предметы" — closing the
   * overlay would fall through to the underlying tab, skipping
   * Предметы entirely). Omit for the default: close back to whichever
   * tab is underneath.
   */
  to?: Route;
  label?: string;
  /**
   * Steps back within a screen's own local drill-down state instead
   * of touching global navigation at all (e.g. "Задания по номерам →
   * конкретный номер → назад → Задания по номерам", or a selected
   * topic's detail view) — takes priority over `to`/the default when
   * set.
   */
  onBack?: () => void;
}

/**
 * Compact back navigation for desktop overlay screens (approved
 * reference: "Учебный центр"/"Предметы"). By default closes the
 * current overlay via `back()`, returning to whichever tab is
 * underneath it — never hardcoded to Home — labeled with that tab's
 * name. Pass `to`/`label` to return to a specific parent screen
 * instead, or `onBack` for a purely local step-back.
 */
export function BackRow({ to, label, onBack }: BackRowProps) {
  const { tab, back, navigate } = useNavigation();
  const resolvedLabel = label ?? (mainTabIds.includes(tab) ? tabLabels[tab] : tabLabels.home);

  // No "← Главная" row anywhere: the home screen is always one click away
  // in the sidebar / logo, and the row only cluttered the top of pages.
  // A row that would lead home (explicitly, or by closing back onto the
  // home tab) is simply not drawn; steps back to anything else stay.
  const leadsHome = !onBack && (to ? to.screen === 'home' : tab === 'home');
  if (leadsHome) return null;

  function handleClick() {
    if (onBack) {
      onBack();
    } else if (to) {
      navigate(to);
    } else {
      back();
    }
  }

  return (
    <button type="button" className={styles.backRow} onClick={handleClick}>
      <span className={styles.backIcon}>
        <Icon name="back" size={16} />
      </span>
      {resolvedLabel}
    </button>
  );
}
