import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LeaderboardEntry, LeaderboardResponse } from '@zybrilka/shared';
import { RatingDesktop } from './RatingDesktop.js';
import { RatingMobile } from './RatingMobile.js';
import { NavigationProvider } from '../../lib/navigation.js';
import { TestAuthProvider, makeAuthUser } from '../../lib/authTestUtils.js';
import * as api from '../../lib/api.js';

vi.mock('../../lib/api.js', () => ({ getLeaderboard: vi.fn() }));

const entry = (rank: number, name: string, over: Partial<LeaderboardEntry> = {}) => ({
  rank,
  name,
  level: 3,
  points: 1000 - rank * 50,
  solved: 40 - rank,
  accuracyPercent: 80,
  isMe: false,
  avatarHue: 200,
  avatarVariant: rank % 24,
  avatarUrl: null,
  ...over,
});

const board = (over: Partial<LeaderboardResponse> = {}): LeaderboardResponse => ({
  period: 'week',
  subjectId: null,
  since: '2026-10-17T12:00:00.000Z',
  participants: 6,
  entries: [
    entry(1, 'Анна С.'),
    entry(2, 'mathlover', { level: 16 }),
    entry(3, 'Вера'),
    entry(4, 'Тимур А.'),
    entry(5, 'Даша В.', { isMe: true, accuracyPercent: null }),
    entry(6, 'Участник'),
  ],
  me: { rank: 5, level: 3, points: 750, solved: 35, accuracyPercent: null },
  ...over,
});

function renderRating(
  ui = <RatingDesktop />,
  user: ReturnType<typeof makeAuthUser> | null = makeAuthUser(),
) {
  window.history.replaceState(null, '', '/rating');
  return render(
    <TestAuthProvider user={user}>
      <NavigationProvider>{ui}</NavigationProvider>
    </TestAuthProvider>,
  );
}

