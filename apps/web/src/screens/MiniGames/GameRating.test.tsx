import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MiniGameRatingEntry } from '@zybrilka/shared';
import * as api from '../../lib/api.js';
import { GameRating, gamesWord } from './GameRating.js';

vi.mock('../../lib/api.js', () => ({ getMiniGameRating: vi.fn() }));

const entry = (over: Partial<MiniGameRatingEntry>): MiniGameRatingEntry => ({
  rank: 1,
  name: 'Анна',
  isMe: false,
  avatarHue: 10,
  avatarVariant: 1,
  avatarUrl: null,
  points: 70,
  bestCorrect: 5,
  bestQuestions: 5,
  bestAccuracyPercent: 100,
  bestAt: '2026-11-20T10:00:00.000Z',
  rounds: 3,
  ...over,
});

beforeEach(() => vi.mocked(api.getMiniGameRating).mockReset());

describe('a game’s own rating', () => {
  it('«Лучший результат» by default: points, right answers, accuracy, date; «Всего очков» on a switch', async () => {
    vi.mocked(api.getMiniGameRating).mockImplementation(async (gameId, kind) => ({
      gameId,
      kind,
      players: 2,
      entries:
        kind === 'best'
          ? [
              entry({}),
              entry({
                rank: 2,
                name: 'Борис',
                points: 60,
                bestCorrect: 6,
                bestQuestions: 10,
                bestAccuracyPercent: 60,
              }),
            ]
          : [entry({ points: 90 }), entry({ rank: 1, name: 'Борис', points: 90, rounds: 21 })],
      me: null,
    }));
    const user = userEvent.setup();
    render(<GameRating gameId="nn" />);
    const best = await screen.findByRole('list', { name: 'Лучший результат' });
    expect(api.getMiniGameRating).toHaveBeenCalledWith('nn', 'best');
    const rows = within(best).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Анна');
    expect(rows[0]).toHaveTextContent('верно 5 из 5 · 100%');
    expect(rows[1]).toHaveTextContent('60 очк.');
    // No day/week/month switch: only the two kinds.
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Лучший результат',
      'Всего очков',
    ]);

    await user.click(screen.getByRole('tab', { name: 'Всего очков' }));
    const total = await screen.findByRole('list', { name: 'Всего очков' });
    expect(
      within(total)
        .getAllByRole('listitem')
        .map((r) => r.dataset.rank),
    ).toEqual(['1', '1']);
    expect(total).toHaveTextContent('21 игра');
  });

  it('shows the viewer’s own place when they are below the list', async () => {
    vi.mocked(api.getMiniGameRating).mockResolvedValue({
      gameId: 'nn',
      kind: 'best',
      players: 40,
      entries: [entry({})],
      me: entry({ rank: 37, name: 'Вера', isMe: true, points: 10 }),
    });
    render(<GameRating gameId="nn" />);
    const mine = await screen.findByRole('list', { name: 'Твоё место' });
    expect(mine).toHaveTextContent('37');
    expect(mine).toHaveTextContent('ты');
    expect(screen.getByText('Всего в рейтинге: 40')).toBeInTheDocument();
  });

  it('an empty rating says how to get in', async () => {
    vi.mocked(api.getMiniGameRating).mockResolvedValue({
      gameId: 'nn',
      kind: 'best',
      players: 0,
      entries: [],
      me: null,
    });
    render(<GameRating gameId="nn" />);
    expect(await screen.findByText(/Пока никто не завершил ни одной игры/)).toBeInTheDocument();
  });

  it('declines «игра» properly', () => {
    expect([1, 2, 5, 11, 12, 21, 22, 25, 111].map(gamesWord)).toEqual([
      'игра',
      'игры',
      'игр',
      'игр',
      'игр',
      'игра',
      'игры',
      'игр',
      'игр',
    ]);
  });
});
