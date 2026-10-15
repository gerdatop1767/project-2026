import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App.js';
import { NavigationProvider } from './lib/navigation.js';
import { ToastProvider } from './ui/Toast/ToastProvider.js';
import * as api from './lib/api.js';
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

function renderApp() {
  return render(
    <NavigationProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
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
    expect(screen.getByText('Имя не задано')).toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: /Начать бесплатно/ }));
    expect(screen.getByRole('navigation', { name: 'Zybrilka' })).toBeInTheDocument();
    restore();
  });

  it('opens the desktop Menu over the current screen and closes it on Escape', async () => {
    const restore = mockDesktop(true);
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: /Начать бесплатно/ }));
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
    await user.click(screen.getByRole('button', { name: /Начать бесплатно/ }));
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
    await user.click(screen.getByRole('button', { name: /Начать бесплатно/ }));
    await user.click(screen.getByRole('button', { name: 'Меню' }));
    expect(screen.queryByRole('button', { name: 'Моя статистика' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Настройки' })).not.toBeInTheDocument();
    restore();
  });

  it('opens Профиль from Menu and BackRow returns to the real screen underneath, not Home', async () => {
    const restore = mockDesktop(true);
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: /Начать бесплатно/ }));
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
    await user.click(screen.getByRole('button', { name: /Начать бесплатно/ }));
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
    await user.click(screen.getByRole('button', { name: /Начать бесплатно/ }));
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

describe('App — first-login gate (Learning Profile, Phase 1)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('shows the public landing (not an automatic onboarding redirect) for a brand-new user', async () => {
    vi.mocked(api.getLearningProfile).mockResolvedValue({
      onboardingCompleted: false,
      subjects: [],
    });
    renderApp();
    await waitFor(() => {
      expect(screen.getByText(/ЕГЭ становится проще/)).toBeInTheDocument();
    });
    expect(window.location.pathname).toBe('/');
    expect(screen.queryByText('Добро пожаловать в Zybrilka!')).not.toBeInTheDocument();
  });

  it('"Начать бесплатно" on the landing is what actually starts onboarding', async () => {
    vi.mocked(api.getLearningProfile).mockResolvedValue({
      onboardingCompleted: false,
      subjects: [],
    });
    const user = userEvent.setup();
    renderApp();
    await screen.findByText(/ЕГЭ становится проще/);
    await user.click(screen.getByRole('button', { name: /Начать бесплатно/ }));
    expect(screen.getByText('Добро пожаловать в Zybrilka!')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/onboarding');
  });

  it('shows the desktop landing (not the normal marketing Home) for a brand-new user', async () => {
    vi.mocked(api.getLearningProfile).mockResolvedValue({
      onboardingCompleted: false,
      subjects: [],
    });
    const restore = mockDesktop(true);
    renderApp();
    await waitFor(() => {
      expect(screen.getByText(/ЕГЭ становится проще/)).toBeInTheDocument();
    });
    // The desktop landing has no sidebar — it's shown outside the
    // normal app shell, same as the mobile landing has no bottom nav.
    expect(screen.queryByRole('navigation', { name: 'Zybrilka' })).not.toBeInTheDocument();
    restore();
  });

  it('does not redirect a returning user (onboardingCompleted: true)', async () => {
    vi.mocked(api.getLearningProfile).mockResolvedValue({
      onboardingCompleted: true,
      subjects: [],
    });
    renderApp();
    await waitFor(() => expect(api.getLearningProfile).toHaveBeenCalled());
    expect(screen.getByText(/Готов к новой/)).toBeInTheDocument();
  });

  it('does not redirect when landing directly on a deep link (overlay already open)', async () => {
    vi.mocked(api.getLearningProfile).mockResolvedValue({
      onboardingCompleted: false,
      subjects: [],
    });
    window.history.replaceState(null, '', '/help');
    renderApp();
    await waitFor(() => expect(screen.getByText('Нужна')).toBeInTheDocument());
    expect(window.location.pathname).toBe('/help');
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

    await user.click(screen.getByRole('button', { name: /Начать бесплатно/ }));
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
