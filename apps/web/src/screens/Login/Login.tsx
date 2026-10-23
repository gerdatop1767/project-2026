import { useEffect, useState } from 'react';
import { isSignInGateEntry, useNavigation } from '../../lib/navigation.js';
import { useAuth } from '../../lib/authContext.js';
import { vkLoginUrl, yandexLoginUrl } from '../../lib/api.js';
import { telegramErrorMessage } from '../../lib/telegramErrors.js';
import { isInTelegramWebView } from '../../lib/telegramMiniApp.js';
import { useVkTelegramSignIn, type VkTelegramNotice } from '../../lib/useVkTelegramSignIn.js';
import { Button } from '../../ui/Button/Button.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { Logo } from '../../ui/Logo/Logo.js';
import { VkIcon } from '../../ui/VkIcon/VkIcon.js';
import { YandexIcon } from '../../ui/YandexIcon/YandexIcon.js';
import { clsx } from '../../lib/clsx.js';
import { PasswordSignIn } from './PasswordSignIn.js';
import styles from './Login.module.css';

// How long the "Готово!" success state shows before auto-redirecting
// into the trainer — long enough to register as a real confirmation,
// short enough that the redirect still feels automatic, not stalled.
const SUCCESS_REDIRECT_DELAY_MS = 1200;

const vkTelegramNotices: Record<Exclude<VkTelegramNotice, null>, string> = {
  cancelled: 'Вход через VK ID отменён. Можно попробовать ещё раз.',
  failed: 'Не удалось войти через VK ID. Попробуйте ещё раз или войдите через Яндекс.',
  expired: 'Время на вход истекло. Нажмите «Продолжить через VK ID» ещё раз.',
  error: 'Не удалось подготовить вход через VK ID. Проверьте соединение и попробуйте снова.',
};

/** What the Yandex ID callback's `?yandex=` outcome means (server-chosen). */
const yandexNotices: Record<string, string> = {
  cancelled: 'Вход через Яндекс отменён. Можно попробовать ещё раз.',
  error: 'Не удалось войти через Яндекс. Попробуйте ещё раз чуть позже.',
  invalid_state: 'Сеанс входа через Яндекс устарел. Нажмите «Войти через Яндекс» ещё раз.',
  not_configured: 'Вход через Яндекс пока не настроен. Войдите через VK ID.',
  email_in_use:
    'С почтой этого аккаунта Яндекса уже есть профиль в Зубрилке. Войдите в него (по почте и паролю), затем подключите Яндекс в профиле — так прогресс останется в одном аккаунте.',
};

const benefits = [
  '10 000+ заданий по всем предметам ЕГЭ',
  'Разбор ошибок и персональные рекомендации',
  'Прогресс и статистика сохраняются навсегда',
];

/**
 * Sign-in / sign-up screen: VK ID and Yandex ID (both server-side OAuth;
 * a first sign-in creates the account), plus email + password for accounts
 * that already have one. No email is sent from here any more —
 * registration by email, confirmation letters and password reset were
 * removed (docs/YANDEX_ID.md). Telegram Mini App users are signed in by
 * Telegram itself.
 *
 * Rendered standalone (see App.tsx's `showLogin`), outside the normal
 * dark app shell: the approved reference is a dedicated light page,
 * not a dashboard screen, so this scopes its own light-theme token
 * overrides (see Login.module.css's `.page`) rather than touching the
 * app-wide dark tokens — every reused component below (Button, Input)
 * already reads colors from those same custom properties, so they
 * render correctly light here for free.
 *
 * No mascot: deliberately omitted per the project owner's own
 * decision (no bison asset exists in this repo yet) — see the task's
 * final report for the follow-up note.
 */
