import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@zybrilka/shared';
import {
  ApiError,
  checkPasswordResetToken,
  confirmRegistration,
  loginWithPassword,
  registerWithEmail,
  requestMagicLink,
  requestPasswordReset,
  resendConfirmation,
  resetPassword,
} from '../../lib/api.js';
import { Button } from '../../ui/Button/Button.js';
import { Icon } from '../../ui/Icon/Icon.js';
import { Input } from '../../ui/Input/Input.js';
import { clsx } from '../../lib/clsx.js';
import styles from './Login.module.css';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EmailMode = 'signin' | 'register' | 'forgot' | 'magic';

function errorCode(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const body = error.body as { error?: unknown } | null;
  return typeof body?.error === 'string' ? body.error : null;
}

function retryAfter(error: unknown): number | null {
  if (!(error instanceof ApiError)) return null;
  const value = (error.body as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;
  return typeof value === 'number' ? value : null;
}

const passwordProblems: Record<string, string> = {
  too_short: `Пароль должен быть не короче ${PASSWORD_MIN_LENGTH} символов.`,
  too_long: `Пароль должен быть не длиннее ${PASSWORD_MAX_LENGTH} символов.`,
  too_simple: 'Пароль слишком простой — добавьте разных букв, цифр или символов.',
};

/** One human message for every failure of the email flows — never a raw
 * server or SMTP text. */
export function emailErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';
  }
  const code = errorCode(error);
  if (code === 'weak_password') {
    const problem = (error.body as { problem?: string }).problem ?? '';
    return passwordProblems[problem] ?? 'Пароль не подходит.';
  }
  if (error.status === 429) {
    const wait = retryAfter(error);
    return wait
      ? `Слишком часто. Попробуйте снова через ${wait} сек.`
      : 'Слишком много попыток. Подождите немного и попробуйте снова.';
  }
  if (code === 'email_not_configured') {
    return 'Отправка писем сейчас недоступна. Попробуйте позже или войдите через VK ID.';
  }
  if (code === 'email_send_failed') {
    return 'Не удалось отправить письмо. Попробуйте ещё раз чуть позже.';
  }
  if (error.status === 400) return 'Проверьте введённые данные.';
  return 'Что-то пошло не так. Попробуйте ещё раз.';
}

function PasswordInput({
  value,
  onChange,
  label,
  autoComplete,
  disabled,
  errorText,
  helperText,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  autoComplete: 'current-password' | 'new-password';
  disabled: boolean;
  errorText?: string;
  helperText?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className={styles.passwordField}>
      <Input
        type={shown ? 'text' : 'password'}
        autoComplete={autoComplete}
        label={label}
        leadingIcon="lock"
        value={value}
        disabled={disabled}
        maxLength={PASSWORD_MAX_LENGTH}
        errorText={errorText}
        helperText={helperText}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className={styles.showPassword}
        aria-pressed={shown}
        onClick={() => setShown((v) => !v)}
      >
        {shown ? 'Скрыть пароль' : 'Показать пароль'}
      </button>
    </div>
  );
}

function SentPanel({
  title,
  children,
  onBack,
  backLabel,
  action,
}: {
  title: string;
  children: ReactNode;
  onBack: () => void;
  backLabel: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.statePanel} role="status">
      <Icon name="mail" size={40} className={styles.stateIconSuccess} />
      <p className={clsx('text-h3', styles.stateTitle)}>{title}</p>
      <div className={styles.stateText}>{children}</div>
      {action}
      <Button variant="secondary" fullWidth onClick={onBack}>
        {backLabel}
      </Button>
    </div>
  );
}

/** "Отправить ещё раз" with a short cool-down so it can't be hammered. */
function ResendButton({ onResend }: { onResend: () => Promise<void> }) {
  const [wait, setWait] = useState(60);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (wait <= 0) return;
    const id = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(id);
  }, [wait]);
  return (
    <>
      <Button
        fullWidth
        variant="secondary"
        loading={busy}
        disabled={wait > 0}
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          setNote(null);
          try {
            await onResend();
            setNote({ ok: true, text: 'Отправили ещё одно письмо.' });
            setWait(60);
          } catch (error) {
            setNote({ ok: false, text: emailErrorMessage(error) });
            setWait(retryAfter(error) ?? 0);
          } finally {
            setBusy(false);
          }
        }}
      >
        {wait > 0 ? `Отправить ещё раз через ${wait} сек.` : 'Отправить письмо ещё раз'}
      </Button>
      {note && (
        <p
          role={note.ok ? 'status' : 'alert'}
          className={note.ok ? styles.formNote : styles.formError}
        >
          {note.text}
        </p>
      )}
    </>
  );
}

