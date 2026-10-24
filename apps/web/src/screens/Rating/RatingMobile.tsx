import { useState } from 'react';
import { subjects } from '../../data/subjects.js';
import { useNavigation } from '../../lib/navigation.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { Tabs } from '../../ui/Tabs/Tabs.js';
import { SubjectHeaderMobile } from '../../ui/SubjectHeader/SubjectHeaderMobile.js';
import { WipPlaceholder } from '../../ui/WipPlaceholder/WipPlaceholder.js';
import { ContentSwap, SlideUp } from '../../ui/motion/motion.js';
import styles from './RatingMobile.module.css';

const viewTabs = [
  { id: 'overall', label: 'Общий' },
  { id: 'friends', label: 'Друзья' },
  { id: 'region', label: 'Мой регион' },
  { id: 'byTask', label: 'По заданиям' },
];

/**
 * Mobile Рейтинг — no leaderboard backend exists yet (ranking
 * aggregation, persistent user profiles/names), so every tab stays a
 * neutral placeholder rather than rendering `data/sampleLeaderboard.ts`
 * as if it were a real ranking.
 */
export function RatingMobile() {
  const { back } = useNavigation();
  const subject = subjects.find((s) => s.id === 'math') ?? subjects[0]!;
  const [view, setView] = useState('overall');

  return (
    <SlideUp className={styles.stack}>
      <SubjectHeaderMobile
        subject={subject}
        title="Рейтинг"
        onBack={back}
        trailing={
          <button type="button" aria-label="Награды" className={styles.trailingButton}>
            <Icon name="gift" size={20} />
          </button>
        }
      />

      <Tabs items={viewTabs} activeId={view} onChange={setView} aria-label="Раздел рейтинга" />

      <ContentSwap key={view}>
        <WipPlaceholder
          title={viewTabs.find((t) => t.id === view)!.label}
          note="Экран в разработке — следующий блок."
        />
      </ContentSwap>
    </SlideUp>
  );
}
