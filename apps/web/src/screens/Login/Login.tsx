import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigation } from '../../lib/navigation.js';
import { useAuth } from '../../lib/authContext.js';
import { ApiError, requestMagicLink, verifyMagicLink, vkLoginUrl } from '../../lib/api.js';
import { Button } from '../../ui/Button/Button.js';
import { Input } from '../../ui/Input/Input.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { Logo } from '../../ui/Logo/Logo.js';
import { VkIcon } from '../../ui/VkIcon/VkIcon.js';
import { clsx } from '../../lib/clsx.js';
import styles from './Login.module.css';

type AuthTab = 'signup' | 'login';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const tabs: { id: AuthTab; label: string }[] = [
  { id: 'signup', label: 'Создать аккаунт' },
  { id: 'login', label: 'Войти' },
];

const benefits = [
  '10 000+ заданий по всем предметам ЕГЭ',
  'Разбор ошибок и персональные рекомендации',
  'Прогресс и статистика сохраняются навсегда',
];

const copyByTab: Record<
  AuthTab,
  { headline: string; headlineAccent: string; subtext: string; submitLabel: string }
> = {
  signup: {
    headline: 'Создай аккаунт и начни',
    headlineAccent: 'зубрить',
    subtext:
      'Бесплатная регистрация в один клик — без пароля, по ссылке на почту или через ВКонтакте.',
    submitLabel: 'Продолжить',
  },
  login: {
    headline: 'С возвращением —',
    headlineAccent: 'продолжим?',
    subtext: 'Войдите по ссылке на почту или через ВКонтакте — без пароля.',
    submitLabel: 'Продолжить',
  },
};

/**
 * Unified sign-up/sign-in screen (S3 auth) — email magic-link + VK ID.
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
  const { navigate, back } = useNavigation();
  const { user, refresh } = useAuth();

  const [tab, setTab] = useState<AuthTab>('signup');
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const tabRefs = useRef(new Map<AuthTab, HTMLButtonElement>());
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useEffect(() => {
    const el = tabRefs.current.get(tab);
    if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [tab]);

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
      .then(() => {
        setVerifyState('done');
        refresh();
      })
      .catch(() => setVerifyState('error'));
  }, [refresh]);

  // Already signed in (e.g. opened this screen by mistake, or a second
  // tab) — never show a sign-in form to someone already signed in.
  useEffect(() => {
    if (user && verifyState === 'idle') {
      navigate({ screen: 'home' });
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
          'Отправка писем сейчас недоступна — попробуйте позже или войдите через ВКонтакте.',
        );
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
        onClick={() => back()}
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
              <h1 className={styles.headline}>
                {copyByTab[tab].headline}{' '}
                <span className={styles.headlineAccent}>{copyByTab[tab].headlineAccent}</span>
              </h1>
              <p className={styles.subtext}>{copyByTab[tab].subtext}</p>
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
              <p className={styles.stateText}>Вы вошли в Zybrilka.</p>
              <Button fullWidth onClick={() => navigate({ screen: 'home' })}>
                На главную
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
                  window.history.replaceState(null, '', '/login');
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
                Мы отправили ссылку для входа на <strong>{email.trim()}</strong>. Ссылка действует
                15 минут.
              </p>
              <Button variant="secondary" fullWidth onClick={() => setSent(false)}>
                Отправить другое письмо
              </Button>
            </div>
          )}

          {verifyState === 'idle' && !sent && (
            <>
              <div className={styles.tabs} role="tablist" aria-label="Вход или регистрация">
                <span
                  className={styles.tabIndicator}
                  style={{
                    transform: `translateX(${indicator.left}px)`,
                    width: `${indicator.width}px`,
                  }}
                  aria-hidden="true"
                />
                {tabs.map((item) => (
                  <button
                    key={item.id}
                    ref={(el) => {
                      if (el) tabRefs.current.set(item.id, el);
                      else tabRefs.current.delete(item.id);
                    }}
                    type="button"
                    role="tab"
                    aria-selected={tab === item.id}
                    className={styles.tab}
                    onClick={() => {
                      setTab(item.id);
                      setFormError(null);
                      setFieldError(null);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <Button
                variant="secondary"
                fullWidth
                className={styles.vkButton}
                onClick={handleVkClick}
              >
                <VkIcon size={20} /> Продолжить через ВКонтакте
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
                <Button type="submit" fullWidth loading={submitting}>
                  {copyByTab[tab].submitLabel}
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
