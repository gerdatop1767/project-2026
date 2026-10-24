import { useEffect, useState } from 'react';
import { useNavigation } from '../../lib/navigation.js';
import { useAccountGate } from '../../lib/accountGate.js';
import { subjects } from '../../data/subjects.js';
import { Button } from '../../ui/Button/Button.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { StatRow } from '../../ui/StatRow/StatRow.js';
import { startRealTask } from '../../lib/startTraining.js';
import { getProgressSummary, getTaskCountsBySubject } from '../../lib/api.js';
import { useStreakContext } from '../../lib/streakContext.js';
import { PlaceIcon } from '../../ui/RatingPlace/PlaceIcon.js';
import type { ProgressSummary } from '@zybrilka/shared';
import { SlideUp } from '../../ui/motion/motion.js';
import { clsx } from '../../lib/clsx.js';
import { SubjectIcon } from '../../ui/SubjectIcon/SubjectIcon.js';
import { SignInMethodWarning } from '../../ui/SignInMethodWarning/SignInMethodWarning.js';
import styles from './HomeMobile.module.css';

/**
 * Mobile Home (S1 Block 6, approved design — mobile/01_home.png): the
 * logged-in dashboard. Structurally its own composition, not a scaled
 * desktop layout — desktop's `/` is the Учебный центр (see AppDesktop.tsx).
 *
 * "Решено"/"Правильно" are real (`GET /progress/summary`, Block D).
 * There's no backend streak/level/XP system at all yet, so "Серия"
 * shows a neutral "—" rather than a fabricated number or badge — see
 * docs/PRODUCTION_DATA_MODEL.md before adding one instead of guessing.
 */
