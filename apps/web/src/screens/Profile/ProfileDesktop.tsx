import { useEffect, useState } from 'react';
import type { LearningProfileResponse } from '@zybrilka/shared';
import { useNavigation, getRouteLabel, type Route } from '../../lib/navigation.js';
import { useAuth } from '../../lib/authContext.js';
import { getLearningProfile } from '../../lib/api.js';
import { selfReportedScoreLabel, targetScoreLabel } from '../../lib/learningProfileLabels.js';
import { subjects as staticSubjects } from '../../data/subjects.js';
import { BackRow } from '../../ui/BackRow/BackRow.js';
import { Card } from '../../ui/Card/Card.js';
import { Icon } from '../../ui/Icon/Icon.js';
import type { IconName } from '../../ui/Icon/icons.js';
import { FadeIn } from '../../ui/motion/motion.js';
import { ProfileIdentityCard } from './account/ProfileIdentityCard.js';
import { useIdentities } from './account/useIdentities.js';
import { SignInMethodsSection } from './account/SignInMethodsSection.js';
import { GuestProfileCard } from '../../ui/AccountGate/GuestProfileCard.js';
import styles from './ProfileDesktop.module.css';

function subjectShortName(subjectId: string): string {
  return staticSubjects.find((s) => s.id === subjectId)?.shortName ?? subjectId;
}

interface ProfileRow {
  id: string;
  icon: IconName;
  label: string;
  value: string;
  onClick?: () => void;
}

/**
 * Desktop "Мой профиль" (approved reference: 03_PROFILE.jpeg) —
 * personal data + account/study settings, deliberately NOT a second
 * copy of Статистика/Достижения/Рейтинг/Мои ошибки: no progress ring,
 * no achievement list, no heatmap, no leaderboard position. Those
 * already have their own screens; duplicating them here would just
 * drift out of sync with them.
 */
export interface ProfileDesktopProps {
  from?: Route;
}

export function ProfileDesktop(props: ProfileDesktopProps) {
  const { user } = useAuth();
  if (user === null) {
    return (
      <FadeIn>
        <h1 className="text-h1" style={{ marginBottom: 'var(--space-5)' }}>
          Профиль
        </h1>
        <GuestProfileCard />
      </FadeIn>
    );
  }
  return <AccountProfileDesktop {...props} />;
}

function AccountProfileDesktop({ from }: ProfileDesktopProps) {
  const { navigate } = useNavigation();
  const { logout } = useAuth();
  const identities = useIdentities();
  const [logoutError, setLogoutError] = useState(false);
  const [profile, setProfile] = useState<LearningProfileResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLearningProfile()
      .then((data) => {
        if (!cancelled) setProfile(data);
      })
      .catch(() => {
        // No profile yet (or offline) — rows below fall back to the neutral prompts.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasSubjects = (profile?.subjects.length ?? 0) > 0;

  const studySettings: readonly ProfileRow[] = [
    {
      id: 'subjects',
      icon: 'topic',
      label: 'Предметы ЕГЭ',
      value: hasSubjects
        ? profile!.subjects.map((s) => subjectShortName(s.subjectId)).join(', ')
        : 'Выбери предметы для подготовки',
      onClick: () => navigate({ screen: 'onboarding' }),
    },
    {
      id: 'level',
      icon: 'shield',
      label: 'Уровень подготовки',
      value: hasSubjects
        ? profile!.subjects
            .map(
              (s) =>
                `${subjectShortName(s.subjectId)}: ${selfReportedScoreLabel(s.selfReportedScore)}`,
            )
            .join(', ')
        : 'Укажи текущий уровень',
      onClick: () => navigate({ screen: 'onboarding' }),
    },
    {
      id: 'goals',
      icon: 'target',
      label: 'Цели',
      value: hasSubjects
        ? profile!.subjects
            .map((s) => `${subjectShortName(s.subjectId)}: ${targetScoreLabel(s.targetScore)}`)
            .join(', ')
        : 'Настрой свои цели по каждому предмету',
      onClick: () => navigate({ screen: 'onboarding' }),
    },
  ];

  const accountActions: readonly ProfileRow[] = [
    {
      id: 'notifications',
      icon: 'notifications',
      label: 'Уведомления',
      value: 'Напоминания, серия, обновления',
      onClick: () => navigate({ screen: 'notifications' }),
    },
    { id: 'language', icon: 'language', label: 'Язык', value: 'Русский' },
    {
      id: 'privacy',
      icon: 'shield',
      label: 'Конфиденциальность',
      value: 'Данные и безопасность',
      onClick: () => navigate({ screen: 'privacy' }),
    },
  ];

  const helpActions: readonly ProfileRow[] = [
    {
      id: 'help',
      icon: 'faq',
      label: 'Помощь',
      value: 'Ответы на вопросы',
      onClick: () => navigate({ screen: 'help' }),
    },
  ];

  return (
    <FadeIn>
      <BackRow to={from} label={from && getRouteLabel(from)} />

      <div className={styles.headRow}>
        <h1 className="text-h1">Мой профиль</h1>
      </div>
      <p className="text-body-sm text-secondary">Твои данные и настройки аккаунта</p>

      <div className={styles.identitySlot}>
        <ProfileIdentityCard identities={identities} />
      </div>

      <div className={styles.columns}>
        <div className={styles.column}>
          <Card>
            <SignInMethodsSection identities={identities} />
          </Card>
          <Card>
            <p className="text-h3">Учебные настройки</p>
            <RowList rows={studySettings} />
          </Card>
        </div>

        <div className={styles.column}>
          <Card>
            <p className="text-h3">Настройки аккаунта</p>
            <div className={styles.rowList}>
              {accountActions.map((row) =>
                row.id === 'language' ? (
                  <button key={row.id} type="button" className={styles.row} onClick={row.onClick}>
                    <Icon name={row.icon} size={18} />
                    <span className={styles.rowBody}>
                      <p className="text-body-sm" style={{ fontWeight: 700 }}>
                        {row.label}
                      </p>
                    </span>
                    <span className="text-body-sm text-secondary">{row.value}</span>
                    <Icon name="chevronRight" size={16} className={styles.rowArrow} />
                  </button>
                ) : (
                  <ProfileRowButton key={row.id} row={row} />
                ),
              )}
            </div>
          </Card>

          <Card>
            <p className="text-h3">Действия</p>
            <RowList rows={helpActions} />
          </Card>

          <button
            type="button"
            className={styles.logoutButton}
            onClick={() => {
              setLogoutError(false);
              logout().catch(() => setLogoutError(true));
            }}
          >
            <Icon name="logout" size={18} /> Выйти из аккаунта
          </button>
          {logoutError && (
            <p role="alert" className="text-body-sm">
              Не удалось выйти из аккаунта. Проверьте соединение и попробуйте снова.
            </p>
          )}
        </div>
      </div>
    </FadeIn>
  );
}

function RowList({ rows }: { rows: readonly ProfileRow[] }) {
  return (
    <div className={styles.rowList}>
      {rows.map((row) => (
        <ProfileRowButton key={row.id} row={row} />
      ))}
    </div>
  );
}

function ProfileRowButton({ row }: { row: ProfileRow }) {
  return (
    <button type="button" className={styles.row} onClick={row.onClick}>
      <Icon name={row.icon} size={18} />
      <span className={styles.rowBody}>
        <p className="text-body-sm" style={{ fontWeight: 700 }}>
          {row.label}
        </p>
        <p className="text-body-sm text-secondary">{row.value}</p>
      </span>
      <Icon name="chevronRight" size={16} className={styles.rowArrow} />
    </button>
  );
}
