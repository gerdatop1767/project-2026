import { useNavigation } from '../../lib/navigation.js';
import { subjects } from '../../data/subjects.js';
import { useTaskCountsBySubject } from '../../lib/useTaskCounts.js';
import { Card } from '../../ui/Card/Card.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { SubjectIcon } from '../../ui/SubjectIcon/SubjectIcon.js';
import {
  FeatureIcon,
  featureIconGlow,
  type FeatureIconName,
} from '../../ui/FeatureIcon/FeatureIcon.js';
import styles from './SubjectCatalogDesktop.module.css';

/**
 * Desktop "Предметы" (approved reference screenshot): a hero banner
 * over the existing mascot illustration, three headline stats, then a
 * card grid — one per EGE subject — each opening that subject's
 * catalog overlay.
 */
export function SubjectCatalogDesktop() {
  const { navigate } = useNavigation();
  // Real published-task counts (one request) — replaces the static
  // `subject.taskCount` demo field, here and in the "N заданий"
  // headline stat below. null until loaded; a subject absent from the
  // response has 0 published tasks.
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
      value: totalTasks !== null ? totalTasks.toLocaleString('ru-RU') : '···',
    },
    {
      icon: 'statistics',
      label: 'статистика',
      value: 'Полная',
    },
  ] as const satisfies readonly { icon: FeatureIconName; label: string; value: string }[];

  return (
    <div>
      <div className={styles.hero}>
        <img
          src="/branding/v2/hero-mascot-desktop.webp"
          alt=""
          className={styles.heroImg}
          aria-hidden="true"
        />
        <div className={styles.heroOverlay} />
        <div className={styles.heroContent}>
          <h1 className="text-h1">Предметы</h1>
          <p className="text-body-sm text-secondary">Выбери предмет и начни готовиться к ЕГЭ</p>
        </div>
      </div>

      <div className={styles.statsRow}>
        {stats.map((stat) => (
          <Card
            key={stat.label}
            className={styles.statCard}
            data-icon-host
            style={{ ['--card-glow' as string]: featureIconGlow(stat.icon) }}
          >
            <span className={styles.statIcon}>
              <FeatureIcon name={stat.icon} />
            </span>
            <span>
              <strong className={styles.statValue}>{stat.value}</strong>
              <br />
              <span className="text-body-sm text-secondary">{stat.label}</span>
            </span>
          </Card>
        ))}
      </div>

      <div className={styles.grid}>
        {subjects.map((subject, index) => (
          <button
            key={subject.id}
            type="button"
            className={styles.subjectCard}
            style={{ ['--subject-accent' as string]: subject.color }}
            data-subject-interactive
            onClick={() =>
              navigate({ screen: 'subject', subjectId: subject.id, from: 'subjectCatalog' })
            }
          >
            <div className={styles.subjectThumb}>
              <span className={styles.subjectImg}>
                <SubjectIcon subjectId={subject.id} reveal={index} parallax />
              </span>
            </div>
            <div className={styles.subjectFooter}>
              <span>
                <p className="text-body" style={{ fontWeight: 700 }}>
                  {subject.shortName}
                </p>
                <p className="text-body-sm text-secondary">
                  {taskCounts
                    ? `${(taskCounts[subject.id] ?? 0).toLocaleString('ru-RU')} заданий`
                    : '···'}
                </p>
              </span>
              <span className={styles.subjectArrow} style={{ background: subject.color }}>
                <Icon name="arrowRight" size={18} />
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
