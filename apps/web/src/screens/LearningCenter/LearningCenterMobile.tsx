import { useState } from 'react';
import { useNavigation } from '../../lib/navigation.js';
import { FeatureIcon } from '../../ui/FeatureIcon/FeatureIcon.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { onLinkClick } from '../../lib/linkClick.js';
import { pathForRoute } from '../../lib/routes.js';
import { LearningNav } from '../../ui/LearningNav/LearningNav.js';
import {
  LearningSearchBox,
  LearningSearchResults,
} from '../../ui/LearningSearch/LearningSearch.js';
import { learningSections } from './LearningCenterDesktop.js';
import { RecommendationsList } from '../../ui/LearningEngine/RecommendationsList.js';
import styles from './LearningCenterMobile.module.css';

/**
 * «Учебный центр» on a phone: the same sections as on desktop as a list,
 * and the same search over theory, materials and strategies. The search
 * box sits at the top, where the thumb and the keyboard expect it.
 */
export function LearningCenterMobile() {
  const { navigate } = useNavigation();
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;

  return (
    <div className={styles.screen}>
      <LearningNav trail={[{ label: 'Учебный центр' }]} />
      <header>
        <h1 className="text-h1">Учебный центр</h1>
        <p className="text-body-sm text-secondary">
          Теория, справочники и стратегии подготовки к ЕГЭ
        </p>
      </header>
      <LearningSearchBox value={query} onChange={setQuery} />
      {searching ? (
        <LearningSearchResults query={query} />
      ) : (
        <ul className={styles.sections}>
          {learningSections.map((section) => (
            <li key={section.title}>
              <a
                href={pathForRoute(section.route) ?? undefined}
                className={styles.row}
                onClick={(e) => onLinkClick(e, () => navigate(section.route))}
              >
                <span className={styles.icon}>
                  <FeatureIcon name={section.icon} />
                </span>
                <span className={styles.text}>
                  <span className={styles.title}>{section.title}</span>
                  <span className={styles.description}>{section.description}</span>
                </span>
                <Icon name="chevronRight" size={18} className={styles.chevron} />
              </a>
            </li>
          ))}
        </ul>
      )}
      {!searching && (
        <section aria-labelledby="lc-recs" className={styles.recs}>
          <h2 id="lc-recs" className="text-h3">
            Рекомендации для тебя
          </h2>
          <RecommendationsList limit={3} />
        </section>
      )}
    </div>
  );
}