type Sent = { kind: 'register' | 'forgot' | 'magic'; email: string } | null;

/**
 * Email sign-in, registration, password reset request and the
 * passwordless link — one card, a few tabs. Every number and outcome comes
 * from the server; buttons lock while a request is in flight.
 */
export function EmailAuthForms({
  initialMode = 'signin',
  onSignedIn,
  extraError,
}: {
  initialMode?: EmailMode;
  onSignedIn: (title: string) => Promise<void>;
  extraError?: ReactNode;
}) {
  const [mode, setMode] = useState<EmailMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState<Sent>(null);

  function switchMode(next: EmailMode) {
    setMode(next);
    setFormError(null);
    setEmailError(null);
    setPasswordError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const trimmed = email.trim();
    if (!EMAIL_PATTERN.test(trimmed)) {
      setEmailError('Введите корректный email');
      return;
    }
    const needsPassword = mode === 'signin' || mode === 'register';
    if (needsPassword && password.length === 0) {
      setPasswordError('Введите пароль');
      return;
    }
    if (mode === 'register' && password.length < PASSWORD_MIN_LENGTH) {
      setPasswordError(passwordProblems.too_short!);
      return;
    }
    setEmailError(null);
    setPasswordError(null);
    setFormError(null);
    setSubmitting(true);
    try {
      if (mode === 'signin') {
        await loginWithPassword(trimmed, password);
        await onSignedIn('Готово!');
        return;
      }
      if (mode === 'register') await registerWithEmail(trimmed, password);
      if (mode === 'forgot') await requestPasswordReset(trimmed);
      if (mode === 'magic') await requestMagicLink(trimmed);
      setPassword('');
      setSent({ kind: mode, email: trimmed });
    } catch (error) {
      if (mode === 'signin' && error instanceof ApiError && error.status === 401) {
        setFormError(
          'Неверная почта или пароль. Если вы только что зарегистрировались — сначала подтвердите почту по ссылке из письма.',
        );
      } else if (errorCode(error) === 'weak_password') {
        setPasswordError(emailErrorMessage(error));
      } else {
        setFormError(emailErrorMessage(error));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    const back = () => {
      setSent(null);
      switchMode(sent.kind === 'register' ? 'signin' : sent.kind);
    };
    if (sent.kind === 'register') {
      return (
        <SentPanel
          title="Подтвердите почту"
          onBack={back}
          backLabel="Я подтвердил — войти"
          action={
            <ResendButton
              onResend={() => resendConfirmation({ email: sent.email }).then(() => {})}
            />
          }
        >
          <p>
            Мы отправили письмо на <strong>{sent.email}</strong>. Откройте ссылку из него, чтобы
            закончить регистрацию. Ссылка действует 24 часа.
          </p>
          <p>Не видите письма? Проверьте папку «Спам».</p>
        </SentPanel>
      );
    }
    if (sent.kind === 'forgot') {
      return (
        <SentPanel
          title="Проверьте почту"
          onBack={back}
          backLabel="Назад"
          action={<ResendButton onResend={() => requestPasswordReset(sent.email).then(() => {})} />}
        >
          <p>
            Мы отправили письмо на <strong>{sent.email}</strong>. Если аккаунт с этим адресом есть,
            в письме будет ссылка для нового пароля — она действует 1 час.
          </p>
        </SentPanel>
      );
    }
    return (
      <SentPanel title="Проверьте почту" onBack={back} backLabel="Отправить другое письмо">
        <p>
          Мы отправили на <strong>{sent.email}</strong> письмо со ссылкой для входа — это ссылка, не
          код: просто откройте её, чтобы войти. Ссылка действует 15 минут.
        </p>
      </SentPanel>
    );
  }

  const tabs = mode === 'signin' || mode === 'register';
  const submitLabel = {
    signin: 'Войти',
    register: 'Зарегистрироваться',
    forgot: 'Отправить ссылку',
    magic: 'Получить ссылку для входа',
  }[mode];

  return (
    <div className={styles.emailBlock}>
      {tabs ? (
        <div className={styles.modeTabs} role="tablist" aria-label="Вход или регистрация">
          {(['signin', 'register'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={styles.modeTab}
              onClick={() => switchMode(m)}
            >
              {m === 'signin' ? 'Вход' : 'Регистрация'}
            </button>
          ))}
        </div>
      ) : (
        <div className={styles.modeHeader}>
          <button type="button" className={styles.linkButton} onClick={() => switchMode('signin')}>
            ← Ко входу
          </button>
          <p className={clsx('text-h3', styles.stateTitle)}>
            {mode === 'forgot' ? 'Восстановление пароля' : 'Вход по ссылке'}
          </p>
          <p className={styles.stateText}>
            {mode === 'forgot'
              ? 'Укажите почту аккаунта — пришлём ссылку, чтобы задать новый пароль.'
              : 'Без пароля: пришлём на почту одноразовую ссылку для входа.'}
          </p>
        </div>
      )}

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
          errorText={emailError ?? undefined}
          onChange={(event) => {
            setEmail(event.target.value);
            if (emailError) setEmailError(null);
          }}
        />
        {(mode === 'signin' || mode === 'register') && (
          <PasswordInput
            label="Пароль"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            disabled={submitting}
            errorText={passwordError ?? undefined}
            helperText={
              mode === 'register' ? `Не меньше ${PASSWORD_MIN_LENGTH} символов` : undefined
            }
            onChange={(value) => {
              setPassword(value);
              if (passwordError) setPasswordError(null);
            }}
          />
        )}
        {formError && (
          <p role="alert" className={styles.formError}>
            {formError}
          </p>
        )}
        {extraError}
        <Button type="submit" fullWidth loading={submitting}>
          {submitLabel}
        </Button>
      </form>

      {mode === 'signin' && (
        <div className={styles.altLinks}>
          <button type="button" className={styles.linkButton} onClick={() => switchMode('forgot')}>
            Забыли пароль?
          </button>
          <button type="button" className={styles.linkButton} onClick={() => switchMode('magic')}>
            Войти по ссылке без пароля
          </button>
        </div>
      )}
    </div>
  );
}

type LinkState =
  | { status: 'checking' }
  | { status: 'resetForm' }
  | { status: 'expired' }
  | { status: 'invalid' }
  | { status: 'alreadyRegistered' }
  | { status: 'error'; message: string };

/**
 * The page an emailed link opens: `?confirm=` (finish registration) or
 * `?reset=` (set a new password). The token goes to the server once; the
 * outcome decides the screen — expired links offer a new letter.
 */
export function EmailLinkFlow({
  kind,
  token,
  onSignedIn,
  onDone,
}: {
  kind: 'confirm' | 'reset';
  token: string;
  onSignedIn: (title: string) => Promise<void>;
  /** Leave the link page for the normal forms (optionally a given tab). */
  onDone: (mode?: EmailMode) => void;
}) {
  const [state, setState] = useState<LinkState>({ status: 'checking' });
  const started = useRef(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function outcome(error: unknown): LinkState {
    const code = errorCode(error);
    if (code === 'token_expired') return { status: 'expired' };
    if (code === 'invalid_or_used_token') return { status: 'invalid' };
    if (code === 'already_registered') return { status: 'alreadyRegistered' };
    return { status: 'error', message: emailErrorMessage(error) };
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const run =
      kind === 'confirm'
        ? confirmRegistration(token).then(() => onSignedIn('Почта подтверждена!'))
        : checkPasswordResetToken(token).then(() => setState({ status: 'resetForm' }));
    run.catch((error: unknown) => setState(outcome(error)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per link
  }, []);

  async function submitReset(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (password.length < PASSWORD_MIN_LENGTH) {
      setPasswordError(passwordProblems.too_short!);
      return;
    }
    setSubmitting(true);
    setPasswordError(null);
    try {
      await resetPassword(token, password);
      await onSignedIn('Пароль изменён!');
    } catch (error) {
      if (errorCode(error) === 'weak_password') setPasswordError(emailErrorMessage(error));
      else setState(outcome(error));
    } finally {
      setSubmitting(false);
    }
  }

  if (state.status === 'checking') {
    return (
      <div className={styles.statePanel} role="status">
        <Icon name="spinner" size={32} className={styles.stateSpinner} />
        <p className={clsx('text-h3', styles.stateTitle)}>
          {kind === 'confirm' ? 'Подтверждаем почту…' : 'Проверяем ссылку…'}
        </p>
      </div>
    );
  }

  if (state.status === 'resetForm') {
    return (
      <form onSubmit={submitReset} className={styles.form} noValidate>
        <p className={clsx('text-h3', styles.stateTitle)}>Новый пароль</p>
        <p className={styles.stateText}>
          После сохранения вы войдёте в аккаунт, а на других устройствах нужно будет войти заново.
        </p>
        <PasswordInput
          label="Новый пароль"
          autoComplete="new-password"
          value={password}
          disabled={submitting}
          errorText={passwordError ?? undefined}
          helperText={`Не меньше ${PASSWORD_MIN_LENGTH} символов`}
          onChange={(value) => {
            setPassword(value);
            if (passwordError) setPasswordError(null);
          }}
        />
        <Button type="submit" fullWidth loading={submitting}>
          Сохранить пароль
        </Button>
      </form>
    );
  }

  if (state.status === 'expired') {
    return (
      <div className={styles.statePanel} role="alert">
        <Icon name="time" size={40} className={styles.stateIconError} />
        <p className={clsx('text-h3', styles.stateTitle)}>Срок действия ссылки истёк</p>
        {kind === 'confirm' ? (
          <>
            <p className={styles.stateText}>
              Отправим новое письмо для подтверждения на тот же адрес.
            </p>
            <ResendButtonImmediate onResend={() => resendConfirmation({ token }).then(() => {})} />
          </>
        ) : (
          <>
            <p className={styles.stateText}>Запросите восстановление пароля ещё раз.</p>
            <Button fullWidth onClick={() => onDone('forgot')}>
              Запросить новую ссылку
            </Button>
          </>
        )}
      </div>
    );
  }

  const messages = {
    invalid: {
      title: 'Ссылка недействительна',
      text:
        kind === 'confirm'
          ? 'Похоже, ссылка уже использована — если почта подтверждена, просто войдите.'
          : 'Похоже, ссылка уже использована или устарела. Запросите новую.',
    },
    alreadyRegistered: {
      title: 'Аккаунт уже есть',
      text: 'С этой почтой уже есть аккаунт. Войдите или восстановите пароль.',
    },
    error: { title: 'Не получилось', text: state.status === 'error' ? state.message : '' },
  }[state.status];

  return (
    <div className={styles.statePanel} role="alert">
      <Icon name="errorCircle" size={40} className={styles.stateIconError} />
      <p className={clsx('text-h3', styles.stateTitle)}>{messages.title}</p>
      <p className={styles.stateText}>{messages.text}</p>
      <Button fullWidth onClick={() => onDone(kind === 'reset' ? 'forgot' : 'signin')}>
        {kind === 'reset' ? 'Запросить новую ссылку' : 'Ко входу'}
      </Button>
    </div>
  );
}

/** Like ResendButton, but usable at once (the user is here because the
 * old link expired, not because one was just sent). */
function ResendButtonImmediate({ onResend }: { onResend: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  if (note?.ok) {
    return (
      <p role="status" className={styles.formNote}>
        {note.text}
      </p>
    );
  }
  return (
    <>
      <Button
        fullWidth
        loading={busy}
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          try {
            await onResend();
            setNote({
              ok: true,
              text: 'Если регистрация ещё ждёт подтверждения, мы отправили новое письмо.',
            });
          } catch (error) {
            setNote({ ok: false, text: emailErrorMessage(error) });
          } finally {
            setBusy(false);
          }
        }}
      >
        Отправить новое письмо
      </Button>
      {note && !note.ok && (
        <p role="alert" className={styles.formError}>
          {note.text}
        </p>
      )}
    </>
  );
}
