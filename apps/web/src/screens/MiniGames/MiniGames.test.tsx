import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StressProgressResponse, StressRoundResponse } from '@zybrilka/shared';
import { MINI_GAMES } from '@zybrilka/shared';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import { TestAuthProvider, makeAuthUser } from '../../lib/authTestUtils.js';
import { AccountGateProvider } from '../../lib/accountGate.js';
import * as api from '../../lib/api.js';
import { MiniGames } from './MiniGames.js';
import { StressGame } from './StressGame.js';

vi.mock('../../lib/api.js', () => ({
  getMiniGames: vi.fn(),
  getStressRound: vi.fn(),
  answerStress: vi.fn(),
  getStressProgress: vi.fn(),
  ApiError: class extends Error {},
}));

function Where() {
  const { overlay } = useNavigation();
  return <p data-testid="where">{overlay?.screen ?? 'none'}</p>;
}

function renderWith(ui: React.ReactNode, user: ReturnType<typeof makeAuthUser> | null) {
  return render(
    <NavigationProvider>
      <TestAuthProvider user={user}>
        <AccountGateProvider>
          {ui}
          <Where />
        </AccountGateProvider>
      </TestAuthProvider>
    </NavigationProvider>,
  );
}

const ROUND: StressRoundResponse = {
  mode: 'all',
  dictionarySize: 200,
  questions: [
    {
      wordId: 'w-torty',
      display: 'торты',
      vowels: [1, 4],
      partOfSpeech: 'сущ.',
      formNote: 'И. п. мн. ч.',
    },
    { wordId: 'w-zvonit', display: 'звонит', vowels: [2, 4], partOfSpeech: 'гл.', formNote: null },
  ],
};

const PROGRESS: StressProgressResponse = {
  dictionarySize: 200,
  learned: 12,
  seen: 30,
  answers: 50,
  correct: 40,
  wrong: 10,
  accuracyPercent: 80,
  mistakes: 4,
  hardWords: [{ wordId: 'w1', marked: 'тОрты', wrong: 3, correct: 1 }],
  daily: [{ date: '2026-10-25', answers: 50, correct: 40 }],
};

beforeEach(() => {
  vi.mocked(api.getStressRound).mockReset().mockResolvedValue(ROUND);
  vi.mocked(api.answerStress).mockReset();
  vi.mocked(api.getStressProgress).mockReset().mockResolvedValue(PROGRESS);
  vi.mocked(api.getMiniGames).mockReset();
});

