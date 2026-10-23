import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import { Login } from './Login.js';
import { makeAuthUser, TestAuthProvider } from '../../lib/authTestUtils.js';
import type * as ApiModule from '../../lib/api.js';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../../lib/api.js');
  return {
    ...actual,
    getCurrentUser: vi.fn(() => Promise.resolve({ user: null })),
    yandexLoginUrl: vi.fn(() => 'https://api.test/api/v1/auth/yandex/start'),
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
  it('offers VK ID and Yandex ID, and no email registration or emailed links', () => {
    renderLogin();
    expect(screen.getByText('Войти или создать аккаунт')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Продолжить через VK ID/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Войти через Яндекс/ })).toBeInTheDocument();
    expect(screen.getByText(/условиями использования/)).toBeInTheDocument();
    // Nothing that sends a letter or creates an account by email.
    expect(screen.queryByRole('tab', { name: 'Регистрация' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Зарегистрироваться/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Забыли пароль/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ссылк[уа] для входа/)).not.toBeInTheDocument();
    expect(screen.queryByText(/письм/)).not.toBeInTheDocument();
    // No email / password sign-in at all.
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument();
    expect(screen.queryByText(/почт/i)).not.toBeInTheDocument();
  });

  it('old emailed links (?confirm=, ?reset=, ?token=) no longer do anything', () => {
    for (const path of ['/login?confirm=abc', '/login?reset=abc', '/login?token=abc']) {
      const { unmount } = renderLogin(path);
      expect(screen.getByRole('button', { name: /Войти через Яндекс/ })).toBeInTheDocument();
      expect(screen.queryByLabelText('Новый пароль')).not.toBeInTheDocument();
      unmount();
    }
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
      expect(screen.getByRole('button', { name: /Войти через Яндекс/ })).toBeInTheDocument();
      unmount();
    }
  });
});

describe('Login — Yandex ID', () => {
  it('is a full-page redirect to the API start URL', async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...original,
        search: '',
        assign: (url: string) => assign(url),
      },
    });
    try {
      renderLogin();
      await user.click(screen.getByRole('button', { name: /Войти через Яндекс/ }));
      expect(assign).toHaveBeenCalledWith('https://api.test/api/v1/auth/yandex/start');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it.each([
    ['cancelled', 'Вход через Яндекс отменён'],
    ['error', 'Не удалось войти через Яндекс'],
    ['invalid_state', 'Сеанс входа через Яндекс устарел'],
    ['not_configured', 'Вход через Яндекс пока не настроен'],
    ['<script>', 'Не удалось войти через Яндекс'],
  ])('explains ?yandex=%s and cleans the address', async (code, text) => {
    renderLogin(`/login?yandex=${encodeURIComponent(code)}`);
    expect(screen.getByRole('status')).toHaveTextContent(text);
    await waitFor(() => expect(window.location.search).toBe(''));
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
    await user.click(close);
    expect(window.location.pathname).toBe('/');
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
    expect(screen.getByRole('button', { name: /Войти через Яндекс/ })).toBeEnabled();
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
        assign: (url: string) => assign(url),
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
