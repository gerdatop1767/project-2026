import { useState } from 'react';
import { useAuth } from '../../lib/authContext.js';
import { useNavigation } from '../../lib/navigation.js';
import { useTheme } from '../../lib/theme.js';
import { clsx } from '../../lib/clsx.js';
import { Card } from '../../ui/Card/Card.js';
import { Icon } from '../../ui/Icon/Icon.js';
import type { IconName } from '../../ui/Icon/icons.js';
import { SectionHeader } from '../../ui/SectionHeader/SectionHeader.js';
import styles from './Profile.module.css';

/**
 * «Ещё» on the mobile profile — what the old gear menu offered beyond the
 * bottom nav: theory, friends, help, the theme, the admin panel (owner
 * only) and signing out. The admin link is only a convenience: `/admin`
 * itself and every admin API check the owner on the server
 * (docs/ADMIN.md), so hiding or showing it here grants nothing.
 */
export function ProfileMore({ guest = false }: { guest?: boolean }) {
  const { navigate } = useNavigation();
  const { logout, isOwner } = useAuth();
  const [theme, setTheme] = useTheme();
  const [logoutError, setLogoutError] = useState(false);
  const dark = theme === 'dark';

  const row = (icon: IconName, label: string, onClick: () => void) => (
    <button type="button" className={styles.settingsRow} onClick={onClick}>
      <span className={styles.settingsIcon}>
        <Icon name={icon} size={18} />
      </span>
      <span className={styles.settingsLabel}>{label}</span>
      <Icon name="chevronRight" size={16} className={styles.subjectChevron} />
    </button>
  );

  return (
    <div>
      <SectionHeader title="Ещё" />
      <Card>
        {row('reference', 'Теория', () => navigate({ screen: 'theory', section: 'rules' }))}
        {!guest && row('friends', 'Друзья', () => navigate({ screen: 'friends' }))}
        {row('faq', 'Помощь', () => navigate({ screen: 'help' }))}
        <button
          type="button"
          className={styles.settingsRow}
          aria-pressed={dark}
          onClick={() => setTheme(dark ? 'light' : 'dark')}
        >
          <span className={styles.settingsIcon}>
            <Icon name="theme" size={18} />
          </span>
          <span className={styles.settingsLabel}>Тёмная тема</span>
          <span className={clsx(styles.toggle, dark && styles.toggleOn)} aria-hidden="true">
            <span className={styles.toggleKnob} />
          </span>
        </button>
        {isOwner && (
          <a className={clsx(styles.settingsRow, styles.adminRow)} href="/admin">
            <span className={styles.settingsIcon} style={{ color: 'var(--color-gold)' }}>
              <Icon name="shield" size={18} />
            </span>
            <span className={styles.settingsLabel}>Админ-панель</span>
            <Icon name="chevronRight" size={16} className={styles.subjectChevron} />
          </a>
        )}
        {guest ? (
          row('profile', 'Войти или зарегистрироваться', () => navigate({ screen: 'login' }))
        ) : (
          <button
            type="button"
            className={styles.settingsRow}
            onClick={() => {
              setLogoutError(false);
              logout().catch(() => setLogoutError(true));
            }}
          >
            <span className={styles.settingsIcon}>
              <Icon name="logout" size={18} />
            </span>
            <span className={styles.settingsLabel}>Выйти из аккаунта</span>
          </button>
        )}
        {logoutError && (
          <p role="alert" className="text-body-sm">
            Не удалось выйти из аккаунта. Проверьте соединение и попробуйте снова.
          </p>
        )}
      </Card>
    </div>
  );
}
