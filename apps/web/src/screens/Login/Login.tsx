import { useEffect, useRef, useState, type FormEvent } from 'react';
import { isSignInGateEntry, useNavigation } from '../../lib/navigation.js';
import { useAuth } from '../../lib/authContext.js';
import { ApiError, requestMagicLink, verifyMagicLink, vkLoginUrl } from '../../lib/api.js';
import { telegramErrorMessage } from '../../lib/telegramErrors.js';
import { Button } from '../../ui/Button/Button.js';
import { Input } from '../../ui/Input/Input.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { Logo } from '../../ui/Logo/Logo.js';
import { VkIcon } from '../../ui/VkIcon/VkIcon.js';
import { clsx } from '../../lib/clsx.js';
import styles from './Login.module.css';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// How long the "Готово!" success state shows before auto-redirecting
// into the trainer — long enough to register as a real confirmation,
// short enough that the redirect still feels automatic, not stalled.
const SUCCESS_REDIRECT_DELAY_MS = 1200;

const benefits = [
  '10 000+ заданий по всем предметам ЕГЭ',
  'Разбор ошибок и персональные рекомендации',
  'Прогресс и статистика сохраняются навсегда',
];

/**
 * Unified sign-up/sign-in screen (S3 auth) — one flow for new and
 * returning users alike (email magic-link + VK ID), matching the
 * backend's own find-or-create identity resolution: there is no
 * separate "create account" vs "log in" step server-side, so this
 * screen doesn't pretend there is one either.
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

  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
    if (user && verifyState === 'idle') {
      navigate({ screen: 'home' }, { replace: true });
    }
  }, [user, verifyState, navigate]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return; // double-submit guard
    const trimmed = email.trim();
    if (!EMAIL_PATTERN.test(trimmed)) {
      setFieldError('Введите корректный email');
      return;
    }
    setFieldError(null);
    setFormError(null);
    setSubmitting(true);
    try {
      await requestMagicLink(trimmed);
      setSent(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) {
        setFormError(
          'Отправка писем сейчас недоступна — попробуйте позже или войдите через VK ID.',
        );
      } else if (error instanceof ApiError && error.status === 429) {
        setFormError('Слишком много попыток. Подождите немного и попробуйте снова.');
      } else {
        setFormError('Не удалось отправить письмо. Проверьте email и попробуйте снова.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleVkClick() {
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
                Без пароля: продолжите через VK ID или получите ссылку для входа на почту.
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
              <p className={clsx('text-h3', styles.stateTitle)}>Готово!</p>
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

          {verifyState === 'idle' && sent && (
            <div className={styles.statePanel}>
              <Icon name="mail" size={40} className={styles.stateIconSuccess} />
              <p className={clsx('text-h3', styles.stateTitle)}>Проверьте почту</p>
              <p className={styles.stateText}>
                Мы отправили на <strong>{email.trim()}</strong> письмо со ссылкой для входа — это
                ссылка, не код: просто откройте её, чтобы войти. Ссылка действует 15 минут.
              </p>
              <Button variant="secondary" fullWidth onClick={() => setSent(false)}>
                Отправить другое письмо
              </Button>
            </div>
          )}

          {verifyState === 'idle' && !sent && (
            <>
              {vkCancelled && (
                <p role="status" className={styles.formError}>
                  Вход через VK ID отменён. Попробуйте ещё раз или войдите по почте.
                </p>
              )}
              <Button
                variant="secondary"
                fullWidth
                className={styles.vkButton}
                onClick={handleVkClick}
              >
                <VkIcon size={20} /> Продолжить через VK ID
              </Button>

              <div className={styles.divider}>
                <span>или</span>
              </div>

              <form onSubmit={handleSubmit} className={styles.form} noValidate>
                <Input
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  label="Email"
                  placeholder="you@example.com"
                  leadingIcon="mail"
                  value={email}
                  disabled={submitting}
                  errorText={fieldError ?? undefined}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (fieldError) setFieldError(null);
                  }}
                />
                {formError && <p className={styles.formError}>{formError}</p>}
                {telegramError && (
                  <p role="alert" className={styles.formError}>
                    {telegramErrorMessage(telegramError)}
                  </p>
                )}
                <Button type="submit" fullWidth loading={submitting}>
                  Продолжить с почтой
                </Button>
              </form>

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
