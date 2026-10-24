import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatusChips } from './StatusChips.js';
import { TestAuthProvider, makeAuthUser } from '../../lib/authTestUtils.js';
import { StreakProvider, useStreakContext } from '../../lib/streakContext.js';
import * as api from '../../lib/api.js';
import { NavigationProvider } from '../../lib/navigation.js';

vi.mock('../../lib/api.js', () => ({
  // The rating place (StreakProvider): pending unless a test says otherwise.
  getLeaderboard: vi.fn(() => new Promise(() => {})),
  getStreak: vi.fn(() => new Promise(() => {})),
  getXpSummary: vi.fn(() => new Promise(() => {})),
}));

describe('StatusChips — outside a StreakProvider (default context)', () => {
  it('shows a neutral dash for streak/level, never a fabricated number or emoji', () => {
    render(<StatusChips />);
    expect(screen.getByText('Серия')).toBeInTheDocument();
    expect(screen.getByText('Уровень')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/🔥|👑/);
  });

  it('never renders StreakBadge/LevelBadge images, since no real day/level count backs them', () => {
    render(<StatusChips />);
    expect(document.querySelector('img')).not.toBeInTheDocument();
  });
});

describe('StatusChips — with a real StreakProvider (GET /progress/streak)', () => {
  it('shows "—" while the real streak is still loading, never a fabricated 0', async () => {
    vi.mocked(api.getStreak).mockReturnValue(new Promise(() => {}));
    render(
      <TestAuthProvider user={makeAuthUser()}>
        <StreakProvider>
          <StatusChips />
        </StreakProvider>
      </TestAuthProvider>,
    );
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    // Level is "—" too until GET /progress/xp answers.
    expect(screen.getByRole('button', { name: /Уровень загружается/ })).toHaveTextContent('—');
  });

  it('shows the real currentStreak once GET /progress/streak resolves', async () => {
    vi.mocked(api.getStreak).mockResolvedValue({
      currentStreak: 7,
      lastActiveDate: '2026-10-03',
      isActiveToday: true,
    });
    render(
      <TestAuthProvider user={makeAuthUser()}>
        <StreakProvider>
          <StatusChips />
        </StreakProvider>
      </TestAuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument());
  });

  it('a real currentStreak of 0 renders as an honest "0", not hidden behind the loading dash', async () => {
    vi.mocked(api.getStreak).mockResolvedValue({
      currentStreak: 0,
      lastActiveDate: null,
      isActiveToday: false,
    });
    render(
      <TestAuthProvider user={makeAuthUser()}>
        <StreakProvider>
          <StatusChips />
        </StreakProvider>
      </TestAuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('0')).toBeInTheDocument());
  });

  it('never computes the streak itself — displays exactly what the backend returns, nothing derived', async () => {
    vi.mocked(api.getStreak).mockResolvedValue({
      currentStreak: 42,
      lastActiveDate: '2026-10-03',
      isActiveToday: true,
    });
    render(
      <TestAuthProvider user={makeAuthUser()}>
        <StreakProvider>
          <StatusChips />
        </StreakProvider>
      </TestAuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());
    expect(api.getStreak).toHaveBeenCalledTimes(1);
  });
});

function RefreshButton() {
  const { refreshStreak } = useStreakContext();
  return (
    <button type="button" onClick={refreshStreak}>
      refresh
    </button>
  );
}

