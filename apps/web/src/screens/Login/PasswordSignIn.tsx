import { useState, type FormEvent } from 'react';
import { ApiError, loginWithPassword } from '../../lib/api.js';
import { Button } from '../../ui/Button/Button.js';
import { Input } from '../../ui/Input/Input.js';
import styles from './Login.module.css';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sign-in for accounts that already have an email + password. There is no
 * registration, confirmation letter or password reset any more (no mail is
 * sent — docs/YANDEX_ID.md); new accounts use VK ID, Yandex ID or Telegram.
 */
export function PasswordSignIn({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const trimmed = email.trim();
    if (!EMAIL_PATTERN.test(trimmed)) {
      setError('Введите корректный email');
      return;
    }
    if (!password) {
      setError('Введите пароль');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await loginWithPassword(trimmed, password);
      await onSignedIn();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Неверная почта или пароль.');
      } else if (err instanceof ApiError && err.status === 429) {
        setError('Слишком много попыток. Подождите немного и попробуйте снова.');
      } else {
        setError('Не удалось войти. Проверьте соединение и попробуйте ещё раз.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
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
        onChange={(event) => setEmail(event.target.value)}
      />
      <div className={styles.passwordField}>
        <Input
          type={shown ? 'text' : 'password'}
          autoComplete="current-password"
          label="Пароль"
          leadingIcon="lock"
          value={password}
          disabled={submitting}
          onChange={(event) => setPassword(event.target.value)}
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
      {error && (
        <p role="alert" className={styles.formError}>
          {error}
        </p>
      )}
      <Button type="submit" fullWidth loading={submitting}>
        Войти
      </Button>
    </form>
  );
}
