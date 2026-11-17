import { useEffect } from 'react';
import { useNavigation } from '../../lib/navigation.js';
import { Tabs } from '../../ui/Tabs/Tabs.js';
import { LEARNING_CENTER_CRUMB, LearningNav } from '../../ui/LearningNav/LearningNav.js';
import { PersonalPlanBlock } from '../../ui/PersonalLearning/PersonalPlanBlock.js';
import {
  PLAN_SUBJECTS,
  isPlanSubject,
  usePlanSubject,
} from '../../ui/PersonalLearning/planSubject.js';
import styles from '../../ui/PersonalLearning/PersonalLearning.module.css';

/**
 * «Все рекомендации»: the full personal plan of ONE subject — the one in
 * the address, else the remembered choice. Switching keeps the choice for
 * the other plan views; subjects are never mixed.
 */
export function RecommendationsScreen({
  subjectId: fromRoute,
}: {
  subjectId?: 'math' | 'russian';
}) {
  const { navigate } = useNavigation();
  const [remembered, remember] = usePlanSubject();
  const subjectId = fromRoute ?? remembered;
  // A subject opened by link becomes the remembered choice too.
  useEffect(() => {
    if (fromRoute && fromRoute !== remembered) remember(fromRoute);
  }, [fromRoute, remembered, remember]);
  return (
    <div className={styles.screen}>
      <LearningNav trail={[LEARNING_CENTER_CRUMB, { label: 'Рекомендации' }]} />
      <Tabs
        aria-label="Предмет"
        items={PLAN_SUBJECTS}
        activeId={subjectId}
        onChange={(id) => {
          if (!isPlanSubject(id)) return;
          remember(id);
          navigate({ screen: 'recommendations', subjectId: id }, { replace: true });
        }}
      />
      <PersonalPlanBlock subjectId={subjectId} limit={12} />
    </div>
  );
}