describe('StatusChips — streak-increase animation', () => {
  it('never pulses on first load, even though the streak "increased" from nothing to a real number', async () => {
    vi.mocked(api.getStreak).mockResolvedValue({
      currentStreak: 5,
      lastActiveDate: '2026-10-03',
      isActiveToday: true,
    });
    render(
      <TestAuthProvider user={makeAuthUser()}>
        <StreakProvider>
          <StatusChips />
        </StreakProvider>
      </TestAuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument());
    expect(document.querySelector('[class*="chipStreakUp"]')).not.toBeInTheDocument();
  });

  it('pulses only when a refresh genuinely raises the known streak value', async () => {
    vi.mocked(api.getStreak)
      .mockResolvedValueOnce({
        currentStreak: 5,
        lastActiveDate: '2026-10-02',
        isActiveToday: false,
      })
      .mockResolvedValueOnce({
        currentStreak: 6,
        lastActiveDate: '2026-10-03',
        isActiveToday: true,
      });
    const user = userEvent.setup();
    render(
      <TestAuthProvider user={makeAuthUser()}>
        <StreakProvider>
          <StatusChips />
          <RefreshButton />
        </StreakProvider>
      </TestAuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument());
    expect(document.querySelector('[class*="chipStreakUp"]')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'refresh' }));
    await waitFor(() => expect(screen.getByText('6')).toBeInTheDocument());
    expect(document.querySelector('[class*="chipStreakUp"]')).toBeInTheDocument();
  });
});

describe('StatusChips — streak flame tiers', () => {
  const streakOf = (n: number) => ({
    currentStreak: n,
    lastActiveDate: '2026-10-03',
    isActiveToday: true,
  });
  const renderWith = () =>
    render(
      <TestAuthProvider user={makeAuthUser()}>
        <StreakProvider>
          <StatusChips />
          <RefreshButton />
        </StreakProvider>
      </TestAuthProvider>,
    );
  const flame = () => document.querySelector('svg[data-tier]')!;

  it.each([
    [0, '0'],
    [1, '1'],
    [5, '2'],
    [15, '3'],
    [30, '4'],
    [40, '5'],
    [60, '6'],
    [120, '6'],
  ])('%i days draws tier %s (0 = no lit flame)', async (days, tier) => {
    vi.mocked(api.getStreak).mockResolvedValue(streakOf(days));
    renderWith();
    await waitFor(() => expect(flame()).toHaveAttribute('data-tier', tier));
    expect(screen.getByLabelText(new RegExp(`Серия: ${days} `))).toBeInTheDocument();
  });

  it('the level-up burst plays only when a real refresh crosses into a new tier', async () => {
    vi.mocked(api.getStreak).mockResolvedValue(streakOf(4));
    const user = userEvent.setup();
    renderWith();
    await waitFor(() => expect(flame()).toHaveAttribute('data-tier', '1'));
    expect(flame()).not.toHaveAttribute('data-level-up');
    vi.mocked(api.getStreak).mockResolvedValue(streakOf(5));
    await user.click(screen.getByRole('button', { name: 'refresh' }));
    await waitFor(() => expect(flame()).toHaveAttribute('data-level-up'));
    expect(flame()).toHaveAttribute('data-tier', '2');
  });

  it('a higher streak within the same tier pulses but does not burst', async () => {
    vi.mocked(api.getStreak).mockResolvedValue(streakOf(6));
    const user = userEvent.setup();
    renderWith();
    await waitFor(() => expect(flame()).toHaveAttribute('data-tier', '2'));
    vi.mocked(api.getStreak).mockResolvedValue(streakOf(7));
    await user.click(screen.getByRole('button', { name: 'refresh' }));
    await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument());
    expect(flame()).not.toHaveAttribute('data-level-up');
  });
});

