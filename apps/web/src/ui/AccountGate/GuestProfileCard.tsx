import { useNavigation } from '../../lib/navigation.js';
import { Button } from '../Button/Button.js';
import { Icon } from '../Icon/Icon.js';
import styles from './GuestProfileCard.module.css';

const perks = [
  'Статистика по номерам и темам',
  'Тренировка «Мои ошибки»',
  'Избранное и умная тренировка',
];

/**
 * Профиль for a guest: honest about what is (not) kept, with the way in.
 * Nothing here pretends a guest's answers will be synced later.
 */
export function GuestProfileCard() {
  const { navigate } = useNavigation();
  return (
    <section className={styles.card} aria-label="Гостевой режим">
      <img
        src="/branding/v2/support-bison.webp"
        alt=""
        aria-hidden="true"
        width={560}
        height={672}
        decoding="async"
        className={styles.mascot}
      />
      <div className={styles.copy}>
        <p className={styles.badge}>Гостевой режим</p>
        <h2 className={styles.title}>Ты занимаешься как гость</h2>
        <p className={styles.text}>
          Решать задания и проверять ответы можно без аккаунта, но прогресс, статистика и ошибки при
          этом не сохраняются.
        </p>
        <ul className={styles.perks}>
          {perks.map((perk) => (
            <li key={perk}>
              <Icon name="check" size={16} className={styles.perkIcon} />
              {perk}
            </li>
          ))}
        </ul>
        <Button variant="primary" fullWidth onClick={() => navigate({ screen: 'login' })}>
          Войти или зарегистрироваться
        </Button>
        <p className={styles.note}>Это бесплатно и занимает минуту.</p>
      </div>
    </section>
  );
}
