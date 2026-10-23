import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import { Login } from './Login.js';
import { makeAuthUser, TestAuthProvider } from '../../lib/authTestUtils.js';
import { ApiError } from '../../lib/api.js';
import * as api from '../../lib/api.js';
import type * as ApiModule from '../../lib/api.js';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../../lib/api.js');
  return {
    ...actual,
    getCurrentUser: vi.fn(() => Promise.resolve({ user: null })),
    requestMagicLink: vi.fn(),
    verifyMagicLink: vi.fn(),
    registerWithEmail: vi.fn(),
    confirmRegistration: vi.fn(),
    resendConfirmation: vi.fn(),
    loginWithPassword: vi.fn(),
    requestPasswordReset: vi.fn(),
    checkPasswordResetToken: vi.fn(),
    resetPassword: vi.fn(),
    vkLoginUrl: vi.fn(() => 'https://api.test/api/v1/auth/vk/start'),
  };
});

function renderLogin(path = '/login') {
  window.history.pushState(null, '', path);
  return render(
    <NavigationProvider>
      <Login />
    </NavigationProvider>,
  );
}

describe('Login — layout', () => {
  it('shows the headline, VK ID, the Вход/Регистрация tabs, email + password and consent text', () => {
    renderLogin();
    expect(screen.getByText('Войти или создать аккаунт')).toBeInTheDocument();
    expect(screen.getByText('Продолжить через VK ID')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Вход' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Регистрация' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Пароль')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Забыли пароль?' })).toBeInTheDocument();
    expect(screen.getByText(/условиями использования/)).toBeInTheDocument();
  });

  it('?mode=register opens the registration tab', () => {
    renderLogin('/login?mode=register');
    expect(screen.getByRole('tab', { name: 'Регистрация' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Зарегистрироваться' })).toBeInTheDocument();
  });
});

describe('Login — theme', () => {
  it('follows the site theme instead of forcing its own (same flow in light and dark)', async () => {
    const { setTheme } = await import('../../lib/theme.js');
    for (const theme of ['light', 'dark'] as const) {
      setTheme(theme);
      const { container, unmount } = renderLogin();
      expect(container.querySelector('[data-theme]')).toBeNull();
      expect(container.querySelector('[style*="--color"]')).toBeNull();
      expect(document.documentElement).toHaveAttribute('data-theme', theme);
      expect(screen.getByText('Продолжить через VK ID')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument();
      unmount();
    }
  });
});

describe('Login — password sign-in', () => {
  it('validates on the client before calling the API', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    expect(screen.getByText('Введите корректный email')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'student@example.com');
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    expect(screen.getByText('Введите пароль')).toBeInTheDocument();
    expect(api.loginWithPassword).not.toHaveBeenCalled();
  });

  it('signs in and shows the success state', async () => {
    vi.mocked(api.loginWithPassword).mockResolvedValue({ user: makeAuthUser() });
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText('Email'), ' student@example.com ');
    await user.type(screen.getByLabelText('Пароль'), 'Ege2026-strong');
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    await waitFor(() => expect(screen.getByText('Готово!')).toBeInTheDocument());
    expect(api.loginWithPassword).toHaveBeenCalledWith('student@example.com', 'Ege2026-strong');
  });

  it('a wrong password gets one neutral message that also mentions confirmation', async () => {
    vi.mocked(api.loginWithPassword).mockRejectedValue(
      new ApiError(401, { error: 'invalid_credentials' }),
    );
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText('Email'), 'student@example.com');
    await user.type(screen.getByLabelText('Пароль'), 'whatever-1');
    await user.click(screen.getByRole('button', { name: 'Войти' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Неверная почта или пароль');
    expect(screen.getByRole('alert')).toHaveTextContent('подтвердите почту');
  });

  it('can show the password and blocks a double submit', async () => {
    let resolve: (() => void) | undefined;
    vi.mocked(api.loginWithPassword).mockImplementation(
      () => new Promise((r) => (resolve = () => r({ user: makeAuthUser() }))),
    );
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText('Email'), 'student@example.com');
    await user.type(screen.getByLabelText('Пароль'), 'Ege2026-strong');
    await user.click(screen.getByRole('button', { name: 'Показать пароль' }));
    expect(screen.getByLabelText('Пароль')).toHaveAttribute('type', 'text');
    const submit = screen.getByRole('button', { name: 'Войти' });
    await user.click(submit);
    await user.click(submit);
    expect(api.loginWithPassword).toHaveBeenCalledTimes(1);
    resolve?.();
  });
});

describe('Login — registration', () => {
  async function register(email = 'new@example.com', password = 'Ege2026-strong') {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('tab', { name: 'Регистрация' }));
    await user.type(screen.getByLabelText('Email'), email);
    await user.type(screen.getByLabelText('Пароль'), password);
    await user.click(screen.getByRole('button', { name: 'Зарегистрироваться' }));
    return user;
  }

  it('sends the registration and shows «Подтвердите почту» with a timed resend', async () => {
    vi.mocked(api.registerWithEmail).mockResolvedValue({ ok: true });
    await register();
    expect(await screen.findByText('Подтвердите почту')).toBeInTheDocument();
    expect(screen.getByText(/new@example\.com/)).toBeInTheDocument();
    expect(api.registerWithEmail).toHaveBeenCalledWith('new@example.com', 'Ege2026-strong');
    expect(screen.getByRole('button', { name: /Отправить ещё раз через \d+ сек/ })).toBeDisabled();
  });

  it('too short a password is caught before the API', async () => {
    await register('new@example.com', 'short');
    expect(screen.getByText(/не короче 8 символов/)).toBeInTheDocument();
    expect(api.registerWithEmail).not.toHaveBeenCalled();
  });

  it('shows the server password rule', async () => {
    vi.mocked(api.registerWithEmail).mockRejectedValue(
      new ApiError(400, { error: 'weak_password', problem: 'too_simple' }),
    );
    await register('new@example.com', '12345678');
    expect(await screen.findByText(/Пароль слишком простой/)).toBeInTheDocument();
  });

  it('never claims a letter was sent when sending is unavailable or fails', async () => {
    vi.mocked(api.registerWithEmail).mockRejectedValueOnce(
      new ApiError(503, { error: 'email_not_configured' }),
    );
    const user = await register();
    expect(await screen.findByRole('alert')).toHaveTextContent('Отправка писем сейчас недоступна');
    expect(screen.queryByText('Подтвердите почту')).not.toBeInTheDocument();

    vi.mocked(api.registerWithEmail).mockRejectedValueOnce(
      new ApiError(502, { error: 'email_send_failed' }),
    );
    await user.click(screen.getByRole('button', { name: 'Зарегистрироваться' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось отправить письмо');

    vi.mocked(api.registerWithEmail).mockRejectedValueOnce(
      new ApiError(429, { error: 'too_many_requests', retryAfterSeconds: 42 }),
    );
    await user.click(screen.getByRole('button', { name: 'Зарегистрироваться' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('через 42 сек');
  });
});

describe('Login — confirmation link (?confirm=)', () => {
  it('confirms, signs in and says the address is confirmed', async () => {
    vi.mocked(api.confirmRegistration).mockResolvedValue({ user: makeAuthUser() });
    renderLogin('/login?confirm=tok-123');
    expect(screen.getByText('Подтверждаем почту…')).toBeInTheDocument();
    expect(await screen.findByText('Почта подтверждена!')).toBeInTheDocument();
    expect(api.confirmRegistration).toHaveBeenCalledTimes(1);
  });

  it('an expired link offers a new letter', async () => {
    vi.mocked(api.confirmRegistration).mockRejectedValue(
      new ApiError(410, { error: 'token_expired' }),
    );
    vi.mocked(api.resendConfirmation).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderLogin('/login?confirm=old-token-123');
    expect(await screen.findByText('Срок действия ссылки истёк')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Отправить новое письмо' }));
    expect(api.resendConfirmation).toHaveBeenCalledWith({ token: 'old-token-123' });
    expect(await screen.findByText(/мы отправили новое письмо/)).toBeInTheDocument();
  });

  it('a used link and an existing account are explained', async () => {
    vi.mocked(api.confirmRegistration).mockRejectedValueOnce(
      new ApiError(409, { error: 'already_registered' }),
    );
    const { unmount } = renderLogin('/login?confirm=t1-xxxxxxxxxxxxxxx');
    expect(await screen.findByText('Аккаунт уже есть')).toBeInTheDocument();
    unmount();
    vi.mocked(api.confirmRegistration).mockRejectedValueOnce(
      new ApiError(400, { error: 'invalid_or_used_token' }),
    );
    renderLogin('/login?confirm=t2-xxxxxxxxxxxxxxx');
    expect(await screen.findByText('Ссылка недействительна')).toBeInTheDocument();
  });
});

describe('Login — password reset', () => {
  it('requests a reset link with a neutral confirmation', async () => {
    vi.mocked(api.requestPasswordReset).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: 'Забыли пароль?' }));
    await user.type(screen.getByLabelText('Email'), 'student@example.com');
    await user.click(screen.getByRole('button', { name: 'Отправить ссылку' }));
    expect(await screen.findByText(/Если аккаунт с этим адресом есть/)).toBeInTheDocument();
    expect(api.requestPasswordReset).toHaveBeenCalledWith('student@example.com');
  });

  it('?reset= checks the link, takes a new password and signs in', async () => {
    vi.mocked(api.checkPasswordResetToken).mockResolvedValue({ ok: true });
    vi.mocked(api.resetPassword).mockResolvedValue({ user: makeAuthUser() });
    const user = userEvent.setup();
    renderLogin('/login?reset=reset-token-123');
    await user.type(await screen.findByLabelText('Новый пароль'), 'Brand-new-pass-7');
    await user.click(screen.getByRole('button', { name: 'Сохранить пароль' }));
    expect(await screen.findByText('Пароль изменён!')).toBeInTheDocument();
    expect(api.resetPassword).toHaveBeenCalledWith('reset-token-123', 'Brand-new-pass-7');
  });

  it('an expired reset link leads back to the request form', async () => {
    vi.mocked(api.checkPasswordResetToken).mockRejectedValue(
      new ApiError(410, { error: 'token_expired' }),
    );
    const user = userEvent.setup();
    renderLogin('/login?reset=reset-token-old');
    expect(await screen.findByText('Срок действия ссылки истёк')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Запросить новую ссылку' }));
    expect(screen.getByText('Восстановление пароля')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отправить ссылку' })).toBeInTheDocument();
  });
});

describe('Login — passwordless link (kept)', () => {
  it('still sends a sign-in link from «Войти по ссылке без пароля»', async () => {
    vi.mocked(api.requestMagicLink).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole('button', { name: 'Войти по ссылке без пароля' }));
    await user.type(screen.getByLabelText('Email'), '  student@example.com  ');
    await user.click(screen.getByRole('button', { name: 'Получить ссылку для входа' }));
    await waitFor(() => expect(screen.getByText('Проверьте почту')).toBeInTheDocument());
    expect(api.requestMagicLink).toHaveBeenCalledWith('student@example.com');
    expect(screen.getByText(/это ссылка, не код/)).toBeInTheDocument();
  });
});

describe('Login — magic-link verification (?token=...)', () => {
  it('shows a loading state, then success, then auto-redirects into the trainer using the real server session', async () => {
    vi.mocked(api.verifyMagicLink).mockResolvedValue({
      user: makeAuthUser({ id: 'u1', email: 'student@example.com' }),
    });
    renderLogin('/login?token=good-token');
    expect(screen.getByText('Входим…')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Готово!')).toBeInTheDocument());
    expect(api.verifyMagicLink).toHaveBeenCalledWith('good-token');
  });

  it('shows an honest error state when the token is invalid/expired, never a fake success', async () => {
    vi.mocked(api.verifyMagicLink).mockRejectedValue(
      new ApiError(400, { error: 'invalid_or_expired_token' }),
    );
    renderLogin('/login?token=bad-token');
    await waitFor(() => expect(screen.getByText('Ссылка недействительна')).toBeInTheDocument());
    expect(screen.queryByText('Готово!')).not.toBeInTheDocument();
  });
});

describe('Login — Telegram Mini App sign-in failure', () => {
  function renderWithTelegramError(code: string | null) {
    window.history.pushState(null, '', '/login');
    return render(
      <NavigationProvider>
        <TestAuthProvider user={null} telegramError={code}>
          <Login />
        </TestAuthProvider>
      </NavigationProvider>,
    );
  }

  it('says why, with the code, instead of one sentence for every failure', () => {
    renderWithTelegramError('telegram_not_configured');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('ещё не включён на сервере');
    expect(alert).toHaveTextContent('(код: telegram_not_configured)');
  });

  it('shows nothing about Telegram when no Telegram sign-in failed', () => {
    renderWithTelegramError(null);
    expect(screen.queryByText(/Telegram/)).not.toBeInTheDocument();
  });
});

/**
 * The "×" used to call `history.back()`: with nothing of the app behind the
 * screen (opened by URL, refreshed, back from VK) it left the site, and on top
 * of a private URL it bounced into the same redirect. It must always close the
 * screen and leave the visitor inside the app, on the public Home.
 */
describe('Login — the close (×) button', () => {
  function Where() {
    const { tab, overlay } = useNavigation();
    return <p data-testid="where">{`${tab}:${overlay?.screen ?? 'none'}`}</p>;
  }
  function renderAt(path: string, withHistoryBehind = false) {
    window.history.replaceState(null, '', '/');
    if (withHistoryBehind) window.history.pushState(null, '', path);
    else window.history.replaceState(null, '', path);
    return render(
      <NavigationProvider>
        <Login />
        <Where />
      </NavigationProvider>,
    );
  }

  it('is a real, named, non-submitting button reachable by keyboard', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    const close = screen.getByRole('button', { name: 'Закрыть' });
    expect(close).toHaveAttribute('type', 'button');

    // It sits inside no <form>, and using it never triggers form validation.
    expect(close.closest('form')).toBeNull();
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(close);
    expect(screen.queryByText('Введите корректный email')).not.toBeInTheDocument();
    expect(api.requestMagicLink).not.toHaveBeenCalled();
  });

  it('opened directly by URL (nothing behind it): closes to the public Home in place — never about:blank, no extra entry', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    const length = window.history.length;
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(window.location.pathname).toBe('/');
    expect(screen.getByTestId('where')).toHaveTextContent('home:none');
    expect(window.history.length).toBe(length);
  });

  it('works every time it is pressed, not just the first', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      window.history.replaceState(null, '', '/login');
      window.dispatchEvent(new PopStateEvent('popstate'));
      await user.click(await screen.findByRole('button', { name: 'Закрыть' }));
      expect(window.location.pathname).toBe('/');
    }
  });

  it('opened from a public page of the app: goes back to it (a real Back)', async () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const user = userEvent.setup();
    function OpenFromHome() {
      const { navigate } = useNavigation();
      return <button onClick={() => navigate({ screen: 'login' })}>open</button>;
    }
    window.history.replaceState(null, '', '/');
    render(
      <NavigationProvider>
        <OpenFromHome />
        <Login />
      </NavigationProvider>,
    );
    await user.click(screen.getByText('open'));
    expect(window.location.pathname).toBe('/login');
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(back).toHaveBeenCalledTimes(1);
    back.mockRestore();
  });

  it('is operable with Enter and Space', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    screen.getByRole('button', { name: 'Закрыть' }).focus();
    await user.keyboard('{Enter}');
    expect(window.location.pathname).toBe('/');

    window.history.replaceState(null, '', '/login');
    window.dispatchEvent(new PopStateEvent('popstate'));
    (await screen.findByRole('button', { name: 'Закрыть' })).focus();
    await user.keyboard(' ');
    expect(window.location.pathname).toBe('/');
  });

  it('is the topmost element at its own position (nothing decorative sits over it)', () => {
    renderAt('/login');
    const close = screen.getByRole('button', { name: 'Закрыть' });
    // jsdom has no layout, so assert the structural guarantees instead: the
    // button is a direct child of the page root and comes before the
    // decorative rays, which are aria-hidden.
    const page = close.parentElement!;
    const rays = [...page.querySelectorAll('[aria-hidden="true"]')];
    expect(rays.length).toBeGreaterThan(0);
    for (const ray of rays) expect(ray.contains(close)).toBe(false);
  });
});