describe('Мини-игры', () => {
  it('the hub shows each game card with subject, description and progress; «Играть» opens it', async () => {
    vi.mocked(api.getMiniGames).mockResolvedValue({
      games: MINI_GAMES.map((g) => ({ ...g, progress: { learned: 12, total: 200 } })),
    });
    const user = userEvent.setup();
    renderWith(<MiniGames />, makeAuthUser());
    const card = (await screen.findByRole('heading', { name: 'Ударения' })).closest('li')!;
    expect(within(card).getByText('Русский язык')).toBeInTheDocument();
    expect(within(card).getByText('Задание 4')).toBeInTheDocument();
    expect(within(card).getByText('Выучено 12 из 200')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Играть: Ударения' }));
    expect(screen.getByTestId('where')).toHaveTextContent('stressGame');
  });
});

describe('Ударения', () => {
  it('tap the stressed vowel → checked on the server → the right form is shown', async () => {
    vi.mocked(api.answerStress).mockResolvedValue({
      correct: true,
      correctIndex: 1,
      marked: 'тОрты',
      formNote: 'И. п. мн. ч.',
      note: null,
      recorded: true,
    });
    const user = userEvent.setup();
    renderWith(<StressGame />, makeAuthUser());
    expect(await screen.findByText(/12/)).toBeInTheDocument(); // progress loaded
    await user.click(screen.getByRole('button', { name: /Продолжить тренировку/ }));
    const word = await screen.findByRole('group', { name: 'Слово «торты»' });
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    // Only vowels are buttons.
    expect(within(word).getAllByRole('button')).toHaveLength(2);
    await user.click(within(word).getByRole('button', { name: /«о», 1-я гласная/ }));
    expect(api.answerStress).toHaveBeenCalledWith({
      wordId: 'w-torty',
      index: 1,
      clientAnswerId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(await screen.findByText('Верно: тОрты')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Дальше' }));
    expect(await screen.findByRole('group', { name: 'Слово «звонит»' })).toBeInTheDocument();
  });

  it('a miss shows the right answer and «Повторить слово»; the word comes back; the summary counts first tries', async () => {
    vi.mocked(api.answerStress)
      .mockResolvedValueOnce({
        correct: false,
        correctIndex: 1,
        marked: 'тОрты',
        formNote: null,
        note: null,
        recorded: true,
      })
      .mockResolvedValueOnce({
        correct: true,
        correctIndex: 1,
        marked: 'тОрты',
        formNote: null,
        note: null,
        recorded: true,
      })
      .mockResolvedValueOnce({
        correct: true,
        correctIndex: 4,
        marked: 'звонИт',
        formNote: null,
        note: null,
        recorded: true,
      })
      .mockResolvedValueOnce({
        correct: true,
        correctIndex: 1,
        marked: 'тОрты',
        formNote: null,
        note: null,
        recorded: true,
      });
    const user = userEvent.setup();
    renderWith(<StressGame />, makeAuthUser());
    await user.click(await screen.findByRole('button', { name: /Продолжить тренировку/ }));
    const word = await screen.findByRole('group', { name: 'Слово «торты»' });
    await user.click(within(word).getByRole('button', { name: /«ы», 2-я гласная/ }));
    expect(await screen.findByText('Правильно: тОрты')).toBeInTheDocument();
    const firstId = vi.mocked(api.answerStress).mock.calls[0]![0].clientAnswerId;
    await user.click(screen.getByRole('button', { name: /Повторить слово/ }));
    await user.click(
      within(screen.getByRole('group', { name: 'Слово «торты»' })).getByRole('button', {
        name: /«о»/,
      }),
    );
    // A retry is a NEW answer (its own id).
    expect(vi.mocked(api.answerStress).mock.calls[1]![0].clientAnswerId).not.toBe(firstId);
    await user.click(await screen.findByRole('button', { name: 'Дальше' }));
    await user.click(
      within(await screen.findByRole('group', { name: 'Слово «звонит»' })).getByRole('button', {
        name: /«и»/,
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Дальше' }));
    // The missed word is back before the round ends.
    await user.click(
      within(await screen.findByRole('group', { name: 'Слово «торты»' })).getByRole('button', {
        name: /«о»/,
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Дальше' }));
    expect(await screen.findByRole('heading', { name: 'Раунд окончен' })).toBeInTheDocument();
    expect(screen.getByText(/из 2 с первого раза/)).toBeInTheDocument();
    expect(screen.getByText('тОрты', { selector: 'li' })).toBeInTheDocument();
  });

  it('a network error keeps the same answer id for the retry (counted once)', async () => {
    vi.mocked(api.answerStress)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        correct: true,
        correctIndex: 1,
        marked: 'тОрты',
        formNote: null,
        note: null,
        recorded: true,
      });
    const user = userEvent.setup();
    renderWith(<StressGame />, makeAuthUser());
    await user.click(await screen.findByRole('button', { name: /Продолжить тренировку/ }));
    const vowel = () =>
      within(screen.getByRole('group', { name: 'Слово «торты»' })).getByRole('button', {
        name: /«о»/,
      });
    await screen.findByRole('group', { name: 'Слово «торты»' });
    await user.click(vowel());
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось проверить');
    await user.click(vowel());
    await screen.findByText('Верно: тОрты');
    const [a, b] = vi.mocked(api.answerStress).mock.calls.map((c) => c[0].clientAnswerId);
    expect(a).toBe(b);
  });

  it('shows the saved progress: learned, accuracy, hard words, days', async () => {
    renderWith(<StressGame />, makeAuthUser());
    const panel = (await screen.findByRole('heading', { name: 'Прогресс' })).closest('section')!;
    expect(within(panel).getByText('12')).toBeInTheDocument();
    expect(within(panel).getByText('80%')).toBeInTheDocument();
    expect(within(panel).getByText(/тОрты/)).toBeInTheDocument();
    expect(within(panel).getByRole('list', { name: 'Ответы по дням' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Мои ошибки · 4/ })).toBeInTheDocument();
  });

  it('a guest can play; personal modes ask to sign in; no progress is requested', async () => {
    const user = userEvent.setup();
    renderWith(<StressGame />, null);
    expect(screen.getByText(/Играть можно без входа/)).toBeInTheDocument();
    expect(api.getStressProgress).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Мои ошибки/ }));
    expect(await screen.findByText('Прогресс в игре — после входа')).toBeInTheDocument();
    expect(api.getStressRound).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Начать' })).toBeInTheDocument());
  });

  it('says honestly where the words come from', () => {
    renderWith(<StressGame />, null);
    expect(screen.getByText(/не полный официальный перечень на 2026 год/)).toBeInTheDocument();
  });
});
