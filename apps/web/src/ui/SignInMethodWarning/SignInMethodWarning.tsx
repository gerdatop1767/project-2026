import { clsx } from '../../lib/clsx.js';
import { useAuth } from '../../lib/authContext.js';
import { useNavigation } from '../../lib/navigation.js';
import { Button } from '../Button/Button.js';
import { Icon } from '../Icon/Icon.js';
import styles from './SignInMethodWarning.module.css';

/**
 * For an account the server flags as having no working sign-in method
 * (`/auth/me` → `needsSignInMethod`): one created with the removed email
 * sign-in. Its session still works, but once it ends there is no way back
 * in — so ask the user to connect VK ID or Yandex ID while they can.
 * Nothing is merged or migrated; their progress stays where it is.
 *
 * `onProfile`: shown inside Профиль, right above «Способы входа», so no
 * button to go there.
 */
export function SignInMethodWarning({
  onProfile = false,
  className,
}: {
  onProfile?: boolean;
  className?: string;
}) {
  const { needsSignInMethod } = useAuth();
  if (!needsSignInMethod) return null;
  return (
    // A labelled region, not role="alert": it is shown on every visit to
    // Home, and a screen reader should not interrupt with it each time.
    <section
      className={clsx(styles.card, className)}
      aria-labelledby="sign-in-method-warning-title"
    >
      <Icon name="warning" size={22} className={styles.icon} />
      <div className={styles.copy}>
        <h2 id="sign-in-method-warning-title" className={styles.title}>
          Подключите VK ID или Яндекс ID
        </h2>
        <p className={styles.text}>
          Вход по почте отключён, а другого способа входа у этого аккаунта нет. Подключите VK ID или
          Яндекс ID, пока вы в аккаунте, — иначе после выхода вернуться в него не получится.
          Прогресс и статистика сохранятся.
        </p>
        {!onProfile && <OpenProfileButton />}
      </div>
    </section>
  );
}

/** Its own component so the in-profile variant needs no navigation context. */
function OpenProfileButton() {
  const { navigate } = useNavigation();
  return (
    <Button variant="primary" onClick={() => navigate({ screen: 'profile' })}>
      Подключить в профиле
    </Button>
  );
}
