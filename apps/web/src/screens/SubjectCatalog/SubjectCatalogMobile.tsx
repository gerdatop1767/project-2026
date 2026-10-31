import { useNavigation } from '../../lib/navigation.js';
import { subjects } from '../../data/subjects.js';
import { useTaskCountsBySubject } from '../../lib/useTaskCounts.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { FadeIn, SlideUp, staggerDelay } from '../../ui/motion/motion.js';
import { SubjectIcon } from '../../ui/SubjectIcon/SubjectIcon.js';
import {
  FeatureIcon,
  featureIconGlow,
  type FeatureIconName,
} from '../../ui/FeatureIcon/FeatureIcon.js';
import styles from './SubjectCatalogMobile.module.css';

/**
 * Mobile "Предметы" — the same 9 subjects, task counts and summary
 * cards as SubjectCatalogDesktop, restacked into a single scrollable
 * column: no approved mobile screenshot exists for this screen, so
 * it stays a functional, same-visual-language adaptation of the
 * desktop page rather than an invented composition.
 */
export function SubjectCatalogMobile() {
  const { navigate, back } = useNavigation();
  // Real published-task counts (one request) — replaces the static
  // `subject.taskCount` demo field, here and in the "N заданий"
  // headline stat below.
  const taskCounts = useTaskCountsBySubject();
  const totalTasks = taskCounts
    ? Object.values(taskCounts).reduce((sum, count) => sum + count, 0)
    : null;

  const stats = [
    {
      icon: 'subjects',
      label: 'предметов',
      value: `${subjects.length}`,
    },
    {
      icon: 'tasks',
      label: 'заданий',
      value: totalTasks !== null ? `${totalTasks.toLocaleString('ru-RU')}+` : '···',
    },
    {
      icon: 'statistics',
      label: 'статистика',
      value: 'Полная',
    },
  ] as const satisfies readonly { icon: FeatureIconName; label: string; value: string }[];

  return (
    <SlideUp className={styles.stack}>
      <div className={styles.header}>
        <button type="button" className={styles.backButton} aria-label="Назад" onClick={back}>
          <Icon name="back" size={20} />
        </button>
        <p className="text-body" style={{ fontWeight: 700 }}>
          Предметы
        </p>
      </div>

      <p className="text-body-sm text-secondary">Выбери предмет и начни готовиться к ЕГЭ</p>

      <div className={styles.statsRow}>
        {stats.map((stat, index) => (
          <FadeIn
            key={stat.label}
            delayMs={staggerDelay(index)}
            className={styles.statCard}
            style={{ ['--card-glow' as string]: featureIconGlow(stat.icon) }}
          >
            <span className={styles.statIcon}>
              <FeatureIcon name={stat.icon} />
            </span>
            <span className="text-body" style={{ fontWeight: 700 }}>
              {stat.value}
            </span>
            <span className="text-label text-secondary">{stat.label}</span>
          </FadeIn>
        ))}
      </div>

      <div className={styles.list}>
        {subjects.map((subject, index) => (
          <FadeIn key={subject.id} delayMs={staggerDelay(index)}>
            <button
              type="button"
              className={styles.subjectRow}
              data-subject-interactive
              onClick={() =>
                navigate({ screen: 'subject', subjectId: subject.id, from: 'subjectCatalog' })
              }
            >
              <span className={styles.subjectThumb}>
                <SubjectIcon subjectId={subject.id} reveal={index} />
              </span>
              <span className={styles.subjectBody}>
                <span className="text-body" style={{ fontWeight: 700 }}>
                  {subject.shortName}
                </span>
                <span className="text-body-sm text-secondary">
                  {taskCounts
                    ? `${(taskCounts[subject.id] ?? 0).toLocaleString('ru-RU')} заданий`
                    : '···'}
                </span>
              </span>
              <span className={styles.subjectArrow} style={{ background: subject.color }}>
                <Icon name="arrowRight" size={16} />
              </span>
            </button>
          </FadeIn>
        ))}
      </div>
    </SlideUp>
  );
}
