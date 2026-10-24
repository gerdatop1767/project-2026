import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { XpSummaryResponse } from '@zybrilka/shared';
import { Level } from './Level.js';
import { StatusChips } from '../../ui/StatusChips/StatusChips.js';
import { TestAuthProvider, makeAuthUser } from '../../lib/authTestUtils.js';
import { NavigationProvider } from '../../lib/navigation.js';
import { StreakProvider } from '../../lib/streakContext.js';
import * as api from '../../lib/api.js';

vi.mock('../../lib/api.js', () => ({
  // The rating place (StreakProvider): pending unless a test says otherwise.
  getLeaderboard: vi.fn(() => new Promise(() => {})),
  getStreak: vi.fn(),
  getXpSummary: vi.fn(),
  getXpHistory: vi.fn(),
}));

const summary = (over: Partial<XpSummaryResponse> = {}): XpSummaryResponse => ({
  totalXp: 90,
  level: 2,
  levelStartXp: 50,
  nextLevelXp: 130,
  xpIntoLevel: 40,
  xpForNextLevel: 80,
  xpToNextLevel: 40,
  progress: 0.5,
  maxLevel: 50,
  isMaxLevel: false,
  ...over,
});

function renderLevel(withHeader = false) {
  window.history.replaceState(null, '', '/level');
  return render(
    <TestAuthProvider user={makeAuthUser()}>
      <NavigationProvider>
        <StreakProvider>
          {withHeader && <StatusChips />}
          <Level />
        </StreakProvider>
      </NavigationProvider>
    </TestAuthProvider>,
  );
}

describe('«Уровень» page', () => {
  beforeEach(() => {
    vi.mocked(api.getStreak).mockResolvedValue({
      currentStreak: 3,
      lastActiveDate: '2026-10-22',
      isActiveToday: true,
    });
    vi.mocked(api.getXpSummary).mockResolvedValue(summary());
    vi.mocked(api.getXpHistory).mockResolvedValue({ items: [], nextCursor: null });
  });

  it('shows level, total XP, progress and what is left — all from the API', async () => {
    renderLevel();
    expect(await screen.findByText('Уровень 2')).toBeInTheDocument();
    expect(screen.getByText('Всего опыта: 90 XP')).toBeInTheDocument();
    expect(screen.getByText('40 / 80 XP')).toBeInTheDocument();
    expect(screen.getByText('Уровень 3')).toBeInTheDocument();
    expect(screen.getByText(/До уровня 3 осталось/)).toHaveTextContent('40 XP');
    expect(screen.getByRole('progressbar', { name: 'Прогресс до уровня 3' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );
  });

  it('header chip and page show the same level', async () => {
    renderLevel(true);
    await screen.findByText('Уровень 2');
    expect(screen.getByRole('button', { name: /^Уровень 2, до следующего 40 XP/ })).toBeVisible();
  });

  it('shows the rank of the current level, the next rank and the ladder of all ranks', async () => {
    vi.mocked(api.getXpSummary).mockResolvedValue(summary({ level: 16, totalXp: 6000 }));
    renderLevel();
    expect(await screen.findByText(/Ранг «Мастер»/)).toHaveTextContent('4 из 6');
    expect(screen.getByText(/Следующий ранг/)).toHaveTextContent(
      'Следующий ранг — «Эксперт» с уровня 20',
    );
    const items = within(screen.getByRole('region', { name: 'Ранги' })).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('НовичокУровни 1–2'),
      expect.stringContaining('УченикУровни 3–4'),
      expect.stringContaining('ЗнатокУровни 5–14'),
      expect.stringContaining('МастерУровни 15–19Ваш ранг'),
      expect.stringContaining('ЭкспертУровни 20–24Откроется с уровня 20'),
      expect.stringContaining('ЛегендаУровни 25–50Откроется с уровня 25'),
    ]);
    expect(items[3]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).toHaveTextContent('Пройден');
  });

  it('the top rank says so instead of a next rank', async () => {
    vi.mocked(api.getXpSummary).mockResolvedValue(summary({ level: 27, totalXp: 30000 }));
    renderLevel();
    expect(await screen.findByText(/Ранг «Легенда»/)).toBeInTheDocument();
    expect(screen.getByText('Это высший ранг — так держать!')).toBeInTheDocument();
  });

  it('lists the XP history and loads more pages', async () => {
    vi.mocked(api.getXpHistory)
      .mockResolvedValueOnce({
        items: [
          {
            id: '00000000-0000-4000-8000-000000000001',
            amount: 25,
            kind: 'task_first_solve',
            createdAt: '2026-10-22T10:00:00.000Z',
            task: {
              id: '00000000-0000-4000-8000-0000000000aa',
              subjectId: 'math',
              subjectName: 'Математика',
              taskNumber: 13,
            },
          },
        ],
        nextCursor: 'next',
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: '00000000-0000-4000-8000-000000000002',
            amount: 8,
            kind: 'task_review',
            createdAt: '2026-10-01T10:00:00.000Z',
            task: null,
          },
        ],
        nextCursor: null,
      });
    renderLevel();
    expect(await screen.findByText('+25 XP')).toBeInTheDocument();
    expect(screen.getByText(/Математика · задание 13/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Показать ещё' }));
    expect(await screen.findByText('+8 XP')).toBeInTheDocument();
    expect(screen.getByText('Повторение')).toBeInTheDocument();
    expect(vi.mocked(api.getXpHistory)).toHaveBeenLastCalledWith('next');
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument();
  });

  it('explains an empty history', async () => {
    renderLevel();
    expect(await screen.findByText(/Пока пусто/)).toBeInTheDocument();
  });

  it('shows the maximum level state', async () => {
    vi.mocked(api.getXpSummary).mockResolvedValue(
      summary({
        level: 50,
        totalXp: 200000,
        nextLevelXp: null,
        xpForNextLevel: null,
        xpToNextLevel: null,
        progress: 1,
        isMaxLevel: true,
      }),
    );
    renderLevel();
    expect(await screen.findByText('Это максимальный уровень')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('offers a retry when loading fails, without inventing numbers', async () => {
    // Both initial requests (provider mount + page open) fail; the retry works.
    vi.mocked(api.getXpSummary).mockRejectedValueOnce(new Error('offline'));
    vi.mocked(api.getXpSummary).mockRejectedValueOnce(new Error('offline'));
    vi.mocked(api.getXpHistory).mockRejectedValueOnce(new Error('offline'));
    renderLevel();
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    const alerts = screen.getAllByRole('alert');
    expect(alerts.map((a) => a.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Не удалось загрузить уровень'),
        expect.stringContaining('Не удалось загрузить историю'),
      ]),
    );
    expect(screen.queryByText(/XP$/)).not.toBeInTheDocument();
    await userEvent.click(
      within(alerts.find((a) => a.textContent?.includes('уровень'))!).getByRole('button', {
        name: 'Повторить',
      }),
    );
    await waitFor(() => expect(screen.getByText('Уровень 2')).toBeInTheDocument());
  });
});
