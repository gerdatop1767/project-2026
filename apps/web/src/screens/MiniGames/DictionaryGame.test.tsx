import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DictionarySummaryResponse } from '@zybrilka/shared';
import * as api from '../../lib/api.js';
import { NavigationProvider } from '../../lib/navigation.js';
import { TestAuthProvider, makeAuthUser } from '../../lib/authTestUtils.js';
import { AccountGateProvider } from '../../lib/accountGate.js';
import { resetPrivateCaches } from '../../lib/privateCaches.js';
import { DictionaryGame } from './DictionaryGame.js';

vi.mock('../../lib/api.js', () => ({
  getMiniGames: vi.fn(),
  getMiniGameSettings: vi.fn(),
  saveMiniGameSettings: vi.fn(),
  getMiniGameRating: vi.fn(),
  getDictionarySummary: vi.fn(),
  getDictionaryReference: vi.fn(),
  getDictionaryRound: vi.fn(),
  answerDictionary: vi.fn(),
  finishDictionaryRound: vi.fn(),
  getDictionaryActive: vi.fn(),
  abandonDictionaryRound: vi.fn(),
  ApiError: class extends Error {
    constructor(
      public status: number,
      public body: unknown,
    ) {
      super(`API ${status}`);
    }
  },
}));

const SESSION = '0b5d6a7e-1111-4222-8333-444455556666';
const ID1 = '11111111-1111-5111-8111-111111111111';
const ID2 = '22222222-2222-5222-8222-222222222222';
const ID3 = '33333333-3333-5333-8333-333333333333';

const summary: DictionarySummaryResponse = {
  tasks: [
    {
      taskNumber: 9,
      title: 'Корни',
      description: 'Непроверяемые гласные и чередования.',
      categories: [
        { id: 'unchecked', title: 'Непроверяемые', words: 40, questions: 120 },
        { id: 'tsy', title: 'Ы / И после Ц', words: 8, questions: 24 },
      ],
      words: 48,
      questions: 144,
      learned: 3,
      bestScore: 70,
    },
    {
      taskNumber: 15,
      title: 'Н и НН',
      description: 'Исключения Н / НН.',
      categories: [{ id: 'nn', title: 'НН-исключения', words: 10, questions: 30 }],
      words: 10,
      questions: 30,
      learned: 0,
      bestScore: null,
    },
  ],
};

function renderGame(user: ReturnType<typeof makeAuthUser> | null = makeAuthUser()) {
  return render(
    <NavigationProvider>
      <TestAuthProvider user={user}>
        <AccountGateProvider>
          <DictionaryGame />
        </AccountGateProvider>
      </TestAuthProvider>
    </NavigationProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  resetPrivateCaches();
  vi.mocked(api.getMiniGames).mockReset().mockResolvedValue({ games: [] });
  vi.mocked(api.getMiniGameSettings).mockReset().mockResolvedValue({ settings: {} });
  vi.mocked(api.saveMiniGameSettings).mockReset().mockResolvedValue({});
  vi.mocked(api.getMiniGameRating)
    .mockReset()
    .mockResolvedValue({ gameId: 'dictionary', kind: 'best', players: 0, entries: [], me: null });
  vi.mocked(api.getDictionarySummary).mockReset().mockResolvedValue(summary);
  vi.mocked(api.getDictionaryActive).mockReset().mockResolvedValue({ session: null });
  vi.mocked(api.abandonDictionaryRound).mockReset().mockResolvedValue();
  vi.mocked(api.finishDictionaryRound)
    .mockReset()
    .mockResolvedValue({ questionCount: 3, answered: 3, firstTryCorrect: 2, score: 20 });
  vi.mocked(api.getDictionaryRound).mockReset();
  vi.mocked(api.answerDictionary).mockReset();
  vi.mocked(api.getDictionaryReference).mockReset();
});

