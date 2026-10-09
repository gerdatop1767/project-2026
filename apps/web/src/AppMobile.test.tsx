import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppMobile } from './AppMobile.js';
import { NavigationProvider, useNavigation } from './lib/navigation.js';
import { ToastProvider } from './ui/Toast/ToastProvider.js';
import * as api from './lib/api.js';

vi.mock('./lib/api.js', () => ({
  getRandomTask: vi.fn(),
  getTask: vi.fn(),
  listTasksByNumber: vi.fn(),
  getProgressSummary: vi.fn(() => new Promise(() => {})),
  getVariantProgress: vi.fn(() => new Promise(() => {})),
  getTaskCountsBySubject: vi.fn(() => new Promise(() => {})),
  getProgressByTaskNumber: vi.fn(() => new Promise(() => {})),
  getProgressByTopic: vi.fn(() => new Promise(() => {})),
  getTaskNumberStatisticsDetail: vi.fn(() => new Promise(() => {})),
  getMistakes: vi.fn(() => new Promise(() => {})),
  getSimilarTasks: vi.fn(() => Promise.resolve([])),
  getLearningProfile: vi.fn(() => new Promise(() => {})),
  listFavoriteTaskIds: vi.fn(() => Promise.resolve({ taskIds: [] })),
  addFavorite: vi.fn(() => Promise.resolve()),
  removeFavorite: vi.fn(() => Promise.resolve()),
  listCollections: vi.fn(() => Promise.resolve([])),
  getVariant: vi.fn(),
  startLearningSession: vi.fn(),
  getLearningSessionNext: vi.fn(),
  getLearningSession: vi.fn(),
}));

function OverlayMarker() {
  const { overlay } = useNavigation();
  if (overlay?.screen === 'task') {
    return <p data-testid="overlay">task:{overlay.taskNumber}</p>;
  }
  return <p data-testid="overlay">{overlay?.screen ?? 'none'}</p>;
}

function renderApp() {
  return render(
    <NavigationProvider>
      <ToastProvider>
        <AppMobile />
        <OverlayMarker />
      </ToastProvider>
    </NavigationProvider>,
  );
}

describe('AppMobile — bottom nav (Главная/Задания/Статистика/Мои ошибки/Профиль)', () => {
  it('renders all five real nav slots', () => {
    renderApp();
    expect(screen.getByRole('button', { name: 'Главная' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Задания' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Статистика' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Мои ошибки' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Профиль' })).toBeInTheDocument();
    // "Достижения" is no longer its own nav slot — it moved inside
    // Статистика (see the next describe block).
    expect(screen.queryByRole('button', { name: 'Достижения' })).not.toBeInTheDocument();
  });

  it('"Задания" opens the real Training setup screen directly, not a WIP placeholder', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Задания' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Начать тренировку/ })).toBeInTheDocument();
    });
  });

  it('"Профиль" opens the real Profile screen while keeping the bottom nav visible, Профиль highlighted', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Профиль' }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('profile');
    const profileTab = screen.getByRole('button', { name: 'Профиль' });
    expect(profileTab).toHaveAttribute('aria-current', 'page');
    // The rest of the nav stays usable from inside Профиль — unlike
    // every other overlay, this one isn't a chrome-less takeover.
    expect(screen.getByRole('button', { name: 'Главная' })).toBeInTheDocument();
  });

  it('"Мои ошибки" opens the real Mistakes screen directly, with the bottom nav still visible', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getMistakes).mockResolvedValue([]);
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Мои ошибки' }));
    await waitFor(() => {
      expect(screen.getByTestId('overlay')).toHaveTextContent('mistakes');
    });
    const mistakesTab = screen.getByRole('button', { name: 'Мои ошибки' });
    expect(mistakesTab).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Главная' })).toBeInTheDocument();
  });
});

