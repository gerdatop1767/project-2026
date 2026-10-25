import { useEffect, useState } from 'react';
import { getLearningProfile, getProgressSummary } from '../../lib/api.js';
import { useAuth } from '../../lib/authContext.js';
import { GuestProfileCard } from '../../ui/AccountGate/GuestProfileCard.js';
import type { LearningProfileResponse, ProgressSummary } from '@zybrilka/shared';
import { selfReportedScoreLabel, targetScoreLabel } from '../../lib/learningProfileLabels.js';
import { subjects as staticSubjects } from '../../data/subjects.js';
import { Card } from '../../ui/Card/Card.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { SectionHeader } from '../../ui/SectionHeader/SectionHeader.js';
import { StatTile } from '../../ui/Statistics/StatTile.js';
import { SubjectTile } from '../../ui/SubjectTile/SubjectTile.js';
import { useNavigation } from '../../lib/navigation.js';
import { SlideUp } from '../../ui/motion/motion.js';
import { ProfileIdentityCard } from './account/ProfileIdentityCard.js';
import { useIdentities } from './account/useIdentities.js';
import { SignInMethodsSection } from './account/SignInMethodsSection.js';
import styles from './Profile.module.css';

function findSubject(subjectId: string) {
  return staticSubjects.find((s) => s.id === subjectId);
}

/**
 * Mobile Профиль, rebuilt against the approved reference
 * (profile_mobile_target.jpeg) as closely as the real data allows. No
 * auth/account backend exists yet — no real name, username, avatar
 * photo, class/grade, level or XP — so the identity card uses the same
 * honest "не задано" convention ProfileDesktop already established,
 * instead of inventing a person. Достижения has no backend either
 * (see AchievementsMobile), so that section stays a neutral prompt
 * rather than fabricated badge progress. Everything else (solved/
 * accuracy, real per-subject accuracy, real subjects/targets) comes
 * straight from GET /progress/summary and GET /me/learning/profile.
 */
export function Profile() {
  const { user } = useAuth();
  return user === null ? <GuestProfile /> : <AccountProfile />;
}

/** Guest mode: the header and its menu stay; no personal data is loaded. */
function GuestProfile() {
  const { navigate, overlay } = useNavigation();
  return (
    <SlideUp className={styles.stack}>
      <div className={styles.headerRow}>
        <h1 className="text-h1">Профиль</h1>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Меню"
          onClick={() =>
            navigate({ screen: 'menu', from: overlay?.screen === 'profile' ? overlay : undefined })
          }
        >
          <Icon name="settings" size={20} />
        </button>
      </div>
      <GuestProfileCard />
    </SlideUp>
  );
}

