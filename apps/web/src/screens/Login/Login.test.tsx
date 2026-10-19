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

describe('Login — unified layout (no separate signup/login tabs)', () => {
  it('shows one fixed headline, the VK ID button, the email form and consent text', () => {
    renderLogin();
    expect(screen.getByText('Войти или создать аккаунт')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByText('Продолжить через VK ID')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Продолжить с почтой' })).toBeInTheDocument();
    expect(screen.getByText(/условиями использования/)).toBeInTheDocument();
    // No tab control at all — one unified flow for new and returning users.
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });
});

describe('Login — theme', () => {
  it('follows the site theme instead of forcing its own (same flow in light and dark)', async () => {
    const { setTheme } = await import('../../lib/theme.js');
    for (const theme of ['light', 'dark'] as const) {
      setTheme(theme);
      const { container, unmount } = renderLogin();
      // The screen never pins a theme or palette of its own…
      expect(container.querySelector('[data-theme]')).toBeNull();
      expect(container.querySelector('[style*="--color"]')).toBeNull();
      expect(document.documentElement).toHaveAttribute('data-theme', theme);
      // …and the sign-in paths are the same in both.
      expect(screen.getByText('Продолжить через VK ID')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Продолжить с почтой' })).toBeInTheDocument();
      unmount();
    }
  });
});

describe('Login — email validation', () => {
  it('rejects an invalid email without calling the API', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Продолжить с почтой' }));
    expect(screen.getByText('Введите корректный email')).toBeInTheDocument();
    expect(api.requestMagicLink).not.toHaveBeenCalled();
  });
});

describe('Login — magic-link request', () => {
  it('sends the trimmed email and shows the "check your email" state, explicitly naming it a link (never a code)', async () => {
    vi.mocked(api.requestMagicLink).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText('Email'), '  student@example.com  ');
    await user.click(screen.getByRole('button', { name: 'Продолжить с почтой' }));
    await waitFor(() => expect(screen.getByText('Проверьте почту')).toBeInTheDocument());
    expect(api.requestMagicLink).toHaveBeenCalledWith('student@example.com');
    expect(screen.getByText(/student@example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/ссылкой для входа/)).toBeInTheDocument();
    expect(screen.getByText(/это ссылка, не код/)).toBeInTheDocument();
  });

  it('never claims success on a 503 (email not configured) — shows an honest error instead', async () => {
    vi.mocked(api.requestMagicLink).mockRejectedValue(
      new ApiError(503, { error: 'email_not_configured' }),
    );
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText('Email'), 'student@example.com');
    await user.click(screen.getByRole('button', { name: 'Продолжить с почтой' }));
    await waitFor(() =>
      expect(screen.getByText(/Отправка писем сейчас недоступна/)).toBeInTheDocument(),
    );
    expect(screen.queryByText('Проверьте почту')).not.toBeInTheDocument();
  });

  it('shows a clear rate-limit message on a 429, never a generic/fake error', async () => {
    vi.mocked(api.requestMagicLink).mockRejectedValue(new ApiError(429, { error: 'rate_limited' }));
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText('Email'), 'student@example.com');
    await user.click(screen.getByRole('button', { name: 'Продолжить с почтой' }));
    await waitFor(() => expect(screen.getByText(/Слишком много попыток/)).toBeInTheDocument());
  });

  it('guards against a double submit while the request is in flight', async () => {
    let resolveRequest: (() => void) | undefined;
    vi.mocked(api.requestMagicLink).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = () => resolve({ ok: true });
        }),
    );
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText('Email'), 'student@example.com');
    const submit = screen.getByRole('button', { name: 'Продолжить с почтой' });
    await user.click(submit);
    await user.click(submit);
    await user.click(submit);
    expect(api.requestMagicLink).toHaveBeenCalledTimes(1);
    resolveRequest?.();
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