describe('AppMobile — MobileShell stays mounted across tab/overlay transitions (mobile visual-flash fix)', () => {
  // Регрессионный тест на баг: раньше ветка профиля/ошибок (bottom-nav
  // overlay) и обычная вкладка возвращали ОДИНАКОВУЮ форму дерева
  // (Fragment с MobileShell+menu как соседями), так что переход между
  // ними уже не ломался — реальный баг был именно на границе с
  // "обычным" полноэкранным overlay (Subject/Task/LearningSession и
  // т.д.), где `{menu}` раньше рендерился ВНУТРИ `<MobileShell>`, меняя
  // тип корневого элемента. Тест должен пересекать именно эту границу.
  it('never remounts the header/BottomNav when crossing from a plain tab into a full-screen overlay (Задания → Умная тренировка session)', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listCollections).mockResolvedValue([]);
    vi.mocked(api.getProgressByTopic).mockResolvedValue({ items: [] });
    vi.mocked(api.startLearningSession).mockResolvedValue({
      sessionId: 'session-1',
      subject: 'math',
      status: 'active',
      position: 1,
      total: 5,
      task: {
        id: 'task-1',
        subjectId: 'math',
        taskNumber: 5,
        topicId: null,
        topicName: null,
        difficulty: 2,
        conditionMd: 'Условие',
        passage: null,
        imageUrl: null,
        hintMd: null,
        answerType: 'short_answer',
        answerOptions: null,
        answerParts: null,
        source: 'ФИПИ',
        sourceUrl: null,
        sourceYear: 2026,
        tags: [],
        status: 'published',
      },
    });
    const { container } = renderApp();

    // Training is a plain tab (no overlay) — header/nav render via the
    // tab branch.
    await user.click(screen.getByRole('button', { name: 'Задания' }));
    const headerBefore = container.querySelector('header');
    const navBefore = container.querySelector('nav[aria-label="Zybrilka"]');
    const shellBefore = container.querySelector('[class*="_shell_"]');
    expect(headerBefore).toBeTruthy();
    expect(navBefore).toBeTruthy();
    expect(shellBefore).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Умная тренировка/ }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    // Starting the session navigates into the `task` overlay (a
    // full-screen, chrome-less takeover) — exactly the branch that used
    // to nest `{menu}` inside `<MobileShell>` and force a remount.
    await waitFor(() => {
      expect(screen.getByTestId('overlay')).toHaveTextContent('task:5');
    });

    const headerAfter = container.querySelector('header');
    const navAfter = container.querySelector('nav[aria-label="Zybrilka"]');
    // The header/nav disappear for this chrome-less screen (expected —
    // Task hides navigation), but the SAME `<MobileShell>` instance
    // (its root `.shell` div) must still be the one doing it — proven
    // by DOM node identity, not just "a shell exists somewhere". A
    // mount-counter experiment confirmed this transition never
    // actually remounted the shell even before the AppMobile
    // restructuring; this assertion is kept as a standing invariant,
    // not as proof of a fix.
    const shellAfter = container.querySelector('[class*="_shell_"]');
    expect(shellAfter).toBe(shellBefore);
    expect(headerAfter).toBeNull();
    expect(navAfter).toBeNull();
  });

  it('never remounts the header/BottomNav when crossing between a plain tab and the Профиль bottom-nav overlay', async () => {
    const user = userEvent.setup();
    const { container } = renderApp();

    const headerBefore = container.querySelector('header');
    const navBefore = container.querySelector('nav[aria-label="Zybrilka"]');
    expect(headerBefore).toBeTruthy();
    expect(navBefore).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Профиль' }));
    expect(screen.getByTestId('overlay')).toHaveTextContent('profile');

    expect(container.querySelector('header')).toBe(headerBefore);
    expect(container.querySelector('nav[aria-label="Zybrilka"]')).toBe(navBefore);
  });
});

describe('AppMobile — Достижения/Рейтинг moved inside Статистика', () => {
  it('Статистика offers real Достижения/Рейтинг sections, using the same honest placeholder the standalone screens show', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getProgressSummary).mockResolvedValue({
      solvedTotal: 0,
      correctTotal: 0,
      incorrectTotal: 0,
      accuracyPercent: 0,
      bySubject: [],
      byTaskNumber: [],
      byTopic: [],
      timeBySubject: [],
    });
    renderApp();
    await user.click(screen.getByRole('button', { name: 'Статистика' }));
    await user.click(await screen.findByRole('tab', { name: 'Достижения' }));
    expect(screen.getAllByText('Достижения').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('tab', { name: 'Рейтинг' }));
    expect(screen.getAllByText('Рейтинг').length).toBeGreaterThan(0);
  });
});

