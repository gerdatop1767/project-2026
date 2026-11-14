import { useState } from 'react';
import { useNavigation, type Route } from '../../lib/navigation.js';
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
import {
  LearningSearchBox,
  LearningSearchResults,
} from '../../ui/LearningSearch/LearningSearch.js';
import styles from './LearningCenterDesktop.module.css';

interface LearningSection {
  icon: FeatureIconName;
  title: string;
  description: string;
  /** Where the card leads. */
  route: Route;
}

export const learningSections: readonly LearningSection[] = [
  {
    icon: 'theory',
    title: 'Теория',
    description: 'Правила и формулы по номерам ЕГЭ: русский язык и профильная математика',
    route: { screen: 'theory', section: 'rules' },
  },
  {
    icon: 'practice',
    title: 'Практика',
    description: 'Разборы заданий и примеры решений',
    route: { screen: 'subjectCatalog' },
  },
  {
    icon: 'strategy',
    title: 'Стратегии',
    description: 'Время на экзамене, порядок заданий, оформление, сочинение, проверка ответов',
    route: { screen: 'library', section: 'strategies' },
  },
  {
    icon: 'materials',
    title: 'Полезные материалы',
    description: 'Таблицы формул, справочники, схемы и шпаргалки по математике и русскому',
    route: { screen: 'library', section: 'materials' },
  },
];

/**
 * Desktop "Учебный центр" (approved reference screenshot): a hub of
 * theory/practice/strategy/resource sections, a subject picker and
 * personalized recommendations — not a dashboard, a materials index.
 */
export function LearningCenterDesktop() {
  const { navigate } = useNavigation();
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;

  return (
    <div>
      <div className={styles.headRow}>
        <div>
          <h1 className="text-h1">Учебный центр</h1>
          <p className="text-body-sm text-secondary">
            Всё, что нужно для эффективной подготовки к ЕГЭ в одном месте
          </p>
        </div>
        <LearningSearchBox
          value={query}
          onChange={setQuery}
          placeholder="Поиск материалов…"
          label="Поиск материалов"
          className={styles.search}
        />
      </div>

      {searching && (
        <div className={styles.searchResults}>
          <LearningSearchResults query={query} />
        </div>
      )}

      <SignInMethodWarning className={styles.signInWarning} />

      <div hidden={searching} className={clsx(styles.sectionsGrid, staggerClassName)}>
        {learningSections.map((section) => (
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
              onClick={() => navigate(section.route)}
            >
              {/* Two copies: on hover/press the arrow flies out to the right
                  while its twin slides in from the left. */}
              <span className={styles.arrowTrack} aria-hidden="true">
                <Icon name="arrowRight" size={18} className={styles.arrowIcon} />
                <Icon name="arrowRight" size={18} className={styles.arrowIcon} />
              </span>
            </button>
          </Card>
        ))}
      </div>

      <div hidden={searching} className={styles.subjectsHead}>
        <p className="text-h3">Выбери предмет</p>
        <p className="text-body-sm text-secondary">Перейди к материалам нужного предмета</p>
      </div>
      <div hidden={searching} className={clsx(styles.subjectsGrid, staggerClassName)}>
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

      <Card hidden={searching} className={styles.recommendCard}>
        <p className="text-h3">Рекомендации для тебя</p>
        {/* No recommendation engine behind this block yet: an honest
            placeholder — no invented «personal» picks, no API requests. */}
        <div className={styles.recommendEmpty} role="status">
          <span className={styles.recommendEmptyIcon} aria-hidden="true">
            <Icon name="smart" size={22} />
          </span>
          <div>
            <p className="text-body" style={{ fontWeight: 700 }}>
              Рекомендации появятся позже
            </p>
            <p className="text-body-sm text-secondary">
              Решай задания — по ним мы подберём, что повторить и чем заняться дальше.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
