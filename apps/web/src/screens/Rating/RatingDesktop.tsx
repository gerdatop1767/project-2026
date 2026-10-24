import { FadeIn } from '../../ui/motion/motion.js';
import { RatingBoard } from './RatingBoard.js';
import styles from './RatingDesktop.module.css';

/** Desktop «Рейтинг»: the board with its side column (RatingBoard). */
export function RatingDesktop() {
  return (
    <FadeIn className={styles.page}>
      <RatingBoard />
    </FadeIn>
  );
}