export function HomeMobile() {
  const { navigate } = useNavigation();
  const popularSubjects = subjects.slice(0, 6);
  const [progress, setProgress] = useState<ProgressSummary | null>(null);
  // Until the summary arrives the stats read "···" (a real 0 would be a
  // claim), and "—" if it could not be loaded at all.
  const [progressFailedState, setProgressFailed] = useState(false);
  const { isGuest } = useAccountGate();
  const progressFailed = progressFailedState || isGuest;
  // Real published-task counts per subject (one request) — replaces the
  // static `subject.taskCount` demo numbers. null until loaded; a
  // subject absent from the response has 0 published tasks.
  const [taskCounts, setTaskCounts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    let cancelled = false;
    // A guest has no saved progress: the stats honestly read "—".
    if (!isGuest)
      void getProgressSummary()
        .then((data) => {
          if (!cancelled) setProgress(data);
        })
        .catch(() => {
          if (!cancelled) setProgressFailed(true);
        });
    void getTaskCountsBySubject()
      .then((res) => {
        if (cancelled) return;
        const map: Record<string, number> = {};
        for (const item of res.items) map[item.subjectId] = item.count;
        setTaskCounts(map);
      })
      .catch(() => {
        // Stays null — subject cards show a neutral placeholder below.
      });
    return () => {
      cancelled = true;
    };
  }, [isGuest]);

  return (
    <SlideUp className={styles.stack}>
      <SignInMethodWarning />
      <div className={styles.hero}>
        <div className={styles.heroTiles} aria-hidden="true">
          <span className={styles.heroTilePi}>
            <SubjectIcon subjectId={subjects[0]!.id} />
          </span>
          <span className={styles.heroTileAa}>
            <SubjectIcon subjectId={subjects[1]!.id} />
          </span>
          <span className={styles.heroTileM}>
            <SubjectIcon subjectId={subjects[4]!.id} />
          </span>
        </div>
        <p className={clsx('text-h2', styles.heroHeading)}>
          Готов к новой <span className={styles.heroAccent}>тренировке?</span>
        </p>
        <p className={clsx('text-body-sm text-secondary', styles.heroSubtitle)}>
          Решай задания, развивайся и достигай своих целей!
        </p>
        <Button
          variant="primary"
          fullWidth
          className={styles.heroCta}
          onClick={() => navigate({ screen: 'subjectCatalog' })}
        >
          <span className={styles.heroCtaLabel}>
            Начать тренировку <Icon name="arrowRight" size={18} className={styles.heroCtaArrow} />
          </span>
        </Button>
      </div>

      <div className={styles.progressCard}>
        <StatRow
          items={[
            {
              // The weekly rating place sits in the cell that only ever
              // showed «—» (the streak lives in the header); «Решено» and
              // «Правильно» keep their places.
              id: 'rating',
              value: <RatingPlace isGuest={isGuest} />,
              label: 'Место',
            },
            {
              id: 'solved',
              value: (
                <span className={styles.statValue}>
                  <span
                    className={clsx(styles.statIcon, styles.statIconSuccess)}
                    data-ready={progress ? '' : undefined}
                    aria-hidden="true"
                  >
                    <Icon name="checklist" size={15} />
                  </span>
                  {progress ? progress.solvedTotal : progressFailed ? '—' : '···'}
                </span>
              ),
              label: 'Решено',
            },
            {
              id: 'accuracy',
              value: (
                <span className={styles.statValue}>
                  <span
                    className={clsx(styles.statIcon, styles.statIconGold)}
                    data-ready={progress ? '' : undefined}
                    aria-hidden="true"
                  >
                    <Icon name="target" size={15} />
                  </span>
                  {progress
                    ? `${Math.round(progress.accuracyPercent)}%`
                    : progressFailed
                      ? '—'
                      : '···'}
                </span>
              ),
              label: 'Правильно',
            },
          ]}
        />
      </div>

      {isGuest && (
        <button
          type="button"
          className={styles.guestHint}
          onClick={() => navigate({ screen: 'login' })}
        >
          <Icon name="profile" size={18} className={styles.guestHintIcon} />
          <span className={styles.guestHintText}>
            Ты занимаешься как гость — прогресс не сохраняется.{' '}
            <span className={styles.guestHintLink}>Войти</span>
          </span>
        </button>
      )}

      <div>
        <div className={styles.sectionHeader}>
          <p className="text-h3">Популярные предметы</p>
          <button
            type="button"
            className={styles.sectionLink}
            onClick={() => navigate({ screen: 'subjectCatalog' })}
          >
            Все предметы <Icon name="chevronRight" size={16} />
          </button>
        </div>
        <div className={styles.subjectGrid}>
          {popularSubjects.map((subject, index) => (
            <button
              key={subject.id}
              type="button"
              className={styles.subjectCard}
              data-subject-interactive
              onClick={() => navigate({ screen: 'subject', subjectId: subject.id })}
            >
              <span className={styles.subjectCardInner}>
                <span className={styles.subjectThumb}>
                  <SubjectIcon subjectId={subject.id} reveal={index} />
                </span>
                <span className={styles.subjectCardText}>
                  <span className={`text-card-title ${styles.subjectName}`}>
                    {subject.shortName}
                  </span>
                  <span className={styles.subjectCardCount}>
                    {taskCounts
                      ? `${(taskCounts[subject.id] ?? 0).toLocaleString('ru-RU')} заданий`
                      : '···'}
                  </span>
                </span>
                <Icon name="chevronRight" size={16} className={styles.subjectCardChevron} />
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className={styles.sectionHeader}>
          <p className="text-h3">Продолжить</p>
          <button
            type="button"
            className={styles.sectionLink}
            onClick={() => navigate({ screen: 'subjectCatalog' })}
          >
            Все тренировки <Icon name="chevronRight" size={16} />
          </button>
        </div>
        <button
          type="button"
          className={styles.continueCard}
          data-subject-interactive
          onClick={() => startRealTask(navigate, { subject: 'math' })}
        >
          <span className={styles.continueThumb}>
            <SubjectIcon subjectId={subjects[0]!.id} />
          </span>
          <span className={styles.continueCardText}>
            <span className="text-body" style={{ fontWeight: 600 }}>
              Математика
            </span>
            <span className="text-body-sm text-secondary">Тренировка · случайные задания</span>
          </span>
          <span className={styles.continueCardArrow}>
            <Icon name="arrowRight" size={18} />
          </span>
        </button>
      </div>
    </SlideUp>
  );
}

/** «#6» in the weekly rating (all subjects), opening the rating page; «—»
 * for a guest, before the first points of the week, or if loading failed. */
function RatingPlace({ isGuest }: { isGuest: boolean }) {
  const { navigate } = useNavigation();
  const { rating, ratingFailed } = useStreakContext();
  const icon = <PlaceIcon rank={rating?.me.rank} size={26} />;
  if (isGuest) {
    return <span className={styles.statValue}>{icon}—</span>;
  }
  const rank = rating?.me.rank ?? null;
  const text = rating ? (rank === null ? '—' : `#${rank}`) : ratingFailed ? '—' : '···';
  return (
    <button
      type="button"
      className={clsx(styles.statValue, styles.statButton)}
      onClick={() => navigate({ screen: 'rating' })}
      aria-label={
        rating === null
          ? 'Рейтинг. Открыть'
          : rank === null
            ? 'На этой неделе ещё нет места в рейтинге. Открыть рейтинг'
            : `Место в рейтинге за неделю: ${rank} из ${rating.participants}. Открыть рейтинг`
      }
    >
      {icon}
      {text}
    </button>
  );
}