export function Login() {
  const { navigate, leave } = useNavigation();
  const { user, refresh, telegramError } = useAuth();

  const [showPassword, setShowPassword] = useState(false);
  // Yandex ID sends the browser back here with `?yandex=<outcome>`.
  const [yandexNotice] = useState(() => {
    const code = new URLSearchParams(window.location.search).get('yandex');
    return code ? (yandexNotices[code] ?? yandexNotices.error!) : null;
  });

  // VK ID sends the user back here with `?vk=cancelled` when they backed
  // out of (or denied) the VK consent screen — say so instead of leaving
  // them on a silent, unchanged form.
  const [vkCancelled] = useState(
    () => new URLSearchParams(window.location.search).get('vk') === 'cancelled',
  );
  useEffect(() => {
    // One-shot notices: drop `?vk=`/`?yandex=` from the address bar.
    if (vkCancelled || yandexNotice) navigate({ screen: 'login' }, { replace: true });
  }, [vkCancelled, yandexNotice, navigate]);

  const [verifyState, setVerifyState] = useState<'idle' | 'done'>('idle');

  // Confirmed sign-in (fresh verify, or already had a session) always
  // ends the same way: straight into the trainer, using the real
  // server session that was just set/confirmed — never a second,
  // parallel notion of "logged in" on the client.
  // The redirect REPLACES the sign-in entry: Back after signing in must not
  // return to the sign-in page (which would just bounce forward again).
  useEffect(() => {
    if (verifyState === 'done') {
      const id = window.setTimeout(
        () => navigate({ screen: 'home' }, { replace: true }),
        SUCCESS_REDIRECT_DELAY_MS,
      );
      return () => window.clearTimeout(id);
    }
    if (user && verifyState === 'idle') {
      navigate({ screen: 'home' }, { replace: true });
    }
  }, [user, verifyState, navigate]);

  // Password sign-in: pull the new server session into the app first (so
  // the gate never sees a half-signed-in state), then «Готово» + redirect.
  async function handleSignedIn() {
    await refresh();
    setVerifyState('done');
  }

  // Inside the Telegram Mini App VK ID opens in the external browser and
  // the account is handed back here (see useVkTelegramSignIn); on the
  // website it is the usual full-page redirect.
  const [inTelegram] = useState(isInTelegramWebView);
  const vkTelegram = useVkTelegramSignIn(inTelegram, refresh);

  function handleVkClick() {
    if (inTelegram) {
      vkTelegram.open();
      return;
    }
    window.location.href = vkLoginUrl();
  }

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

          {verifyState === 'idle' && (
            <>
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
            </>
          )}
        </div>

        <div className={styles.card}>
          {verifyState === 'done' && (
            <div className={styles.statePanel}>
              <Icon name="success" size={40} className={styles.stateIconSuccess} />
              <p className={clsx('text-h3', styles.stateTitle)}>Готово!</p>
              <p className={styles.stateText}>Вы вошли в Zybrilka. Переходим в тренажёр…</p>
              <Button fullWidth onClick={() => navigate({ screen: 'home' }, { replace: true })}>
                Перейти сейчас
              </Button>
            </div>
          )}

          {verifyState === 'idle' && (
            <>
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
              {inTelegram && vkTelegram.notice && (
                <p role="status" className={styles.formError}>
                  {vkTelegramNotices[vkTelegram.notice]}
                </p>
              )}
              {inTelegram && vkTelegram.phase === 'waiting' ? (
                <div className={styles.vkWaiting} role="status" aria-live="polite">
                  <Icon name="spinner" size={24} className={styles.stateSpinner} />
                  <p className={styles.vkWaitingTitle}>Ждём вход через VK ID</p>
                  <p className={styles.stateText}>
                    Мы открыли VK ID в браузере. Войдите там и вернитесь в Telegram — вход
                    подхватится автоматически.
                  </p>
                  <Button variant="secondary" fullWidth onClick={vkTelegram.restart}>
                    Начать заново
                  </Button>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  fullWidth
                  className={styles.vkButton}
                  onClick={handleVkClick}
                  loading={inTelegram && vkTelegram.phase === 'preparing'}
                  disabled={inTelegram && vkTelegram.phase === 'unavailable'}
                >
                  <VkIcon size={20} /> Продолжить через VK ID
                </Button>
              )}
              {inTelegram && vkTelegram.phase === 'ready' && (
                <p className={styles.vkHint}>Откроется в браузере, затем вернитесь в Telegram</p>
              )}
              {inTelegram && vkTelegram.phase === 'unavailable' && (
                <p className={styles.vkHint}>Вход через VK ID сейчас недоступен</p>
              )}

              {/* Yandex ID runs in the normal browser; inside the Telegram
                  Mini App Telegram itself signs the user in. */}
              {!inTelegram && (
                <Button
                  variant="secondary"
                  fullWidth
                  className={styles.yandexButton}
                  onClick={() => (window.location.href = yandexLoginUrl())}
                >
                  <YandexIcon size={20} /> Войти через Яндекс
                </Button>
              )}

              {telegramError && (
                <p role="alert" className={styles.formError}>
                  {telegramErrorMessage(telegramError)}
                </p>
              )}

              {showPassword ? (
                <>
                  <div className={styles.divider}>
                    <span>аккаунт с почтой и паролем</span>
                  </div>
                  <PasswordSignIn onSignedIn={handleSignedIn} />
                </>
              ) : (
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => setShowPassword(true)}
                >
                  Уже есть аккаунт с почтой и паролем? Войти
                </button>
              )}

              <p className={styles.consent}>
                Продолжая, вы соглашаетесь с условиями использования Zybrilka и обработкой
                персональных данных.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