describe('«Словарные слова и исключения»', () => {
  it('the task is chosen inside the game; a group narrows the round', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getDictionaryRound).mockResolvedValue({
      task: 15,
      category: 'nn',
      mode: 'all',
      bankSize: 30,
      sessionId: SESSION,
      questions: [
        {
          itemId: ID1,
          mechanic: 'gap',
          prompt: 'Какая буква пропущена?',
          text: 'стекля▢ый',
          options: ['н', 'нн'],
        },
        {
          itemId: ID2,
          mechanic: 'gap',
          prompt: 'Какая буква пропущена?',
          text: 'деревя▢ый',
          options: ['н', 'нн'],
        },
        {
          itemId: ID3,
          mechanic: 'gap',
          prompt: 'Какая буква пропущена?',
          text: 'оловя▢ый',
          options: ['н', 'нн'],
        },
      ],
    });
    renderGame();
    const tasks = await screen.findByRole('radiogroup', { name: 'Номер задания' });
    expect(within(tasks).getAllByRole('radio')).toHaveLength(2);
    expect(within(tasks).getAllByRole('radio')[0]).toHaveTextContent('3 из 48 слов · рекорд 70');
    await user.click(within(tasks).getByRole('radio', { name: /№15/ }));
    await user.click(screen.getByRole('radio', { name: /НН-исключения/ }));
    await user.click(screen.getByRole('button', { name: /Начать/ }));
    expect(api.getDictionaryRound).toHaveBeenCalledWith(
      expect.objectContaining({ task: 15, category: 'nn', mode: 'all' }),
    );
    expect(await screen.findByText('стекля▢ый')).toBeInTheDocument();
  });

  it('after an answer: the right spelling, the explanation and the memory aid', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getDictionaryRound).mockResolvedValue({
      task: 9,
      category: null,
      mode: 'all',
      bankSize: 144,
      sessionId: SESSION,
      questions: [
        {
          itemId: ID1,
          mechanic: 'find-error',
          prompt: 'В каком слове ошибка?',
          text: '',
          options: ['календарь', 'сабака', 'корова'],
        },
        {
          itemId: ID2,
          mechanic: 'gap',
          prompt: 'Какая буква пропущена?',
          text: 'к▢рова',
          options: ['а', 'о'],
        },
        {
          itemId: ID3,
          mechanic: 'gap',
          prompt: 'Какая буква пропущена?',
          text: 'в▢гон',
          options: ['а', 'о'],
        },
      ],
    });
    vi.mocked(api.answerDictionary).mockResolvedValue({
      correct: false,
      correctOption: 'сабака',
      word: 'собака',
      explanation: 'Словарное слово: безударная О не проверяется.',
      memo: 'со-БАКА: «со» как у «сосед».',
      recorded: true,
    });
    renderGame();
    await user.click(await screen.findByRole('button', { name: /Начать/ }));
    await user.click(await screen.findByRole('button', { name: 'календарь' }));
    expect(await screen.findByText('собака')).toBeInTheDocument();
    expect(screen.getByText(/ошибка в «сабака», правильно —/)).toBeInTheDocument();
    expect(screen.getByText(/безударная О не проверяется/)).toBeInTheDocument();
    expect(screen.getByText('Как запомнить')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'сабака' }).className).toMatch(/optionRight/);
    expect(api.answerDictionary).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: ID1, answer: 'календарь', sessionId: SESSION }),
    );
  });

  it('asking for more than the task has shows the real limit', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getDictionaryRound).mockRejectedValue(
      new (api.ApiError as unknown as new (s: number, b: unknown) => Error)(409, { available: 24 }),
    );
    renderGame();
    await user.click(await screen.findByRole('button', { name: /Начать/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Здесь сейчас 24 вопросов');
  });

  it('the reference: words by group, a search in every task', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getDictionaryReference).mockImplementation(async (task) => ({
      taskNumber: task,
      title: task === 9 ? 'Корни' : 'Н и НН',
      categories: [
        {
          id: 'g',
          title: task === 9 ? 'Непроверяемые' : 'НН-исключения',
          rule: 'Правило группы слов для справки.',
          words:
            task === 9
              ? [
                  {
                    word: 'календарь',
                    exception: false,
                    explanation: 'Словарное слово.',
                    memo: null,
                  },
                ]
              : [
                  {
                    word: 'стеклянный',
                    exception: true,
                    explanation: 'Исключение: -ЯН- с НН.',
                    memo: null,
                  },
                ],
        },
      ],
    }));
    renderGame();
    await user.click(await screen.findByRole('button', { name: /Справочник слов/ }));
    expect(await screen.findByText('календарь')).toBeInTheDocument();
    expect(api.getDictionaryReference).toHaveBeenCalledTimes(1);
    await user.type(screen.getByRole('searchbox', { name: 'Поиск по словам' }), 'стекл');
    expect(await screen.findByText('стеклянный')).toBeInTheDocument();
    expect(screen.queryByText('календарь')).not.toBeInTheDocument();
    expect(screen.getByText('исключение')).toBeInTheDocument();
    expect(screen.getByText('Найдено: 1')).toBeInTheDocument();
  });

  it('a guest plays; «Мои ошибки» needs an account', async () => {
    renderGame(null);
    expect(await screen.findByText(/Играть можно без входа/)).toBeInTheDocument();
  });
});
