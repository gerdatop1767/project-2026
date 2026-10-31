import { WipPlaceholder } from '../../ui/WipPlaceholder/WipPlaceholder.js';
import { FadeIn } from '../../ui/motion/motion.js';
import styles from './FriendsDesktop.module.css';

/**
 * Desktop "Друзья" — no social-graph backend exists yet (friend list,
 * requests, invites), so this stays a neutral placeholder rather than
 * rendering `data/sampleFriends.ts` — with locally-simulated
 * accept/reject — as if it were a real friends system.
 */
export function FriendsDesktop() {
  return (
    <FadeIn className={styles.page}>
      <div className={styles.headRow}>
        <h1 className="text-h1">Друзья</h1>
      </div>
      <p className="text-body-sm text-secondary">Общайся, сравнивай результаты и учись вместе!</p>
      <WipPlaceholder title="Друзья" note="Экран в разработке — следующий блок." />
    </FadeIn>
  );
}
