import { useNavigation } from '../../lib/navigation.js';
import { clsx } from '../../lib/clsx.js';
import { subjects } from '../../data/subjects.js';
import { Card } from '../../ui/Card/Card.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { SubjectIcon } from '../../ui/SubjectIcon/SubjectIcon.js';
import {
  FeatureIcon,
  featureIconGlow,
  type FeatureIconName,
} from '../../ui/FeatureIcon/FeatureIcon.js';
import { staggerClassName } from '../../ui/motion/motion.js';
import { SignInMethodWarning } from '../../ui/SignInMethodWarning/SignInMethodWarning.js';
import styles from './LearningCenterDesktop.module.css';

interface LearningSection {
  icon: FeatureIconName;
  title: string;
  description: string;
}

const sections: readonly LearningSection[] = [
  {
    icon: 'theory',
    title: 'Теория',
    description: 'Краткие и понятные конспекты по всем темам ЕГЭ',
  },
  {
    icon: 'practice',
    title: 'Практика',
    description: 'Разборы заданий и примеры решений',
  },
  {
    icon: 'strategy',
    title: 'Стратегии',
    description: 'Советы, лайфхаки и эффективные методики',
  },
  {
    icon: 'materials',
    title: 'Полезные материалы',
    description: 'Сборники, файлы и дополнительные ресурсы',
  },
];

interface Recommendation {
  icon: FeatureIconName;
  badge: string;
  title: string;
  description: string;
}

const recommendations: readonly Recommendation[] = [
  {
    icon: 'topics',
    badge: 'Популярное',
    title: 'Основные темы ЕГЭ',
    description: 'Самые важные темы, которые встречаются в экзамене',
  },
  {
    icon: 'typical',
    badge: 'Новое',
    title: 'Типовые задания',
    description: 'Разбор сложных заданий с примерами решений',
  },
  {
    icon: 'tips',
    badge: 'Советы',
    title: 'Как эффективно готовиться',
    description: 'Методики, планирование и полезные лайфхаки',
  },
];

/**
 * Desktop "Учебный центр" (approved reference screenshot): a hub of
 * theory/practice/strategy/resource sections, a subject picker and
 * personalized recommendations — not a dashboard, a materials index.
 */
export function LearningCenterDesktop() {
  const { navigate } = useNavigation();

  return (
    <div>
      <div className={styles.headRow}>
        <div>
          <h1 className="text-h1">Учебный центр</h1>
          <p className="text-body-sm text-secondary">
            Всё, что нужно для эффективной подготовки к ЕГЭ в одном месте
          </p>
        </div>
        <div className={styles.search}>
          <Icon name="search" size={18} className={styles.searchIcon} />
          <input
            type="search"
            placeholder="Поиск материалов..."
            className={styles.searchInput}
            aria-label="Поиск материалов"
          />
        </div>
      </div>

      <SignInMethodWarning className={styles.signInWarning} />

      <div className={clsx(styles.sectionsGrid, staggerClassName)}>
        {sections.map((section) => (
          <Card
            key={section.title}
            className={styles.sectionCard}
            data-icon-host
            style={{ ['--section-accent' as string]: featureIconGlow(section.icon) }}
          >
            <span className={styles.sectionImg}>
              <FeatureIcon name={section.icon} />
            </span>
            <div className={styles.sectionBody}>
              <p className="text-body" style={{ fontWeight: 700 }}>
                {section.title}
              </p>
              <p className="text-body-sm text-secondary">{section.description}</p>
            </div>
            <button
              type="button"
              className={styles.sectionArrow}
              aria-label={section.title}
              onClick={() => navigate({ screen: 'subjectCatalog' })}
            >
              <Icon name="arrowRight" size={18} />
            </button>
          </Card>
        ))}
      </div>

      <div className={styles.subjectsHead}>
        <p className="text-h3">Выбери предмет</p>
        <p className="text-body-sm text-secondary">Перейди к материалам нужного предмета</p>
      </div>
      <div className={clsx(styles.subjectsGrid, staggerClassName)}>
        {subjects.map((subject, index) => (
          <button
            key={subject.id}
            type="button"
            className={styles.subjectRow}
            data-subject-interactive
            onClick={() =>
              navigate({ screen: 'subject', subjectId: subject.id, from: 'learningCenter' })
            }
          >
            <span className={styles.subjectIcon}>
              <SubjectIcon subjectId={subject.id} reveal={index} />
            </span>
            <span className={styles.subjectName}>{subject.shortName}</span>
            <Icon name="arrowRight" size={16} className={styles.subjectArrow} />
          </button>
        ))}
      </div>

      <Card className={styles.recommendCard}>
        <p className="text-h3">Рекомендации для тебя</p>
        <p className="text-body-sm text-secondary">На основе твоей активности</p>
        <div className={clsx(styles.recommendGrid, staggerClassName)}>
          {recommendations.map((item) => (
            <div
              key={item.title}
              className={styles.recommendItem}
              data-icon-host
              style={{ ['--rec-accent' as string]: featureIconGlow(item.icon) }}
            >
              <span className={styles.recommendIcon}>
                <FeatureIcon name={item.icon} />
              </span>
              <div className={styles.recommendBody}>
                <span className={styles.recommendBadge}>{item.badge}</span>
                <p className="text-body-sm" style={{ fontWeight: 700 }}>
                  {item.title}
                </p>
                <p className="text-body-sm text-secondary">{item.description}</p>
              </div>
              <button
                type="button"
                className={styles.recommendArrow}
                aria-label={item.title}
                onClick={() => navigate({ screen: 'subjectCatalog' })}
              >
                <Icon name="arrowRight" size={16} />
              </button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
