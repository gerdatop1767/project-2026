import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App.js';
import { NavigationProvider } from './lib/navigation.js';
import { ToastProvider } from './ui/Toast/ToastProvider.js';
import * as api from './lib/api.js';
import { makeAuthUser, TestAuthProvider } from './lib/authTestUtils.js';
import type { AuthUser } from '@zybrilka/shared';
import type * as ApiModule from './lib/api.js';

vi.mock('./lib/api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  getRandomTask: vi.fn(),
  getLearningProfile: vi.fn(),
  getIdentities: vi.fn(() =>
    Promise.resolve({
      identities: [{ provider: 'email' as const, linkedAt: '2026-01-01T00:00:00.000Z' }],
      available: { vk: true, telegram: false },
      canUnlink: false,
    }),
  ),
}));

const RANDOM_TASK = {
  id: 'task-1',
  subjectId: 'math',
  taskNumber: 5,
  topicId: null,
  topicName: null,
  difficulty: 2 as const,
  conditionMd: 'Условие',
  passage: null,
  imageUrl: null,
  hintMd: null,
  answerType: 'short_answer' as const,
  answerOptions: null,
  answerParts: null,
  source: 'ФИПИ',
  sourceUrl: null,
  sourceYear: 2026,
  tags: [],
  status: 'published' as const,
};

beforeEach(() => {
  // Default to an already-completed profile so the first-login gate
  // doesn't redirect these tests to onboarding — tests that care about
  // the gate itself override this per-test.
  vi.mocked(api.getLearningProfile).mockResolvedValue({ onboardingCompleted: true, subjects: [] });
});

/** `user`: a signed-in, onboarded user by default; `null` = signed out;
 * `undefined` = session check still pending. */
function renderApp(
  user: AuthUser | null | undefined = makeAuthUser(),
  logout?: () => Promise<void>,
) {
  return render(
    <NavigationProvider>
      <TestAuthProvider user={user} logout={logout}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </TestAuthProvider>
    </NavigationProvider>,
  );
}

/** Forces useIsDesktop() to a fixed value for one test. */
function mockDesktop(matches: boolean) {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

describe('App — mobile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the mobile Home with the bottom tab bar visible', () => {
    renderApp();
    expect(screen.getByText(/Готов к новой/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Главная/ })).toHaveAttribute('aria-current', 'page');
  });

  it('switches tabs via the bottom navigation', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: /Статистика/ }));
    expect(screen.getByRole('button', { name: 'Статистика' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('opens the real Профиль screen from the bottom navigation "Профиль" slot, keeping the tab bar visible', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: /Профиль/ }));
    // Name comes from the signed-in user's VK profile.
    expect(screen.getByText('Иван Петров')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Профиль' })).toHaveAttribute('aria-current', 'page');
  });

  it("opens the Menu drawer from Профиль's header button", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: /Профиль/ }));
    await user.click(screen.getByRole('button', { name: 'Меню' }));
    expect(screen.getByRole('dialog', { name: 'Меню' })).toBeInTheDocument();
    expect(screen.getByText('Зубрилка')).toBeInTheDocument();
  });

  it('hides the tab bar on an overlay screen', async () => {
    vi.mocked(api.getRandomTask).mockResolvedValue(RANDOM_TASK);
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: /Тренировка · случайные задания/ }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Главная/ })).not.toBeInTheDocument();
    });
  });
});