describe('StatusChips — level (GET /progress/xp)', () => {
  const xpAt = (totalXp: number, level: number, extra: object = {}) => ({
    totalXp,
    level,
    levelStartXp: 50,
    nextLevelXp: 130,
    xpIntoLevel: totalXp - 50,
    xpForNextLevel: 80,
    xpToNextLevel: 130 - totalXp,
    progress: (totalXp - 50) / 80,
    maxLevel: 50,
    isMaxLevel: false,
    ...extra,
  });

  it('shows the real level from the server and a progress bar', async () => {
    vi.mocked(api.getStreak).mockResolvedValue({
      currentStreak: 1,
      lastActiveDate: '2026-10-03',
      isActiveToday: true,
    });
    vi.mocked(api.getXpSummary).mockResolvedValue(xpAt(90, 2));
    render(
      <TestAuthProvider user={makeAuthUser()}>
        <StreakProvider>
          <StatusChips />
        </StreakProvider>
      </TestAuthProvider>,
    );
    const chip = await screen.findByRole('button', {
      name: 'Уровень 2, до следующего 40 XP, ранг «Новичок». Открыть страницу уровня',
    });
    expect(chip).toHaveTextContent('2');
    expect(chip.querySelector('[style*="width: 50%"]')).not.toBeNull();
  });

  it('the level chip wears the rank of the server-reported level', async () => {
    vi.mocked(api.getXpSummary).mockResolvedValue(xpAt(90, 16));
    render(
      <TestAuthProvider user={makeAuthUser()}>
        <StreakProvider>
          <StatusChips />
        </StreakProvider>
      </TestAuthProvider>,
    );
    const chip = await screen.findByRole('button', { name: /ранг «Эксперт»/ });
    expect(chip).toHaveAttribute('data-rank', 'expert');
    expect(chip.querySelector('[data-rank="expert"] img')).toHaveAttribute(
      'src',
      '/branding/v2/levels/expert.webp',
    );
  });

  const board = (rank: number | null, participants = 40) => ({
    period: 'week' as const,
    subjectId: null,
    since: '2026-10-17T00:00:00.000Z',
    participants,
    entries: [],
    me: { rank, level: 3, points: rank === null ? 0 : 120, solved: 5, accuracyPercent: 80 },
  });
  const renderChips = (showRating: boolean) => {
    window.history.replaceState(null, '', '/');
    return render(
      <TestAuthProvider user={makeAuthUser()}>
        <NavigationProvider>
          <StreakProvider>
            <StatusChips showRating={showRating} />
          </StreakProvider>
        </NavigationProvider>
      </TestAuthProvider>,
    );
  };

  it('desktop: shows the weekly rating place, asking only for «me» once', async () => {
    vi.mocked(api.getXpSummary).mockResolvedValue(xpAt(90, 2));
    vi.mocked(api.getLeaderboard).mockClear();
    vi.mocked(api.getLeaderboard).mockResolvedValue(board(6));
    renderChips(true);
    const chip = await screen.findByRole('button', {
      name: 'Место в рейтинге за неделю: 6 из 40. Открыть рейтинг',
    });
    expect(chip).toHaveTextContent('#6');
    expect(api.getLeaderboard).toHaveBeenCalledTimes(1);
    expect(api.getLeaderboard).toHaveBeenCalledWith({ period: 'week', limit: 0 });
    await userEvent.click(chip);
    expect(window.location.pathname).toBe('/rating');
  });

  it('desktop: no points this week → «—», never a made-up place', async () => {
    vi.mocked(api.getLeaderboard).mockResolvedValue(board(null));
    renderChips(true);
    const chip = await screen.findByRole('button', {
      name: 'На этой неделе ещё нет места в рейтинге. Открыть рейтинг',
    });
    expect(chip).toHaveTextContent('—');
  });

  it('desktop: while loading, a neutral dash', () => {
    vi.mocked(api.getLeaderboard).mockReturnValue(new Promise(() => {}));
    renderChips(true);
    expect(
      screen.getByRole('button', { name: 'Место в рейтинге загружается. Открыть рейтинг' }),
    ).toHaveTextContent('—');
  });

  it('mobile header (no showRating): no rating chip — mobile shows it on the home screen', async () => {
    vi.mocked(api.getLeaderboard).mockResolvedValue(board(6));
    renderChips(false);
    await screen.findByRole('button', { name: /Уровень/ });
    expect(screen.queryByRole('button', { name: /рейтинг/i })).not.toBeInTheDocument();
  });

  it('opens the «Уровень» page on click', async () => {
    vi.mocked(api.getXpSummary).mockResolvedValue(xpAt(90, 2));
    window.history.replaceState(null, '', '/');
    render(
      <TestAuthProvider user={makeAuthUser()}>
        <NavigationProvider>
          <StreakProvider>
            <StatusChips />
          </StreakProvider>
        </NavigationProvider>
      </TestAuthProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: /Уровень 2/ }));
    expect(window.location.pathname).toBe('/level');
  });
});
