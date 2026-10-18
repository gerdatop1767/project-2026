import { useEffect, useState } from 'react';
import { useNavigation } from '../../lib/navigation.js';
import { subjects } from '../../data/subjects.js';
import { Button } from '../../ui/Button/Button.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { StatRow } from '../../ui/StatRow/StatRow.js';
import { startRealTask } from '../../lib/startTraining.js';
import { getProgressSummary, getTaskCountsBySubject } from '../../lib/api.js';
import type { ProgressSummary } from '@zybrilka/shared';
import { AnimatedNumber } from '../../ui/AnimatedNumber/AnimatedNumber.js';
import { SlideUp } from '../../ui/motion/motion.js';
import { clsx } from '../../lib/clsx.js';
import { SubjectIcon } from '../../ui/SubjectIcon/SubjectIcon.js';
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
  const [progressFailed, setProgressFailed] = useState(false);
  // Real published-task counts per subject (one request) — replaces the
  // static `subject.taskCount` demo numbers. null until loaded; a
  // subject absent from the response has 0 published tasks.
  const [taskCounts, setTaskCounts] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    let cancelled = false;
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
  }, []);

  return (
    <SlideUp className={styles.stack}>
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
          Начать тренировку <Icon name="arrowRight" size={18} />
        </Button>
      </div>

      <div className={styles.progressCard}>
        <StatRow
          items={[
            {
              id: 'streak',
              value: <span className={styles.statValue}>—</span>,
              label: 'Серия',
            },
            {
              id: 'solved',
              value: (
                <span className={styles.statValue}>
                  <Icon name="success" size={16} className={styles.statIconSuccess} />
                  <AnimatedNumber
                    value={progress ? progress.solvedTotal : progressFailed ? '—' : '···'}
                  />
                </span>
              ),
              label: 'Решено',
            },
            {
              id: 'accuracy',
              value: (
                <span className={styles.statValue}>
                  <Icon name="star" size={16} className={styles.statIconGold} />
                  <AnimatedNumber
                    value={
                      progress
                        ? `${Math.round(progress.accuracyPercent)}%`
                        : progressFailed
                          ? '—'
                          : '···'
                    }
                  />
                </span>
              ),
              label: 'Правильно',
            },
          ]}
        />
      </div>

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
