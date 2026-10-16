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

  it('renders the desktop marketing Home without a sidebar', () => {
    const restore = mockDesktop(true);
    renderApp();
    expect(screen.getByText(/ЕГЭ становится проще/)).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Zybrilka' })).not.toBeInTheDocument();
    restore();
  });

  it('shows the sidebar once navigated to an inner screen', async () => {
    const restore = mockDesktop(true);
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Zybrilka — Учебный центр' }));
    expect(screen.getByRole('navigation', { name: 'Zybrilka' })).toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: 'Помощь' }));
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
    await user.click(screen.getByRole('button', { name: 'О проекте' }));
    await user.click(screen.getByRole('button', { name: 'Меню' }));
    await user.click(screen.getByRole('button', { name: 'Профиль' }));
    expect(screen.getByText('Мой профиль')).toBeInTheDocument();

    const backRow = within(screen.getByRole('main')).getByRole('button', { name: 'О проекте' });
    await user.click(backRow);
    expect(screen.getByText('Наши принципы')).toBeInTheDocument();
    restore();
  });

  it('opens Помощь from Menu and BackRow closes it, returning to the underlying tab', async () => {
    const restore = mockDesktop(true);
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Zybrilka — Учебный центр' }));
    await user.click(screen.getByRole('button', { name: 'Меню' }));
    await user.click(screen.getByRole('button', { name: 'Помощь' }));
    expect(screen.getByText('Нужна')).toBeInTheDocument();

    const backRow = within(screen.getByRole('main')).getByRole('button', { name: /Главная/ });
    await user.click(backRow);
    expect(screen.queryByText('Нужна')).not.toBeInTheDocument();
    restore();
  });

  it('sidebar-level overlays (Мои ошибки, Рейтинг, О проекте, Предметы, Учебный центр, Помощь) always show "Главная" as Back, never a stale previous tab', async () => {
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
      ['О проекте', 'Наши принципы'],
    ] as const) {
      await user.click(screen.getByRole('button', { name: sidebarLabel }));
      await screen.findByText(new RegExp(screenText));
      const backRow = within(screen.getByRole('main')).getByRole('button', { name: 'Главная' });
      expect(backRow).toBeInTheDocument();
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
    expect(screen.queryByText(/ЕГЭ становится проще/)).not.toBeInTheDocument();
    expect(screen.queryByText('Войти или создать аккаунт')).not.toBeInTheDocument();
    expect(screen.queryByText(/Готов к новой/)).not.toBeInTheDocument();
  });

  it('signed out: `/` is the public landing, not the trainer', async () => {
    renderApp(null);
    await screen.findByText(/ЕГЭ становится проще/);
    expect(screen.queryByText(/Готов к новой/)).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('signed out: the desktop landing has no app sidebar', async () => {
    const restore = mockDesktop(true);
    renderApp(null);
    await screen.findByText(/ЕГЭ становится проще/);
    expect(screen.queryByRole('navigation', { name: 'Zybrilka' })).not.toBeInTheDocument();
    restore();
  });

  it('"Начать бесплатно" on the landing opens the unified auth screen', async () => {
    const user = userEvent.setup();
    renderApp(null);
    await screen.findByText(/ЕГЭ становится проще/);
    await user.click(screen.getByRole('button', { name: /Начать бесплатно/ }));
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
    expect(screen.queryByText(/ЕГЭ становится проще/)).not.toBeInTheDocument();
    // The diagnostic/onboarding is only reachable on purpose (Профиль →
    // «Предметы ЕГЭ»), it is never auto-started for an onboarded user.
    expect(window.location.pathname).toBe('/');
    expect(api.getLearningProfile).not.toHaveBeenCalled();
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
    const img = container.querySelector('img[src="https://sun9.userapi.com/a.jpg"]')!;
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    act(() => {
      img.dispatchEvent(new Event('error'));
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
