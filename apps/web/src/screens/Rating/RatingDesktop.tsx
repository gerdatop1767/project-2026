import { WipPlaceholder } from '../../ui/WipPlaceholder/WipPlaceholder.js';
import { FadeIn } from '../../ui/motion/motion.js';
import styles from './RatingDesktop.module.css';

/**
 * Desktop Рейтинг — no leaderboard backend exists yet (ranking
 * aggregation, persistent user profiles/names), so this stays a
 * neutral placeholder rather than rendering `data/sampleLeaderboard.ts`
 * as if it were a real ranking.
 */
export function RatingDesktop() {
  return (
    <FadeIn className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className="text-h1">Рейтинг</h1>
          <p className="text-body-sm text-secondary">
            Соревнуйся с другими и мотивируй себя учиться!
          </p>
        </div>
      </div>
      <WipPlaceholder title="Рейтинг" note="Экран в разработке — следующий блок." />
    </FadeIn>
  );
}
