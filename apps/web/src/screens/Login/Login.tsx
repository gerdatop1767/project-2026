import { useEffect, useState } from 'react';
import { isSignInGateEntry, useNavigation } from '../../lib/navigation.js';
import { useAuth } from '../../lib/authContext.js';
import { vkLoginUrl, yandexLoginUrl } from '../../lib/api.js';
import { telegramErrorMessage } from '../../lib/telegramErrors.js';
import { isInTelegramWebView } from '../../lib/telegramMiniApp.js';
import {
  useTelegramHandoffSignIn,
  type HandoffProvider,
  type VkTelegramNotice,
} from '../../lib/useVkTelegramSignIn.js';
import { Button } from '../../ui/Button/Button.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { Logo } from '../../ui/Logo/Logo.js';
import { VkIcon } from '../../ui/VkIcon/VkIcon.js';
import { YandexIcon } from '../../ui/YandexIcon/YandexIcon.js';
import styles from './Login.module.css';

const PROVIDER = {
  vk: { name: 'VK ID', button: 'Продолжить через VK ID' },
  yandex: { name: 'Яндекс', button: 'Войти через Яндекс' },
} as const;

/** What a Mini App sign-in through the external browser ended with. */
function handoffNotice(provider: HandoffProvider, notice: Exclude<VkTelegramNotice, null>) {
  const { name, button } = PROVIDER[provider];
  return {
    cancelled: `Вход через ${name} отменён. Можно попробовать ещё раз.`,
    failed: `Не удалось войти через ${name}. Попробуйте ещё раз или выберите другой способ.`,
    expired: `Время на вход истекло. Нажмите «${button}» ещё раз.`,
    error: `Не удалось подготовить вход через ${name}. Проверьте соединение и попробуйте снова.`,
  }[notice];
}

/** What the Yandex ID callback's `?yandex=` outcome means (server-chosen). */
const yandexNotices: Record<string, string> = {
  cancelled: 'Вход через Яндекс отменён. Можно попробовать ещё раз.',
  error: 'Не удалось войти через Яндекс. Попробуйте ещё раз чуть позже.',
  invalid_state: 'Сеанс входа через Яндекс устарел. Нажмите «Войти через Яндекс» ещё раз.',
  not_configured: 'Вход через Яндекс пока не настроен. Войдите через VK ID.',
};

const benefits = [
  '10 000+ заданий по всем предметам ЕГЭ',
  'Разбор ошибок и персональные рекомендации',
  'Прогресс и статистика сохраняются навсегда',
];

/**
 * Sign-in / sign-up screen: VK ID and Yandex ID only — both server-side
 * OAuth, a first sign-in creates the account (docs/YANDEX_ID.md). There is no
 * email or password sign-in. On the website each button is a full-page
 * redirect; inside the Telegram Mini App (whose WebView can host neither)
 * each opens the device's external browser and the account is handed back
 * here (see useTelegramHandoffSignIn). The Mini App itself also signs in
 * with Telegram automatically.
 *
 * Rendered standalone (see App.tsx's `showLogin`), outside the normal
 * app shell; it follows the site theme.
 */