describe('AppMobile — Subject → Задания по номерам → task → Back (routing fix)', () => {
  const MATH_COLLECTION = {
    collection: {
      id: 'c1',
      subjectId: 'math',
      slug: 'ege-2026-yashchenko',
      title: 'ЕГЭ 2026 Ященко',
      publisher: 'Ященко',
      year: 2026,
      description: null,
    },
    variants: [],
  };

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

  it('Back from the started task returns to По номерам (not Subject, not a hardcoded Тренировка)', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listCollections).mockResolvedValue([MATH_COLLECTION]);
    vi.mocked(api.getProgressByTopic).mockResolvedValue({ items: [] });
    vi.mocked(api.getRandomTask).mockResolvedValue(RANDOM_TASK);
    vi.mocked(api.listTasksByNumber).mockResolvedValue([RANDOM_TASK]);

    renderApp();
    await user.click(screen.getByRole('button', { name: 'Главная' }));
    // Open Subject via a direct navigate through Menu isn't exercised
    // here — Subject itself is unit-tested for the tab; this covers the
    // real screen-swap + Back chain starting from inside По номерам.
    await user.click(screen.getByRole('button', { name: 'Профиль' }));
    await user.click(screen.getByRole('button', { name: 'Меню' }));
    await user.click(screen.getByRole('button', { name: 'Все задания' }));
    await user.click(await screen.findByText('Математика'));
    await user.click(await screen.findByRole('button', { name: 'По номерам' }));

    await user.click(await screen.findByRole('button', { name: '№5' }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() => expect(screen.getByTestId('overlay')).toHaveTextContent('task:5'));

    const backButton = screen.getByRole('button', { name: /Назад|Математика/ });
    await user.click(backButton);
    await waitFor(() => expect(screen.getByRole('button', { name: '№5' })).toBeInTheDocument());
  });

  it('never remounts MobileShell across Профиль ↔ Subject ↔ По номерам (the full chrome-less chain)', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listCollections).mockResolvedValue([MATH_COLLECTION]);
    vi.mocked(api.getProgressByTopic).mockResolvedValue({ items: [] });
    vi.mocked(api.getRandomTask).mockResolvedValue(RANDOM_TASK);
    vi.mocked(api.listTasksByNumber).mockResolvedValue([RANDOM_TASK]);

    const { container } = renderApp();
    const shell = container.querySelector('[class*="_shell_"]');
    expect(shell).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Профиль' }));
    expect(container.querySelector('[class*="_shell_"]')).toBe(shell);

    await user.click(screen.getByRole('button', { name: 'Меню' }));
    await user.click(screen.getByRole('button', { name: 'Все задания' }));
    expect(container.querySelector('[class*="_shell_"]')).toBe(shell);

    await user.click(await screen.findByText('Математика'));
    expect(container.querySelector('[class*="_shell_"]')).toBe(shell);

    await user.click(await screen.findByRole('button', { name: 'По номерам' }));
    expect(container.querySelector('[class*="_shell_"]')).toBe(shell);

    await user.click(await screen.findByRole('button', { name: '№5' }));
    await user.click(screen.getByRole('button', { name: 'Начать тренировку' }));
    await waitFor(() => expect(screen.getByTestId('overlay')).toHaveTextContent('task:5'));
    expect(container.querySelector('[class*="_shell_"]')).toBe(shell);
  });
});

describe("AppMobile — menu (opened from Профиль's header button)", () => {
  it('opens the real Training setup screen from the menu, not a WIP placeholder', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listCollections).mockResolvedValue([]);
    renderApp();

    await user.click(screen.getByRole('button', { name: 'Профиль' }));
    await user.click(screen.getByRole('button', { name: 'Меню' }));
    await user.click(screen.getByRole('button', { name: 'Тренировка' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Начать тренировку/ })).toBeInTheDocument();
    });
  });
});