describe('App — desktop', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a signed-in visitor\'s "/" is the Учебный центр with the sidebar — never the old marketing page', async () => {
    const restore = mockDesktop(true);
    renderApp();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Учебный центр' }),
    ).toBeInTheDocument();
    const sidebar = screen.getByRole('navigation', { name: 'Zybrilka' });
    expect(within(sidebar).getByRole('button', { name: 'Учебный центр' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // The old landing copy and its logged-out-style header are gone from the app.
    expect(screen.queryByText(/ЕГЭ становится проще/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Начать заниматься/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Начать бесплатно/)).not.toBeInTheDocument();
    // This IS the home screen, so there is no "back to Главная" row on it.
    expect(within(screen.getByRole('main')).queryByRole('button', { name: 'Главная' })).toBeNull();
    // …and it is not the support screen.
    expect(screen.queryByText('Нужна')).not.toBeInTheDocument();
    restore();
  });

  it('the logo opens the Учебный центр as a screen of its own — no "← Главная" row, the sidebar is the way around', async () => {
    const restore = mockDesktop(true);
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Zybrilka — Учебный центр' }));
    expect(screen.getByRole('navigation', { name: 'Zybrilka' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/learning');
    expect(
      within(screen.getByRole('main')).queryByRole('button', { name: 'Главная' }),
    ).not.toBeInTheDocument();
    restore();
  });

  it('has no «О проекте» anywhere in the sidebar or the menu', async () => {
    const restore = mockDesktop(true);
    const user = userEvent.setup();
    renderApp();
    expect(screen.queryByText('О проекте')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Меню' }));
    expect(screen.queryByText('О проекте')).not.toBeInTheDocument();
    restore();
  });

  it('opens the desktop Menu over the current screen and closes it on Escape', async () => {
    const restore = mockDesktop(true);
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Zybrilka — Учебный центр' }));
    await user.click(screen.getByRole('button', { name: 'Меню' }));
    const dialog = screen.getByRole('dialog', { name: 'Меню' });
    expect(dialog).toBeInTheDocument();
    // The screen underneath (the sidebar) stays mounted — Menu is a
    // panel over it, not a route replacing it.
    expect(screen.getByRole('navigation', { name: 'Zybrilka' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Меню' })).not.toBeInTheDocument();
    restore();
  });

  it('navigating from the desktop Menu closes it and switches screen', async () => {
    const restore = mockDesktop(true);
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Zybrilka — Учебный центр' }));
    await user.click(screen.getByRole('button', { name: 'Меню' }));
    await user.click(screen.getByRole('button', { name: /^Помощь/ }));
    expect(screen.queryByRole('dialog', { name: 'Меню' })).not.toBeInTheDocument();
    expect(screen.getByText('Нужна')).toBeInTheDocument();
    restore();
  });

  it('does not offer "Моя статистика" or "Настройки" from the desktop Menu anymore', async () => {
    const restore = mockDesktop(true);
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Zybrilka — Учебный центр' }));
    await user.click(screen.getByRole('button', { name: 'Меню' }));
    expect(screen.queryByRole('button', { name: 'Моя статистика' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Настройки' })).not.toBeInTheDocument();
    restore();
  });

  it('opens Профиль from Menu and BackRow returns to the real screen underneath, not Home', async () => {
    const restore = mockDesktop(true);
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Zybrilka — Учебный центр' }));
    await user.click(screen.getByRole('button', { name: 'Рейтинг' }));
    await user.click(screen.getByRole('button', { name: 'Меню' }));
    await user.click(screen.getByRole('button', { name: /^Профиль/ }));
    expect(screen.getByText('Мой профиль')).toBeInTheDocument();

    const backRow = within(screen.getByRole('main')).getByRole('button', { name: 'Рейтинг' });
    await user.click(backRow);
    expect(screen.getByText(/Соревнуйся с другими/)).toBeInTheDocument();
    restore();
  });

  it('opens Помощь from Menu; with no "← Главная" row there, the sidebar takes the visitor on', async () => {
    const restore = mockDesktop(true);
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Zybrilka — Учебный центр' }));
    await user.click(screen.getByRole('button', { name: 'Меню' }));
    await user.click(screen.getByRole('button', { name: /^Помощь/ }));
    expect(screen.getByText('Нужна')).toBeInTheDocument();
    expect(
      within(screen.getByRole('main')).queryByRole('button', { name: /Главная/ }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Учебный центр' }));
    expect(screen.queryByText('Нужна')).not.toBeInTheDocument();
    restore();
  });

  it('sidebar-level overlays (Мои ошибки, Рейтинг) show no back row at all — neither "Главная" nor a stale previous tab', async () => {
    const restore = mockDesktop(true);
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Zybrilka — Учебный центр' }));
    // Switch the underlying tab away from Home first — this is exactly
    // the scenario that used to leak the wrong tab's name into these
    // screens' Back button ("Достижения" instead of "Главная").
    await user.click(screen.getByRole('button', { name: 'Достижения' }));

    for (const [sidebarLabel, screenText] of [
      ['Мои ошибки', 'Разбирай ошибки'],
      ['Рейтинг', 'Соревнуйся с другими'],
    ] as const) {
      await user.click(screen.getByRole('button', { name: sidebarLabel }));
      await screen.findByText(new RegExp(screenText));
      const main = within(screen.getByRole('main'));
      expect(main.queryByRole('button', { name: 'Главная' })).not.toBeInTheDocument();
      expect(main.queryByRole('button', { name: 'Достижения' })).not.toBeInTheDocument();
      // Re-enter Достижения before the next iteration so each screen is
      // independently checked against the same "stale tab" scenario.
      await user.click(screen.getByRole('button', { name: 'Достижения' }));
    }
    restore();
  });
});

describe('App — access gate (server-truth auth state)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('shows a neutral loading state (no landing, no login, no trainer) until the session check resolves', () => {
    render(
      <NavigationProvider>
        <TestAuthProvider user={undefined}>
          <ToastProvider>
            <App />
          </ToastProvider>
        </TestAuthProvider>
      </NavigationProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Загрузка');
    expect(screen.queryByText(/Подготовка к/)).not.toBeInTheDocument();
    expect(screen.queryByText('Войти или создать аккаунт')).not.toBeInTheDocument();
    expect(screen.queryByText(/Готов к новой/)).not.toBeInTheDocument();
  });

  it('signed out: `/` is the public landing, not the trainer', async () => {
    renderApp(null);
    await screen.findByText(/Подготовка к/);
    expect(screen.queryByText(/Готов к новой/)).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('signed out: the desktop landing has no app sidebar', async () => {
    const restore = mockDesktop(true);
    renderApp(null);
    await screen.findByText(/Подготовка к/);
    expect(screen.queryByRole('navigation', { name: 'Zybrilka' })).not.toBeInTheDocument();
    restore();
  });

  it('"Начать бесплатно" on the landing opens the unified auth screen', async () => {
    const user = userEvent.setup();
    renderApp(null);
    await screen.findByText(/Подготовка к/);
    await user.click(screen.getAllByRole('button', { name: /Начать бесплатно/ })[0]!);
    expect(screen.getByText('Войти или создать аккаунт')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
  });

  it.each([
    '/statistics',
    '/training',
    '/subjects',
    '/subjects/math',
    '/profile',
    '/training/mistakes',
    '/learning/session/abc',
    '/onboarding',
    '/rating',
  ])(
    'signed out: deep link %s shows the login screen and rewrites the URL to /login',
    async (path) => {
      window.history.replaceState(null, '', path);
      renderApp(null);
      await screen.findByText('Войти или создать аккаунт');
      await waitFor(() => expect(window.location.pathname).toBe('/login'));
      expect(screen.queryByText('Мой профиль')).not.toBeInTheDocument();
    },
  );

  it('signed out: static info pages stay reachable', async () => {
    window.history.replaceState(null, '', '/help');
    renderApp(null);
    await waitFor(() => expect(screen.getByText('Нужна')).toBeInTheDocument());
    expect(window.location.pathname).toBe('/help');
  });

  it.each([
    ['/faq', 'Вопросы и ответы'],
    ['/privacy', 'Политика конфиденциальности'],
    ['/terms', 'Пользовательское соглашение'],
  ])('signed out: %s is a public page, never the login screen', async (path, heading) => {
    window.history.replaceState(null, '', path);
    renderApp(null);
    expect(
      await screen.findByRole('heading', {
        level: 1,
        // Long title words carry soft hyphens for narrow phones.
        name: (name) => name.replaceAll('\u00ad', '') === heading,
      }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe(path);
  });

  it('signed in with onboarding pending: /privacy stays readable, no redirect to onboarding', async () => {
    window.history.replaceState(null, '', '/privacy');
    renderApp(makeAuthUser({ onboardingCompleted: false }));
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: (name) => name.replaceAll('\u00ad', '') === 'Политика конфиденциальности',
      }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/privacy');
    expect(screen.getByRole('button', { name: 'Открыть тренажёр' })).toBeInTheDocument();
  });

  it('signed in + onboarding NOT completed (new or unfinished account): sent to onboarding, never the main menu', async () => {
    renderApp(makeAuthUser({ onboardingCompleted: false }));
    await screen.findByText('Добро пожаловать в Zybrilka!');
    expect(window.location.pathname).toBe('/onboarding');
    expect(screen.queryByText(/Готов к новой/)).not.toBeInTheDocument();
  });

  it('signed in + onboarding not completed: a deep link into the trainer is redirected to onboarding too', async () => {
    window.history.replaceState(null, '', '/statistics');
    renderApp(makeAuthUser({ onboardingCompleted: false }));
    await screen.findByText('Добро пожаловать в Zybrilka!');
    expect(window.location.pathname).toBe('/onboarding');
  });

  it('signed in + onboarding completed: straight to the main menu, no onboarding, no landing', async () => {
    renderApp(makeAuthUser({ onboardingCompleted: true }));
    expect(screen.getByText(/Готов к новой/)).toBeInTheDocument();
    expect(screen.queryByText('Добро пожаловать в Zybrilka!')).not.toBeInTheDocument();
    expect(screen.queryByText(/Подготовка к/)).not.toBeInTheDocument();
    // The diagnostic/onboarding is only reachable on purpose (Профиль →
    // «Предметы ЕГЭ»), it is never auto-started for an onboarded user.
    expect(window.location.pathname).toBe('/');
    expect(api.getLearningProfile).not.toHaveBeenCalled();
  });

  it('signed in, but the API did not send onboardingCompleted (older/incompatible build): no onboarding loop — the normal app opens', async () => {
    const legacy = { ...makeAuthUser(), onboardingCompleted: undefined } as unknown as AuthUser;
    renderApp(legacy);
    expect(screen.getByText(/Готов к новой/)).toBeInTheDocument();
    expect(screen.queryByText('Добро пожаловать в Zybrilka!')).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('unknown onboarding status never grants access: signed OUT stays signed out whatever else is in the payload', async () => {
    window.history.replaceState(null, '', '/statistics');
    renderApp(null);
    await screen.findByText('Войти или создать аккаунт');
    expect(screen.queryByText(/Готов к новой/)).not.toBeInTheDocument();
  });

  it('signed in + onboarded: may still open onboarding on purpose (to retake it) without being bounced', async () => {
    window.history.replaceState(null, '', '/onboarding');
    renderApp(makeAuthUser({ onboardingCompleted: true }));
    await screen.findByText('Добро пожаловать в Zybrilka!');
    expect(window.location.pathname).toBe('/onboarding');
  });

  it('signed in: the profile shows the VK name and falls back to a neutral prompt without one', async () => {
    window.history.replaceState(null, '', '/profile');
    const { unmount } = renderApp(makeAuthUser({ firstName: 'Анна', lastName: 'Ким' }));
    expect(await screen.findByText('Анна Ким')).toBeInTheDocument();
    unmount();
    renderApp(makeAuthUser({ firstName: null, lastName: null }));
    expect(await screen.findByText('Имя не задано')).toBeInTheDocument();
  });

  it('signed in: only the first name is shown when VK gave no last name (no "null" text)', async () => {
    window.history.replaceState(null, '', '/profile');
    renderApp(makeAuthUser({ firstName: 'Анна', lastName: null }));
    expect(await screen.findByText('Анна')).toBeInTheDocument();
    expect(screen.queryByText(/null|undefined/)).not.toBeInTheDocument();
  });

  it('signed in: the VK avatar is rendered, and a broken image falls back to the default icon', async () => {
    window.history.replaceState(null, '', '/profile');
    const { container } = renderApp(makeAuthUser({ avatarUrl: 'https://sun9.userapi.com/a.jpg' }));
    await screen.findByText('Иван Петров');
    // Shown on the identity card and in «Личные данные».
    const imgs = [...container.querySelectorAll('img[src="https://sun9.userapi.com/a.jpg"]')];
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    act(() => {
      for (const img of imgs) img.dispatchEvent(new Event('error'));
    });
    await waitFor(() =>
      expect(container.querySelector('img[src="https://sun9.userapi.com/a.jpg"]')).toBeNull(),
    );
  });
});

describe('App — sign out', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/profile');
  });
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('desktop profile "Выйти из аккаунта" calls the real logout', async () => {
    const restore = mockDesktop(true);
    const logout = vi.fn(async () => {});
    const user = userEvent.setup();
    renderApp(makeAuthUser(), logout);
    await user.click(screen.getByRole('button', { name: /Выйти из аккаунта/ }));
    expect(logout).toHaveBeenCalledTimes(1);
    restore();
  });

  it('desktop menu "Выйти" calls the real logout', async () => {
    const restore = mockDesktop(true);
    const logout = vi.fn(async () => {});
    const user = userEvent.setup();
    renderApp(makeAuthUser(), logout);
    await user.click(screen.getByRole('button', { name: 'Меню' }));
    await user.click(screen.getByRole('button', { name: /^Выйти$/ }));
    expect(logout).toHaveBeenCalledTimes(1);
    restore();
  });

  it('mobile menu "Выйти из аккаунта" calls the real logout', async () => {
    const logout = vi.fn(async () => {});
    const user = userEvent.setup();
    renderApp(makeAuthUser(), logout);
    await user.click(screen.getByRole('button', { name: 'Меню' }));
    await user.click(screen.getByRole('button', { name: 'Выйти из аккаунта' }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('says so when the server could not end the session — never silently pretends', async () => {
    const restore = mockDesktop(true);
    const logout = vi.fn(async () => {
      throw new Error('network');
    });
    const user = userEvent.setup();
    renderApp(makeAuthUser(), logout);
    await user.click(screen.getByRole('button', { name: /Выйти из аккаунта/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось выйти');
    restore();
  });
});

describe('App — URL routing is the source of truth', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('a direct URL to /subjects opens the subject catalog on load (desktop)', () => {
    const restore = mockDesktop(true);
    window.history.replaceState(null, '', '/subjects');
    renderApp();
    expect(screen.getByText(/Выбери предмет/)).toBeInTheDocument();
    restore();
  });

  it('a direct URL to /subjects/math opens that subject on load (desktop)', () => {
    const restore = mockDesktop(true);
    window.history.replaceState(null, '', '/subjects/math');
    renderApp();
    expect(screen.getByText('Темы ЕГЭ')).toBeInTheDocument();
    restore();
  });

  it('a direct URL to /profile opens Профиль on load (desktop)', () => {
    const restore = mockDesktop(true);
    window.history.replaceState(null, '', '/profile');
    renderApp();
    expect(screen.getByText('Мой профиль')).toBeInTheDocument();
    restore();
  });

  it('a direct URL to /help opens Помощь on load (desktop)', () => {
    const restore = mockDesktop(true);
    window.history.replaceState(null, '', '/help');
    renderApp();
    expect(screen.getByText('Нужна')).toBeInTheDocument();
    restore();
  });

  it('a direct URL to /statistics opens the Статистика tab on load (mobile)', () => {
    window.history.replaceState(null, '', '/statistics');
    renderApp();
    expect(screen.getByRole('button', { name: 'Статистика' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('an unknown URL falls back to Home instead of a blank screen', () => {
    window.history.replaceState(null, '', '/this-page-does-not-exist');
    renderApp();
    expect(screen.getByText(/Готов к новой/)).toBeInTheDocument();
  });

  it('navigating updates the URL, and Back/Forward walk the real history', async () => {
    const restore = mockDesktop(true);
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: 'Zybrilka — Учебный центр' }));
    expect(window.location.pathname).toBe('/learning');

    await user.click(screen.getByRole('button', { name: 'Предметы' }));
    expect(window.location.pathname).toBe('/subjects');

    await user.click(screen.getAllByRole('button', { name: /Математика/ })[0]!);
    expect(window.location.pathname).toBe('/subjects/math');
    expect(screen.getByText('Темы ЕГЭ')).toBeInTheDocument();

    await act(async () => {
      window.history.back();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(window.location.pathname).toBe('/subjects');
    expect(screen.getByText(/Выбери предмет/)).toBeInTheDocument();

    await act(async () => {
      window.history.forward();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(window.location.pathname).toBe('/subjects/math');
    expect(screen.getByText('Темы ЕГЭ')).toBeInTheDocument();

    restore();
  });
});

/**
 * Sign-in redirects, the close button, the removed «О проекте» page and what a
 * signed-in visitor lands on — the pieces behind "after VK I end up on Помощь",
 * "the × sometimes does nothing" and "the old landing shows up".
 */
describe('App — sign-in redirects, × and removed pages', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const landingHeading = () => screen.findByRole('heading', { level: 1, name: /Подготовка к/ });

  it('a guest who opens a private link is sent to sign-in WITHOUT leaving that link behind, so × lands on the landing — every time', async () => {
    window.history.replaceState(null, '', '/statistics');
    const user = userEvent.setup();
    renderApp(null);
    await screen.findByText('Войти или создать аккаунт');
    await waitFor(() => expect(window.location.pathname).toBe('/login'));
    const length = window.history.length;

    // First ×: nothing of the app behind the sign-in, so it closes IN PLACE
    // (replace — no entry added, no bounce into the private link).
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    await landingHeading();
    expect(window.location.pathname).toBe('/');
    expect(window.history.length).toBe(length);

    // Open sign-in again from the landing and close it again: now there IS
    // an app entry behind it, so × is a real Back — and it works again.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await user.click(screen.getAllByRole('button', { name: /Начать бесплатно/ })[0]!);
      await screen.findByText('Войти или создать аккаунт');
      await user.click(screen.getByRole('button', { name: 'Закрыть' }));
      await landingHeading();
      await waitFor(() => expect(window.location.pathname).toBe('/'));
    }
  });

  it('sign-in opened straight by URL (nothing behind it): × shows the landing instead of leaving the site', async () => {
    window.history.replaceState(null, '', '/login');
    const user = userEvent.setup();
    renderApp(null);
    await screen.findByText('Войти или создать аккаунт');
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    await landingHeading();
    expect(window.location.pathname).toBe('/');
  });

  it('after signing out, the trainer pages left in the history do not trap ×: the sign-in shown in place of one goes straight to the landing', async () => {
    // What a sign-out leaves behind: several private pages of this visit.
    window.history.replaceState({ zybrilka: { index: 0 } }, '', '/statistics');
    window.history.pushState({ zybrilka: { index: 1 } }, '', '/achievements');
    window.history.pushState({ zybrilka: { index: 2 } }, '', '/rating');
    const user = userEvent.setup();
    renderApp(null);
    await screen.findByText('Войти или создать аккаунт');
    expect(window.location.pathname).toBe('/login');

    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    await landingHeading();
    expect(window.location.pathname).toBe('/');
  });

  it("sign-in opened from the landing's CTA: × is a real Back to the landing", async () => {
    const user = userEvent.setup();
    renderApp(null);
    await landingHeading();
    await user.click(screen.getAllByRole('button', { name: /Начать бесплатно/ })[0]!);
    await screen.findByText('Войти или создать аккаунт');
    expect(window.location.pathname).toBe('/login');
    await user.click(screen.getByRole('button', { name: 'Закрыть' }));
    await landingHeading();
    await waitFor(() => expect(window.location.pathname).toBe('/'));
  });

  it('a signed-in visitor returning from VK to "/" lands in the app (Учебный центр), never on Помощь', async () => {
    const restore = mockDesktop(true);
    renderApp(makeAuthUser({ onboardingCompleted: true }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Учебный центр' }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    expect(screen.queryByText('Нужна')).not.toBeInTheDocument();
    restore();
  });

  it('a signed-in visitor on mobile lands on the main menu dashboard, never on Помощь', async () => {
    const restore = mockDesktop(false);
    renderApp(makeAuthUser({ onboardingCompleted: true }));
    expect(await screen.findByText(/Готов к новой/)).toBeInTheDocument();
    expect(screen.queryByText('Нужна')).not.toBeInTheDocument();
    restore();
  });

  it('a brand-new account (what VK returns for a first sign-in) is sent to onboarding by REPLACING the entry — no extra history, Back cannot loop', async () => {
    const length = window.history.length;
    renderApp(makeAuthUser({ onboardingCompleted: false }));
    await screen.findByText('Добро пожаловать в Zybrilka!');
    expect(window.location.pathname).toBe('/onboarding');
    expect(window.history.length).toBe(length);
  });

  it('onboarding\'s first-step "Назад" never leaves the app (the gate keeps a new account on onboarding)', async () => {
    window.history.replaceState(null, '', '/onboarding');
    const user = userEvent.setup();
    renderApp(makeAuthUser({ onboardingCompleted: false }));
    await screen.findByText('Добро пожаловать в Zybrilka!');
    const length = window.history.length;
    await user.click(screen.getByRole('button', { name: 'Назад' }));
    await screen.findByText('Добро пожаловать в Zybrilka!');
    expect(window.location.pathname).toBe('/onboarding');
    expect(window.history.length).toBe(length);
  });

  it('the removed /about page: a guest gets the landing, the address is corrected to /', async () => {
    window.history.replaceState(null, '', '/about');
    renderApp(null);
    await landingHeading();
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(screen.queryByText(/Наши принципы/)).not.toBeInTheDocument();
  });

  it('the removed /about page: a signed-in visitor gets their normal home, not an error and not Помощь', async () => {
    const restore = mockDesktop(true);
    window.history.replaceState(null, '', '/about');
    renderApp(makeAuthUser({ onboardingCompleted: true }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Учебный центр' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(screen.queryByText(/Наши принципы/)).not.toBeInTheDocument();
    restore();
  });

  it("the guest's only support entry points open a window over the page: no navigation to /help", async () => {
    const user = userEvent.setup();
    renderApp(null);
    await landingHeading();
    await user.click(
      within(screen.getByRole('contentinfo')).getByRole('button', { name: 'Поддержка' }),
    );
    expect(await screen.findByRole('dialog', { name: /Нужна помощь/ })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    // The landing is still rendered behind the window.
    expect(
      screen.getByRole('heading', { level: 1, hidden: true, name: /Подготовка к/ }),
    ).toBeTruthy();
  });
});