describe('Рейтинг', () => {
  beforeEach(() => {
    vi.mocked(api.getLeaderboard).mockReset();
  });

  it('loads the weekly rating for all subjects, then shows the top three and the list', async () => {
    vi.mocked(api.getLeaderboard).mockResolvedValue(board());
    renderRating();
    expect(screen.getByLabelText('Рейтинг загружается')).toBeInTheDocument();
    const podium = await screen.findByRole('list', { name: 'Тройка лидеров' });
    expect(api.getLeaderboard).toHaveBeenCalledWith({ period: 'week', subject: null });
    expect(
      within(podium)
        .getAllByRole('listitem')
        .map((li) => li.getAttribute('aria-label')),
    ).toEqual([
      '1 место: Анна С., 950 очков',
      '2 место: mathlover, 900 очков',
      '3 место: Вера, 850 очков',
    ]);
    const rows = within(screen.getByRole('table', { name: 'Рейтинг участников' })).getAllByRole(
      'row',
    );
    expect(rows.slice(1).map((r) => within(r).getAllByRole('cell')[0]!.textContent)).toEqual([
      '4',
      '5',
      '6',
    ]);
    expect(screen.getByText('Рейтинг · Неделя')).toBeInTheDocument();
  });

  it('highlights the user’s own row and never invents an accuracy it does not have', async () => {
    vi.mocked(api.getLeaderboard).mockResolvedValue(board());
    renderRating();
    const mine = await screen.findByRole('row', { current: true });
    expect(mine).toHaveTextContent('Даша В.');
    expect(mine).toHaveTextContent('Это ты');
    expect(within(mine).getAllByRole('cell')[3]).toHaveTextContent('—');
    const result = screen.getByRole('region', { name: 'Твой результат' });
    expect(result).toHaveTextContent('5место из 6 участников');
    expect(result).toHaveTextContent('750очков за 7 дней');
  });

  it('the user outside the shown list is added after a gap, with their real place', async () => {
    vi.mocked(api.getLeaderboard).mockResolvedValue(
      board({
        participants: 120,
        entries: board().entries.map((e) => ({ ...e, isMe: false })),
        me: { rank: 87, level: 2, points: 30, solved: 2, accuracyPercent: 50 },
      }),
    );
    renderRating();
    const mine = await screen.findByRole('row', { current: true });
    expect(within(mine).getAllByRole('cell')[0]).toHaveTextContent('87');
    expect(mine).toHaveTextContent('Ты');
    expect(screen.getByText('···')).toBeInTheDocument();
  });

  it('period and subject filters ask the server again (the last answer wins)', async () => {
    vi.mocked(api.getLeaderboard).mockResolvedValue(board());
    const user = userEvent.setup();
    renderRating();
    await screen.findByRole('list', { name: 'Тройка лидеров' });
    await user.click(screen.getByRole('tab', { name: 'Сегодня' }));
    await waitFor(() =>
      expect(api.getLeaderboard).toHaveBeenLastCalledWith({ period: 'today', subject: null }),
    );
    expect(screen.getByText('Рейтинг · Сегодня')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Предмет/ }));
    await user.click(await screen.findByRole('option', { name: 'Русский язык' }));
    await waitFor(() =>
      expect(api.getLeaderboard).toHaveBeenLastCalledWith({ period: 'today', subject: 'russian' }),
    );
  });

  it('while new filters load, the previous list stays (busy, dimmed) — no skeleton flash', async () => {
    let resolveNext!: (b: LeaderboardResponse) => void;
    vi.mocked(api.getLeaderboard)
      .mockResolvedValueOnce(board())
      .mockReturnValueOnce(new Promise((r) => (resolveNext = r)));
    const user = userEvent.setup();
    renderRating();
    await screen.findByRole('list', { name: 'Тройка лидеров' });
    await user.click(screen.getByRole('tab', { name: 'Всё время' }));
    // The old rows are still there, marked busy; no loading skeleton.
    const podium = screen.getByRole('list', { name: 'Тройка лидеров' });
    expect(podium.closest('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByLabelText('Рейтинг загружается')).not.toBeInTheDocument();
    resolveNext(board({ period: 'all', entries: [entry(1, 'Новый лидер')], participants: 1 }));
    expect(await screen.findByText('Новый лидер')).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('the podium wears the medal of the real place — a tie shares it', async () => {
    vi.mocked(api.getLeaderboard).mockResolvedValue(
      board({ entries: [entry(1, 'А'), entry(1, 'Б'), entry(3, 'В')] }),
    );
    renderRating();
    const podium = await screen.findByRole('list', { name: 'Тройка лидеров' });
    const medals = [...podium.querySelectorAll('[data-variant]')].map((m) =>
      m.getAttribute('data-variant'),
    );
    expect(medals).toEqual(['gold', 'gold', 'bronze']);
  });

  it('an empty period says so and offers to solve tasks', async () => {
    vi.mocked(api.getLeaderboard).mockResolvedValue(
      board({
        entries: [],
        participants: 0,
        me: { rank: null, level: 1, points: 0, solved: 0, accuracyPercent: null },
      }),
    );
    renderRating();
    expect(
      await screen.findByText('За этот период ещё никто не набрал очков.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Тройка лидеров' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Твой результат' })).toHaveTextContent(
      'пока не в рейтинге',
    );
  });

  it('a failed request shows an error with a retry, never stale or fake rows', async () => {
    vi.mocked(api.getLeaderboard)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(board());
    const user = userEvent.setup();
    renderRating(<RatingMobile />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить рейтинг.');
    expect(screen.queryByRole('row')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('list', { name: 'Тройка лидеров' })).toBeInTheDocument();
  });

  it('a guest is offered sign-in and nothing is requested', () => {
    renderRating(<RatingMobile />, null);
    expect(screen.getByText('Рейтинг виден после входа')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument();
    expect(api.getLeaderboard).not.toHaveBeenCalled();
  });

  it('every participant gets a generated avatar picked by the server — different people differ', async () => {
    vi.mocked(api.getLeaderboard).mockResolvedValue(board());
    renderRating();
    await screen.findByRole('list', { name: 'Тройка лидеров' });
    const variants = [...document.querySelectorAll('[data-avatar-variant]')].map((el) =>
      el.getAttribute('data-avatar-variant'),
    );
    expect(variants.length).toBeGreaterThanOrEqual(5);
    expect(new Set(variants).size).toBe(variants.length);
    // Nobody here has a stored picture: no image is requested.
    expect(document.querySelector('img[src*="avatar"]')).toBeNull();
  });

  it('shows the picture a participant set; a broken one falls back to the generated avatar', async () => {
    const url = '/api/v1/leaderboard/avatars/1f0c6a3e-0000-4000-8000-000000000001?v=abcdefabcdef';
    vi.mocked(api.getLeaderboard).mockResolvedValue(
      board({
        entries: [
          entry(1, 'Анна С.', { avatarUrl: url }),
          entry(2, 'Борис'),
          entry(3, 'Вера'),
          entry(4, 'Глеб'),
        ],
      }),
    );
    renderRating();
    await screen.findByRole('list', { name: 'Тройка лидеров' });
    const images = [...document.querySelectorAll<HTMLImageElement>(`img[src="${url}"]`)];
    expect(images.length).toBeGreaterThanOrEqual(1);
    expect(images[0]).toHaveAttribute('alt', '');
    // Until it loads (and if it fails) the generated one stays visible.
    expect(document.querySelectorAll('[data-avatar-variant]').length).toBeGreaterThanOrEqual(4);
    for (const img of images) fireEvent.error(img);
    expect(document.querySelector(`img[src="${url}"]`)).toBeNull();
  });
});
