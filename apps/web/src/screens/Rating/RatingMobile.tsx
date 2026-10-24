import { useNavigation } from '../../lib/navigation.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { SlideUp } from '../../ui/motion/motion.js';
import { RatingBoard } from './RatingBoard.js';
import styles from './RatingMobile.module.css';

/** Mobile «Рейтинг»: a back button over the same board as on desktop. */
export function RatingMobile() {
  const { back } = useNavigation();
  return (
    <SlideUp className={styles.stack}>
      <button type="button" className={styles.backButton} aria-label="Назад" onClick={back}>
        <Icon name="back" size={20} />
      </button>
      <RatingBoard />
    </SlideUp>
  );
}