export function Login() {
  const { navigate, leave } = useNavigation();
  const { user, refresh, telegramError } = useAuth();

  // Yandex ID sends the browser back here with `?yandex=<outcome>`.
  const [yandexNotice] = useState(() => {
    const code = new URLSearchParams(window.location.search).get('yandex');
    return code ? (yandexNotices[code] ?? yandexNotices.error!) : null;
  });
  // VK ID sends the user back here with `?vk=cancelled` when they backed
  // out of (or denied) the VK consent screen.
  const [vkCancelled] = useState(
    () => new URLSearchParams(window.location.search).get('vk') === 'cancelled',
  );
  useEffect(() => {
    // One-shot notices: drop `?vk=`/`?yandex=` from the address bar.
    if (vkCancelled || yandexNotice) navigate({ screen: 'login' }, { replace: true });
  }, [vkCancelled, yandexNotice, navigate]);

  // Signed in (here, or already): straight into the trainer, REPLACING the
  // sign-in entry so Back does not return to it.
  useEffect(() => {
    if (user) navigate({ screen: 'home' }, { replace: true });
  }, [user, navigate]);

  const [inTelegram] = useState(isInTelegramWebView);
  const vkTelegram = useTelegramHandoffSignIn('vk', inTelegram, refresh);
  const yandexTelegram = useTelegramHandoffSignIn('yandex', inTelegram, refresh);
  const handoffs = { vk: vkTelegram, yandex: yandexTelegram };
  // At most one provider is open in the external browser at a time.
  const waitingFor: HandoffProvider | null = !inTelegram
    ? null
    : vkTelegram.phase === 'waiting'
      ? 'vk'
      : yandexTelegram.phase === 'waiting'
        ? 'yandex'
        : null;

  function handleClick(provider: HandoffProvider) {
    if (inTelegram) {
      handoffs[provider].open();
      return;
    }
    window.location.assign(provider === 'vk' ? vkLoginUrl() : yandexLoginUrl());
  }

  function providerButton(provider: HandoffProvider) {
    const tg = handoffs[provider];
    return (
      <Button
        variant="secondary"
        fullWidth
        className={provider === 'vk' ? styles.vkButton : styles.yandexButton}
        onClick={() => handleClick(provider)}
        loading={inTelegram && tg.phase === 'preparing'}
        disabled={inTelegram && tg.phase === 'unavailable'}
      >
        {provider === 'vk' ? <VkIcon size={20} /> : <YandexIcon size={20} />}{' '}
        {PROVIDER[provider].button}
      </Button>
    );
  }

  const unavailable = (['vk', 'yandex'] as const).filter(
    (p) => inTelegram && handoffs[p].phase === 'unavailable',
  );

  return (
    <div className={styles.page}>
      <button
        type="button"
        className={styles.closeButton}
        aria-label="Закрыть"
        onClick={() =>
          // In place of a private page, "back" would only reach more of
          // them (each turned into this screen again): go to the landing.
          isSignInGateEntry()
            ? navigate({ screen: 'home' }, { replace: true })
            : leave({ screen: 'home' })
        }
      >
        <Icon name="close" size={22} />
      </button>

      <div className={styles.rayTopLeft} aria-hidden="true" />
      <div className={styles.rayBottomRight} aria-hidden="true" />

      <div className={styles.layout}>
        <div className={styles.copy}>
          <Logo icon="desktop" size={40} />
          <h1 className={styles.headline}>Войти или создать аккаунт</h1>
          <p className={styles.subtext}>Через VK ID или Яндекс ID — без отдельного пароля.</p>
          <ul className={styles.benefits}>
            {benefits.map((benefit) => (
              <li key={benefit} className={styles.benefit}>
                <Icon name="check" size={18} className={styles.benefitIcon} />
                {benefit}
              </li>
            ))}
          </ul>
          <p className={styles.handwritten}>
            ЕГЭ — это реально!
            <svg
              width="46"
              height="28"
              viewBox="0 0 46 28"
              fill="none"
              className={styles.handwrittenArrow}
              aria-hidden="true"
            >
              <path
                d="M2 4C14 2 30 6 40 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d="M31 15 L41 19 L37 9"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </p>
        </div>

        <div className={styles.card}>
          {vkCancelled && (
            <p role="status" className={styles.formError}>
              Вход через VK ID отменён. Попробуйте ещё раз или войдите через Яндекс.
            </p>
          )}
          {yandexNotice && (
            <p role="status" className={styles.formError}>
              {yandexNotice}
            </p>
          )}
          {inTelegram &&
            (['vk', 'yandex'] as const).map((p) => {
              const notice = handoffs[p].notice;
              return notice ? (
                <p key={p} role="status" className={styles.formError}>
                  {handoffNotice(p, notice)}
                </p>
              ) : null;
            })}

          {waitingFor ? (
            <div className={styles.vkWaiting} role="status" aria-live="polite">
              <Icon name="spinner" size={24} className={styles.stateSpinner} />
              <p className={styles.vkWaitingTitle}>Ждём вход через {PROVIDER[waitingFor].name}</p>
              <p className={styles.stateText}>
                Мы открыли {PROVIDER[waitingFor].name} в браузере. Войдите там и вернитесь в
                Telegram — вход подхватится автоматически.
              </p>
              <Button variant="secondary" fullWidth onClick={handoffs[waitingFor].restart}>
                Начать заново
              </Button>
            </div>
          ) : (
            <>
              {providerButton('vk')}
              {providerButton('yandex')}
              {inTelegram && unavailable.length < 2 && (
                <p className={styles.vkHint}>Откроется в браузере, затем вернитесь в Telegram</p>
              )}
              {unavailable.map((p) => (
                <p key={p} className={styles.vkHint}>
                  Вход через {PROVIDER[p].name} сейчас недоступен
                </p>
              ))}
            </>
          )}

          {/* A second, empty profile is the one real risk of a new button:
              accounts are never merged automatically (and Yandex's email is
              not even read), so steer existing users to their old way in. */}
          <p className={styles.accountHint}>
            Уже занимались в Зубрилке через VK или Telegram? Войдите тем же способом (Telegram —
            через бота Зубрилки), а Яндекс ID подключите потом в профиле. Иначе создастся новый
            пустой аккаунт: профили не объединяются автоматически.
          </p>

          {telegramError && (
            <p role="alert" className={styles.formError}>
              {telegramErrorMessage(telegramError)}
            </p>
          )}

          <p className={styles.consent}>
            Продолжая, вы соглашаетесь с условиями использования Zybrilka и обработкой персональных
            данных.
          </p>
        </div>
      </div>
    </div>
  );
}
