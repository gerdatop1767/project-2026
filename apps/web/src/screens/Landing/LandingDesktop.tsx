import { useNavigation } from '../../lib/navigation.js';
import { useAuth } from '../../lib/authContext.js';
import { Button } from '../../ui/Button/Button.js';
import { Card } from '../../ui/Card/Card.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { FadeIn } from '../../ui/motion/motion.js';
import styles from './LandingDesktop.module.css';

const features = [
  { icon: 'topic', label: '5+', caption: 'предметов' },
  { icon: 'reference', label: '10 000+', caption: 'заданий' },
  { icon: 'gem', label: 'Бесплатно', caption: 'без подписки' },
  { icon: 'progress', label: 'Умная', caption: 'статистика' },
] as const;

const loopSteps = [
  { icon: 'reference', title: 'Задание', description: 'Решаешь задачу по теме ЕГЭ' },
  { icon: 'check', title: 'Проверка', description: 'Мгновенно узнаёшь результат' },
  { icon: 'hint', title: 'Объяснение', description: 'Понимаешь, в чём была ошибка' },
  { icon: 'progress', title: 'Прогресс', description: 'Видишь рост по слабым темам' },
] as const;

/**
 * Public landing (desktop) — the very first thing a brand-new visitor
 * to zybrilka.ru sees, shown outside the normal app shell (no bottom
 * nav/sidebar) while `onboardingCompleted` is false (see App.tsx).
 * Same copy/mascot/features as the existing HomeDesktop marketing hero
 * (desktop/01_home.png) — HomeDesktop itself is left untouched so an
 * already-onboarded user's Home keeps behaving exactly as before;
 * this is only the pre-onboarding gate, with "Начать бесплатно"
 * leading into onboarding instead of straight into the app.
 */
export function LandingDesktop() {
  const { navigate } = useNavigation();
  const { user } = useAuth();

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div className={styles.copy}>
          <FadeIn>
            <p className={styles.eyebrow}>Интерактивный тренажёр для ЕГЭ</p>
            <h1 className={styles.headline}>
              ЕГЭ становится проще,
              <br />
              когда есть <span className={styles.headlineAccent}>Zybrilka</span>
            </h1>
            <p className={styles.subtext}>
              Задания, тренировки, объяснения и статистика — всё для подготовки к ЕГЭ в одном месте.
            </p>
            <div className={styles.actions}>
              <Button variant="primary" onClick={() => navigate({ screen: 'onboarding' })}>
                Начать бесплатно <Icon name="arrowRight" size={18} />
              </Button>
              <Button variant="secondary" onClick={() => navigate({ screen: 'about' })}>
                <Icon name="play" size={18} /> О проекте
              </Button>
              {!user && (
                <Button variant="ghost" onClick={() => navigate({ screen: 'login' })}>
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
        </div>
        <div className={styles.illustration} aria-hidden="true">
          <img
            src="/branding/v2/hero-mascot-desktop.webp"
            alt=""
            className={styles.illustrationImg}
          />
        </div>
      </div>

      <div className={styles.loop}>
        <p className="text-h3">Как работает Zybrilka</p>
        <div className={styles.loopGrid}>
          {loopSteps.map((step, index) => (
            <Card key={step.title} className={styles.loopCard}>
              <span className={styles.loopIndex}>{index + 1}</span>
              <Icon name={step.icon} size={22} className={styles.loopIcon} />
              <p className="text-body" style={{ fontWeight: 700 }}>
                {step.title}
              </p>
              <p className="text-body-sm text-secondary">{step.description}</p>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