describe('Login — leaving after a successful sign-in', () => {
  it('replaces the sign-in entry, so Back afterwards does not return to the sign-in page', async () => {
    window.history.replaceState(null, '', '/login');
    const length = window.history.length;
    render(
      <NavigationProvider>
        <TestAuthProvider user={makeAuthUser()}>
          <Login />
        </TestAuthProvider>
      </NavigationProvider>,
    );
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(window.history.length).toBe(length);
  });
});

describe('Login — returning from a cancelled VK ID consent (?vk=cancelled)', () => {
  it('says the sign-in was cancelled, keeps the form usable and cleans the flag from the address', async () => {
    renderLogin('/login?vk=cancelled');
    expect(screen.getByRole('status')).toHaveTextContent('Вход через VK ID отменён');
    expect(screen.getByRole('button', { name: /Продолжить через VK ID/ })).toBeEnabled();
    expect(screen.getByLabelText('Email')).toBeEnabled();
    await waitFor(() => expect(window.location.search).toBe(''));
    expect(window.location.pathname).toBe('/login');
    // The message stays for this visit even though the flag left the URL.
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows no such message on a normal visit', () => {
    renderLogin('/login');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('ignores any other value of the flag', () => {
    renderLogin('/login?vk=%3Cb%3Ehi%3C/b%3E');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('Login — VK ID on the regular website', () => {
  it('is the usual full-page redirect to the API start URL (no Telegram handoff)', async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...original,
        search: '',
        set href(url: string) {
          assign(url);
        },
      },
    });
    try {
      renderLogin();
      await user.click(screen.getByRole('button', { name: /Продолжить через VK ID/ }));
      expect(assign).toHaveBeenCalledWith('https://api.test/api/v1/auth/vk/start');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });
});
