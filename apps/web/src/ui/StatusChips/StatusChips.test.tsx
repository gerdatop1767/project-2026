import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatusChips } from './StatusChips.js';
import { StreakProvider, useStreakContext } from '../../lib/streakContext.js';
import * as api from '../../lib/api.js';

vi.mock('../../lib/api.js', () => ({
  getStreak: vi.fn(() => new Promise(() => {})),
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
      <StreakProvider>
        <StatusChips />
      </StreakProvider>,
    );
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    // Level stays "—" unconditionally — no backend behind it yet.
    expect(screen.getByText('Уровень').closest('div')).toHaveTextContent('—');
  });

  it('shows the real currentStreak once GET /progress/streak resolves', async () => {
    vi.mocked(api.getStreak).mockResolvedValue({
      currentStreak: 7,
      lastActiveDate: '2026-10-03',
      isActiveToday: true,
    });
    render(
      <StreakProvider>
        <StatusChips />
      </StreakProvider>,
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
      <StreakProvider>
        <StatusChips />
      </StreakProvider>,
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
      <StreakProvider>
        <StatusChips />
      </StreakProvider>,
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
      <StreakProvider>
        <StatusChips />
      </StreakProvider>,
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
      <StreakProvider>
        <StatusChips />
        <RefreshButton />
      </StreakProvider>,
    );
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument());
    expect(document.querySelector('[class*="chipStreakUp"]')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'refresh' }));
    await waitFor(() => expect(screen.getByText('6')).toBeInTheDocument());
    expect(document.querySelector('[class*="chipStreakUp"]')).toBeInTheDocument();
  });
});