function AccountProfile() {
  const { navigate, overlay } = useNavigation();
  const identities = useIdentities();
  const [progress, setProgress] = useState<ProgressSummary | null>(null);
  const [learningProfile, setLearningProfile] = useState<LearningProfileResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getProgressSummary()
      .then((data) => {
        if (!cancelled) setProgress(data);
      })
      .catch(() => {
        // No backend data yet (or the request failed) — stats stay at
        // their neutral zero state below.
      });
    void getLearningProfile()
      .then((data) => {
        if (!cancelled) setLearningProfile(data);
      })
      .catch(() => {
        // No profile yet (or offline) — the section below falls back to a prompt.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasSubjects = (learningProfile?.subjects.length ?? 0) > 0;

  return (
    <SlideUp className={styles.stack}>
      <div className={styles.headerRow}>
        <h1 className="text-h1">Профиль</h1>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Меню"
          onClick={() =>
            navigate({ screen: 'menu', from: overlay?.screen === 'profile' ? overlay : undefined })
          }
        >
          <Icon name="settings" size={20} />
        </button>
      </div>

      <ProfileIdentityCard identities={identities} />

      <div className={styles.statsGrid}>
        <StatTile
          className={styles.statTile}
          icon="target"
          iconColor="var(--color-accent-primary)"
          label="Решено"
          value={progress ? progress.solvedTotal : '···'}
        />
        <StatTile
          className={styles.statTile}
          icon="progress"
          iconColor="var(--color-accent-secondary)"
          label="Точность"
          value={progress ? Math.round(progress.accuracyPercent) : '···'}
          suffix={progress ? '%' : undefined}
        />
      </div>

      <Card>
        <SignInMethodsSection identities={identities} />
      </Card>

      <div>
        <SectionHeader
          title="Предметы ЕГЭ"
          action={{ label: 'Изменить', onClick: () => navigate({ screen: 'onboarding' }) }}
        />
        {hasSubjects ? (
          <div className={styles.subjectsList}>
            {learningProfile!.subjects.map((s) => {
              const subject = findSubject(s.subjectId);
              const stats = progress?.bySubject.find((b) => b.subjectId === s.subjectId);
              const hasAccuracy = (stats?.solved ?? 0) > 0;
              return (
                <button
                  key={s.subjectId}
                  type="button"
                  className={styles.subjectCard}
                  data-subject-interactive
                  onClick={() => navigate({ screen: 'subject', subjectId: s.subjectId })}
                >
                  {subject && <SubjectTile glyph={subject.glyph} size={40} />}
                  <span className={styles.subjectText}>
                    <span className="text-body">{subject?.shortName ?? s.subjectId}</span>
                    <span className="text-body-sm text-secondary">
                      Сейчас: {selfReportedScoreLabel(s.selfReportedScore)} · Цель:{' '}
                      {targetScoreLabel(s.targetScore)}
                    </span>
                  </span>
                  <span className={styles.subjectPercent}>
                    {hasAccuracy ? (
                      <>
                        <span className="text-body-sm" style={{ fontWeight: 700 }}>
                          {Math.round(stats!.accuracyPercent)}%
                        </span>
                        <span className={styles.subjectBar}>
                          <span
                            className={styles.subjectBarFill}
                            style={{
                              width: `${Math.round(stats!.accuracyPercent)}%`,
                              background: subject?.color,
                            }}
                          />
                        </span>
                      </>
                    ) : (
                      <span className="text-body-sm text-secondary">—</span>
                    )}
                  </span>
                  <Icon name="chevronRight" size={18} className={styles.subjectChevron} />
                </button>
              );
            })}
          </div>
        ) : (
          <Card>
            <p className="text-body-sm text-secondary">Предметы и цели ещё не выбраны.</p>
          </Card>
        )}
        <button
          type="button"
          className={styles.settingsRow}
          onClick={() => navigate({ screen: 'onboarding' })}
        >
          <span className={styles.settingsIcon}>
            <Icon name="topic" size={18} />
          </span>
          <span className={styles.settingsLabel}>
            {hasSubjects ? 'Изменить предметы и цели' : 'Выбрать предметы'}
          </span>
          <Icon name="chevronRight" size={16} className={styles.subjectChevron} />
        </button>
      </div>

      <div>
        <SectionHeader
          title="Достижения"
          action={{ label: 'Все достижения', onClick: () => navigate({ screen: 'achievements' }) }}
        />
        <Card>
          <p className="text-body-sm text-secondary">Достижения скоро появятся здесь.</p>
        </Card>
      </div>

      <div>
        <SectionHeader title="Настройки" />
        <Card>
          <button
            type="button"
            className={styles.settingsRow}
            onClick={() => navigate({ screen: 'onboarding' })}
          >
            <span className={styles.settingsIcon}>
              <Icon name="smart" size={18} />
            </span>
            <span className={styles.settingsLabel}>Пройти диагностику заново</span>
          </button>
          <button
            type="button"
            className={styles.settingsRow}
            onClick={() => navigate({ screen: 'notifications' })}
          >
            <span className={styles.settingsIcon}>
              <Icon name="notifications" size={18} />
            </span>
            <span className={styles.settingsLabel}>
              Уведомления
              <span className={styles.settingsSublabel}>Ежедневные напоминания в Telegram</span>
            </span>
            <Icon name="chevronRight" size={16} className={styles.subjectChevron} />
          </button>
          <div className={styles.settingsRow}>
            <span className={styles.settingsIcon}>
              <Icon name="language" size={18} />
            </span>
            <span className={styles.settingsLabel}>Язык</span>
            <span className="text-body-sm text-secondary">Русский</span>
          </div>
          <button
            type="button"
            className={styles.settingsRow}
            onClick={() => navigate({ screen: 'privacy' })}
          >
            <span className={styles.settingsIcon}>
              <Icon name="shield" size={18} />
            </span>
            <span className={styles.settingsLabel}>
              Конфиденциальность
              <span className={styles.settingsSublabel}>Данные и безопасность</span>
            </span>
            <Icon name="chevronRight" size={16} className={styles.subjectChevron} />
          </button>
          <div className={styles.settingsInfo}>
            <Icon name="info" size={18} />
            <span className="text-body-sm">
              Анимации следуют системной настройке «Уменьшить движение»
            </span>
          </div>
        </Card>
      </div>
    </SlideUp>
  );
}
