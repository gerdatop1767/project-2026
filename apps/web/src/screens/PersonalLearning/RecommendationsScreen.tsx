import { useNavigation } from '../../lib/navigation.js';
import { Tabs } from '../../ui/Tabs/Tabs.js';
import { LEARNING_CENTER_CRUMB, LearningNav } from '../../ui/LearningNav/LearningNav.js';
import { PersonalPlanBlock } from '../../ui/PersonalLearning/PersonalPlanBlock.js';
import styles from '../../ui/PersonalLearning/PersonalLearning.module.css';

const TABS = [
  { id: 'all', label: 'Все' },
  { id: 'math', label: 'Математика' },
  { id: 'russian', label: 'Русский язык' },
];

/** «Все рекомендации»: the full personal plan, optionally of one subject. */
export function RecommendationsScreen({ subjectId }: { subjectId?: 'math' | 'russian' }) {
  const { navigate } = useNavigation();
  return (
    <div className={styles.screen}>
      <LearningNav trail={[LEARNING_CENTER_CRUMB, { label: 'Рекомендации' }]} />
      <Tabs
        aria-label="Предмет"
        items={TABS}
        activeId={subjectId ?? 'all'}
        onChange={(id) =>
          navigate(
            {
              screen: 'recommendations',
              ...(id === 'math' || id === 'russian' ? { subjectId: id } : {}),
            },
            { replace: true },
          )
        }
      />
      <PersonalPlanBlock subjectId={subjectId} limit={12} />
    </div>
  );
}
