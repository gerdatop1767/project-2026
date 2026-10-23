import { useEffect, useRef, useState } from 'react';
import { isSignInGateEntry, useNavigation } from '../../lib/navigation.js';
import { useAuth } from '../../lib/authContext.js';
import { verifyMagicLink, vkLoginUrl } from '../../lib/api.js';
import { telegramErrorMessage } from '../../lib/telegramErrors.js';
import { isInTelegramWebView } from '../../lib/telegramMiniApp.js';
import { useVkTelegramSignIn, type VkTelegramNotice } from '../../lib/useVkTelegramSignIn.js';
import { Button } from '../../ui/Button/Button.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { Logo } from '../../ui/Logo/Logo.js';
import { VkIcon } from '../../ui/VkIcon/VkIcon.js';
import { clsx } from '../../lib/clsx.js';
import { EmailAuthForms, EmailLinkFlow, type EmailMode } from './EmailAuth.js';
import styles from './Login.module.css';

// How long the "Готово!" success state shows before auto-redirecting
// into the trainer — long enough to register as a real confirmation,
// short enough that the redirect still feels automatic, not stalled.
const SUCCESS_REDIRECT_DELAY_MS = 1200;

const vkTelegramNotices: Record<Exclude<VkTelegramNotice, null>, string> = {
  cancelled: 'Вход через VK ID отменён. Можно попробовать ещё раз.',
  failed: 'Не удалось войти через VK ID. Попробуйте ещё раз или войдите по почте.',
  expired: 'Время на вход истекло. Нажмите «Продолжить через VK ID» ещё раз.',
  error: 'Не удалось подготовить вход через VK ID. Проверьте соединение и попробуйте снова.',
};

const benefits = [
  '10 000+ заданий по всем предметам ЕГЭ',
  'Разбор ошибок и персональные рекомендации',
  'Прогресс и статистика сохраняются навсегда',
];

/**
 * Sign-in / sign-up screen: VK ID, email + password (registration with a
 * confirmation letter, sign-in, password reset — EmailAuth.tsx, backed by
 * docs/EMAIL_AUTH.md) and the passwordless email link. Emailed links come
 * back here: `?token=` (passwordless sign-in), `?confirm=` (finish
 * registration), `?reset=` (new password); `?mode=register` opens the
 * registration tab.
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

  // Read once: the emailed links and the requested tab.
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const [link, setLink] = useState<{ kind: 'confirm' | 'reset'; token: string } | null>(() => {
    const confirm = params.get('confirm');
    const reset = params.get('reset');
    if (confirm) return { kind: 'confirm', token: confirm };
    if (reset) return { kind: 'reset', token: reset };
    return null;
  });
  const [emailMode, setEmailMode] = useState<EmailMode>(() =>
    params.get('mode') === 'register' ? 'register' : 'signin',
  );
  const [doneTitle, setDoneTitle] = useState('Готово!');

  // VK ID sends the user back here with `?vk=cancelled` when they backed
  // out of (or denied) the VK consent screen — say so instead of leaving
  // them on a silent, unchanged form.
  const [vkCancelled] = useState(
    () => new URLSearchParams(window.location.search).get('vk') === 'cancelled',
  );
  useEffect(() => {
    if (vkCancelled) navigate({ screen: 'login' }, { replace: true });
  }, [vkCancelled, navigate]);

  // Magic-link verification: the user followed the emailed link back
  // here with ?token=... — a completely different mode of this same
  // screen, never the plain email-entry form.
  const [verifyState, setVerifyState] = useState<'idle' | 'verifying' | 'done' | 'error'>('idle');
  const verifyStarted = useRef(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token || verifyStarted.current) return;
    verifyStarted.current = true;
    setVerifyState('verifying');
    verifyMagicLink(token)
      .then(async () => {
        // Pull the new server-side session (and its onboarding status)
        // into the app BEFORE showing success/redirecting, so the gate
        // in App.tsx never sees a half-signed-in state.
        await refresh();
        setVerifyState('done');
      })
      .catch(() => setVerifyState('error'));
  }, [refresh]);

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
    if (user && verifyState === 'idle' && !link) {
      navigate({ screen: 'home' }, { replace: true });
    }
  }, [user, verifyState, navigate, link]);

  // Any email flow that ends signed in: pull the new server session into
  // the app first (so the gate never sees a half-signed-in state), then
  // the same «Готово» panel and redirect as the passwordless link.
  async function handleSignedIn(title: string) {
    await refresh();
    setDoneTitle(title);
    setVerifyState('done');
  }

  // Leaving an emailed-link page: drop the token from the address bar.
  function leaveLink(mode?: EmailMode) {
    navigate({ screen: 'login' }, { replace: true });
    setLink(null);
    if (mode) setEmailMode(mode);
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
              <p className={styles.subtext}>
                Через VK ID или по почте — с паролем или по одноразовой ссылке.
              </p>
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
          {verifyState === 'verifying' && (
            <div className={styles.statePanel}>
              <Icon name="spinner" size={32} className={styles.stateSpinner} />
              <p className={clsx('text-h3', styles.stateTitle)}>Входим…</p>
              <p className={styles.stateText}>Проверяем ссылку — это пара секунд.</p>
            </div>
          )}

          {verifyState === 'done' && (
            <div className={styles.statePanel}>
              <Icon name="success" size={40} className={styles.stateIconSuccess} />
              <p className={clsx('text-h3', styles.stateTitle)}>{doneTitle}</p>
              <p className={styles.stateText}>Вы вошли в Zybrilka. Переходим в тренажёр…</p>
              <Button fullWidth onClick={() => navigate({ screen: 'home' }, { replace: true })}>
                Перейти сейчас
              </Button>
            </div>
          )}

          {verifyState === 'error' && (
            <div className={styles.statePanel}>
              <Icon name="errorCircle" size={40} className={styles.stateIconError} />
              <p className={clsx('text-h3', styles.stateTitle)}>Ссылка недействительна</p>
              <p className={styles.stateText}>
                Похоже, эта ссылка для входа устарела или уже использована. Запросите новую.
              </p>
              <Button
                fullWidth
                onClick={() => {
                  navigate({ screen: 'login' }, { replace: true });
                  setVerifyState('idle');
                }}
              >
                Запросить новую ссылку
              </Button>
            </div>
          )}

          {verifyState === 'idle' && link && (
            <EmailLinkFlow
              key={link.token}
              kind={link.kind}
              token={link.token}
              onSignedIn={handleSignedIn}
              onDone={leaveLink}
            />
          )}

          {verifyState === 'idle' && !link && (
            <>
              {vkCancelled && (
                <p role="status" className={styles.formError}>
                  Вход через VK ID отменён. Попробуйте ещё раз или войдите по почте.
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

              <div className={styles.divider}>
                <span>или</span>
              </div>

              <EmailAuthForms
                key={emailMode}
                initialMode={emailMode}
                onSignedIn={handleSignedIn}
                extraError={
                  telegramError && (
                    <p role="alert" className={styles.formError}>
                      {telegramErrorMessage(telegramError)}
                    </p>
                  )
                }
              />

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
