import { useNavigation } from '../../lib/navigation.js';
import { useAuth } from '../../lib/authContext.js';
import { Button } from '../../ui/Button/Button.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { FadeIn } from '../../ui/motion/motion.js';
import styles from './LandingMobile.module.css';

const features = [
  { icon: 'topic', label: '5+', caption: 'предметов' },
  { icon: 'reference', label: '10 000+', caption: 'заданий' },
  { icon: 'gem', label: 'Бесплатно', caption: 'без подписки' },
  { icon: 'progress', label: 'Умная', caption: 'статистика' },
] as const;

/**
 * Public landing (mobile) — same role as LandingDesktop: the first
 * screen a brand-new visitor sees on a phone, before onboarding. Same
 * copy/mascot/features as the desktop marketing hero, restacked into
 * one column (mobile Home itself is a different, dashboard-style
 * screen with no landing content — see HomeMobile.tsx — so this is a
 * new mobile composition of EXISTING copy/assets/tokens, never a new
 * visual style).
 */
export function LandingMobile() {
  const { navigate } = useNavigation();
  const { user } = useAuth();

  return (
    <FadeIn className={styles.stack}>
      <div className={styles.illustration} aria-hidden="true">
        <img
          src="/branding/v2/hero-mascot-desktop.webp"
          alt=""
          className={styles.illustrationImg}
        />
      </div>

      <p className={styles.eyebrow}>Интерактивный тренажёр для ЕГЭ</p>
      <h1 className={styles.headline}>
        ЕГЭ становится проще, когда есть <span className={styles.headlineAccent}>Zybrilka</span>
      </h1>
      <p className="text-body-sm text-secondary">
        Задания, тренировки, объяснения и статистика — всё для подготовки к ЕГЭ в одном месте.
      </p>

      <div className={styles.actions}>
        <Button variant="primary" fullWidth onClick={() => navigate({ screen: 'onboarding' })}>
          Начать бесплатно <Icon name="arrowRight" size={18} />
        </Button>
        <Button variant="secondary" fullWidth onClick={() => navigate({ screen: 'about' })}>
          <Icon name="play" size={18} /> О проекте
        </Button>
        {!user && (
          <Button variant="ghost" fullWidth onClick={() => navigate({ screen: 'login' })}>
            Войти
          </Button>
        )}
      </div>

      <div className={styles.features}>
        {features.map((feature) => (
          <div key={feature.caption} className={styles.feature}>
            <Icon name={feature.icon} size={20} className={styles.featureIcon} />
            <span>
              <strong>{feature.label}</strong>
              <br />
              {feature.caption}
            </span>
          </div>
        ))}
      </div>
    </FadeIn>
  );
}
