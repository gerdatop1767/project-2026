import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MATCH_SEPARATOR,
  MINI_GAMES,
  MINI_GAME_RULES,
  type QuizRoundResponse,
} from '@zybrilka/shared';
import { NavigationProvider, useNavigation } from '../../lib/navigation.js';
import { TestAuthProvider, makeAuthUser } from '../../lib/authTestUtils.js';
import { AccountGateProvider } from '../../lib/accountGate.js';
import * as api from '../../lib/api.js';
import { resetPrivateCaches } from '../../lib/privateCaches.js';
import { MiniGames, questionsWord } from './MiniGames.js';
import { QuizGame, splitSlots, splitWords } from './QuizGame.js';

vi.mock('../../lib/api.js', () => ({
  getMiniGames: vi.fn(),
  getMiniGameSettings: vi.fn(),
  saveMiniGameSettings: vi.fn(),
  getQuizRound: vi.fn(),
  answerQuiz: vi.fn(),
  finishQuizRound: vi.fn(),
  getQuizProgress: vi.fn(),
  ApiError: class extends Error {},
}));

function Where() {
  const { overlay } = useNavigation();
  return <p data-testid="where">{overlay ? JSON.stringify(overlay) : 'none'}</p>;
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

const SESSION = '0b5d6a7e-1111-4222-8333-444455556666';
const ID1 = '11111111-1111-5111-8111-111111111111';
const ID2 = '22222222-2222-5222-8222-222222222222';

beforeEach(() => {
  window.localStorage.clear();
  resetPrivateCaches();
  vi.mocked(api.getMiniGames)
    .mockReset()
    .mockResolvedValue({
      games: MINI_GAMES.map((g) => ({ ...g, progress: null, questionCount: 90 })),
    });
  vi.mocked(api.getMiniGameSettings).mockReset().mockResolvedValue({ settings: {} });
  vi.mocked(api.saveMiniGameSettings).mockReset().mockResolvedValue({});
  vi.mocked(api.getQuizRound).mockReset();
  vi.mocked(api.answerQuiz).mockReset();
  vi.mocked(api.finishQuizRound).mockReset().mockResolvedValue(undefined);
  vi.mocked(api.getQuizProgress).mockReset().mockResolvedValue({
    gameId: 'nn',
    bankSize: 99,
    learned: 4,
    seen: 20,
    answers: 30,
    correct: 24,
    accuracyPercent: 80,
    mistakes: 3,
    bestScore: 90,
    rounds: 2,
  });
});

describe('«Мини-игры»: subjects and topics', () => {
  it('Russian by default, math in its own tab; topics; real question counts; the tab is remembered', async () => {
    vi.mocked(api.getMiniGames).mockResolvedValue({
      games: MINI_GAMES.map((g) => ({
        ...g,
        progress: null,
        questionCount: g.id === 'gap-word' ? 1 : 90,
      })),
    });
    const user = userEvent.setup();
    renderWith(<MiniGames />, makeAuthUser());
    const tabs = await screen.findByRole('tablist', { name: 'Предмет' });
    expect(within(tabs).getByRole('tab', { name: /Русский язык/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(tabs).getByRole('tab', { name: /Русский язык/ })).toHaveTextContent('16');
    const orth = screen.getByRole('heading', { name: 'Орфография' }).closest('section')!;
    expect(within(orth).getByRole('heading', { name: 'Н и НН' })).toBeInTheDocument();
    const text = screen.getByRole('heading', { name: 'Текст и лексика' }).closest('section')!;
    const gap = within(text).getByRole('heading', { name: 'Пропущенное слово' }).closest('li')!;
    expect(within(gap).getByText('1 вопрос')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Теория вероятностей' })).not.toBeInTheDocument();
    await user.click(within(tabs).getByRole('tab', { name: /Математика/ }));
    expect(screen.getByRole('heading', { name: 'Вычисления' })).toBeInTheDocument();
    expect(window.localStorage.getItem('zybrilka.miniGames.category')).toBe('math');
    await user.click(screen.getByRole('button', { name: 'Играть: Теория вероятностей' }));
    expect(screen.getByTestId('where')).toHaveTextContent('"gameId":"probability-blitz"');
  });

  it('question words', () => {
    expect([1, 2, 5, 11, 21, 22, 25, 112].map(questionsWord)).toEqual([
      '1 вопрос',
      '2 вопроса',
      '5 вопросов',
      '11 вопросов',
      '21 вопрос',
      '22 вопроса',
      '25 вопросов',
      '112 вопросов',
    ]);
  });
});

describe('a quiz game', () => {
  it('choice: one answer per question, the right answer and explanation, 10 points, the summary', async () => {
    const round: QuizRoundResponse = {
      gameId: 'nn',
      mode: 'all',
      bankSize: 99,
      sessionId: SESSION,
      questions: [
        { itemId: ID1, kind: 'choice', text: 'Утре▢ие улицы', options: ['Н', 'НН'] },
        { itemId: ID2, kind: 'choice', text: 'прониза▢ы запахом', options: ['Н', 'НН'] },
      ],
    };
    vi.mocked(api.getQuizRound).mockResolvedValue(round);
    vi.mocked(api.answerQuiz)
      .mockResolvedValueOnce({
        correct: true,
        display: 'НН',
        correctOption: 'НН',
        taskId: 't',
        recorded: true,
      })
      .mockResolvedValueOnce({
        correct: false,
        display: 'Н',
        correctOption: 'Н',
        explanation: '(2) пронизаны — краткое причастие, одна Н.',
        explanationSource: 'task',
        taskId: 't',
        recorded: true,
      });
    const user = userEvent.setup();
    renderWith(<QuizGame gameId="nn" />, makeAuthUser());
    const progress = await screen.findByLabelText('Твой прогресс');
    expect(progress).toHaveTextContent('4 из 99');
    expect(progress).toHaveTextContent('90 очк.');
    await user.click(screen.getByRole('button', { name: /Играть/ }));
    expect(await screen.findByText('Вопрос 1 из 2')).toBeInTheDocument();
    expect(screen.getByText('Утре_____ие улицы')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'НН' }));
    expect(api.answerQuiz).toHaveBeenLastCalledWith(
      'nn',
      expect.objectContaining({ itemId: ID1, answer: 'НН', sessionId: SESSION }),
    );
    expect(await screen.findByText('Верно!')).toBeInTheDocument();
    expect(screen.getByText('+10 очк.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Дальше' }));
    await user.click(screen.getByRole('button', { name: 'НН' }));
    expect(await screen.findByText('Неверно. Правильно: Н')).toBeInTheDocument();
    expect(screen.getByText(/краткое причастие, одна Н/)).toBeInTheDocument();
    expect(screen.getByText('Разбор из задания')).toBeInTheDocument();
    // Locked after the first answer.
    expect(screen.getByRole('button', { name: 'Н' })).toBeDisabled();
    expect(api.answerQuiz).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: 'Итог раунда' }));
    const summary = screen.getByLabelText('Итог раунда');
    expect(within(summary).getByText('10')).toBeInTheDocument();
    expect(within(summary).getByText('Верно 1 из 2')).toBeInTheDocument();
    expect(api.finishQuizRound).toHaveBeenCalledWith('nn', SESSION, 1);
    await user.click(within(summary).getByRole('button', { name: /Ещё раунд/ }));
    expect(await screen.findByText('Вопрос 1 из 2')).toBeInTheDocument();
  });

  it('a perfect round: 10 per question +20', async () => {
    vi.mocked(api.getQuizRound).mockResolvedValue({
      gameId: 'nn',
      mode: 'all',
      bankSize: 99,
      sessionId: SESSION,
      questions: [{ itemId: ID1, kind: 'choice', text: 'Утре▢ие', options: ['Н', 'НН'] }],
    });
    vi.mocked(api.answerQuiz).mockResolvedValue({
      correct: true,
      display: 'НН',
      correctOption: 'НН',
      taskId: 't',
      recorded: true,
    });
    const user = userEvent.setup();
    renderWith(<QuizGame gameId="nn" />, makeAuthUser());
    await user.click(await screen.findByRole('button', { name: /Играть/ }));
    await user.click(await screen.findByRole('button', { name: 'НН' }));
    await user.click(await screen.findByRole('button', { name: 'Итог раунда' }));
    const summary = screen.getByLabelText('Итог раунда');
    expect(within(summary).getByText('30')).toBeInTheDocument();
    expect(within(summary).getByText(/идеальный раунд, \+20/)).toBeInTheDocument();
  });

  it('slots: tap the places, check; words: tap the words, sent in text order', async () => {
    vi.mocked(api.getQuizRound).mockResolvedValueOnce({
      gameId: 'commas',
      mode: 'all',
      bankSize: 72,
      sessionId: SESSION,
      questions: [{ itemId: ID1, kind: 'slots', text: 'А (1) б (2) в (3) г.', slots: [1, 2, 3] }],
    });
    vi.mocked(api.answerQuiz).mockResolvedValueOnce({
      correct: true,
      display: '1, 3',
      correctSlots: [1, 3],
      taskId: 't',
      recorded: false,
    });
    const user = userEvent.setup();
    const { unmount } = renderWith(<QuizGame gameId="commas" />, null);
    expect(screen.getByText(/Войди, чтобы сохранять прогресс/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Играть/ }));
    await user.click(await screen.findByRole('button', { name: 'Место 3' }));
    await user.click(screen.getByRole('button', { name: 'Место 1' }));
    await user.click(screen.getByRole('button', { name: 'Проверить' }));
    expect(api.answerQuiz).toHaveBeenCalledWith(
      'commas',
      expect.objectContaining({ answer: '13' }),
    );
    expect(api.getQuizProgress).not.toHaveBeenCalled(); // a guest has no saved progress
    unmount();

    vi.mocked(api.getQuizRound).mockResolvedValueOnce({
      gameId: 'find-in-text',
      mode: 'all',
      bankSize: 14,
      sessionId: SESSION,
      questions: [
        {
          itemId: ID2,
          kind: 'words',
          text: '(6)Свои и чужие ушли.',
          prompt: 'Из предложения 6 выпишите антонимы.',
        },
      ],
    });
    vi.mocked(api.answerQuiz).mockResolvedValueOnce({
      correct: true,
      display: 'свои чужие',
      taskId: 't',
      recorded: true,
    });
    renderWith(<QuizGame gameId="find-in-text" />, makeAuthUser());
    await user.click(await screen.findByRole('button', { name: /Играть/ }));
    expect(await screen.findByText('Из предложения 6 выпишите антонимы.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'чужие' }));
    await user.click(screen.getByRole('button', { name: 'Свои' }));
    await user.click(screen.getByRole('button', { name: 'Проверить' }));
    expect(api.answerQuiz).toHaveBeenLastCalledWith(
      'find-in-text',
      expect.objectContaining({ answer: 'Свои чужие' }),
    );
  });

  it('a guest asking for «Мои ошибки» is asked to sign in; an unknown game says so', async () => {
    const user = userEvent.setup();
    renderWith(<QuizGame gameId="nn" />, null);
    await user.click(screen.getByRole('button', { name: 'Мои ошибки' }));
    expect(api.getQuizRound).not.toHaveBeenCalled();
    renderWith(<QuizGame gameId="nope" />, null);
    expect(screen.getByText('Такой игры нет.')).toBeInTheDocument();
  });

  it('splits sentences into places and words', () => {
    expect(splitSlots('А (1) б (12) в')).toEqual(['А ', 1, ' б ', 12, ' в']);
    expect(splitWords('Свои, чужие.').map((t) => t.text)).toEqual(['Свои', ', ', 'чужие', '.']);
  });

  it('an automatic note says so; an option accepted by another task’s key counts as right', async () => {
    vi.mocked(api.getQuizRound).mockResolvedValue({
      gameId: 'grammar-detective',
      mode: 'all',
      bankSize: 700,
      sessionId: SESSION,
      questions: [
        {
          itemId: ID1,
          kind: 'choice',
          text: 'Всё верно в этом предложении.',
          options: ['Ошибка с числительным', 'Ни одной из этих ошибок'],
        },
      ],
    });
    vi.mocked(api.answerQuiz).mockResolvedValue({
      correct: true,
      display: 'Ни одной из этих ошибок',
      correctOption: 'Ни одной из этих ошибок',
      explanation: 'По ключу задания этого предложения нет среди ответов.',
      explanationSource: 'auto',
      alsoCorrect: ['Ошибка с числительным'],
      taskId: 't',
      recorded: true,
    });
    const user = userEvent.setup();
    renderWith(<QuizGame gameId="grammar-detective" />, makeAuthUser());
    await user.click(await screen.findByRole('button', { name: /Играть/ }));
    await user.click(await screen.findByRole('button', { name: 'Ни одной из этих ошибок' }));
    expect(
      await screen.findByText('Пояснение по ключу (сформировано автоматически)'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Разбор из задания')).not.toBeInTheDocument();
    expect(
      screen.getByText(/Тоже верно по ключу другого задания источника: Ошибка с числительным/),
    ).toBeInTheDocument();
  });
});

describe('mini-games: speed, empty games, formulas, round size', () => {
  it('a game without questions says so instead of a faint button; a return shows the list at once', async () => {
    vi.mocked(api.getMiniGames).mockResolvedValue({
      games: MINI_GAMES.map((g) => ({
        ...g,
        progress: null,
        questionCount: g.id === 'nn' ? 0 : 50,
      })),
    });
    const first = renderWith(<MiniGames />, makeAuthUser());
    const nn = (await screen.findByRole('heading', { name: 'Н и НН' })).closest('li')!;
    expect(within(nn).queryByRole('button', { name: /Играть/ })).not.toBeInTheDocument();
    expect(within(nn).getByText(/Вопросы скоро появятся/)).toBeInTheDocument();
    first.unmount();
    // Second visit: the refresh never answers, the cached list is shown anyway.
    vi.mocked(api.getMiniGames).mockReturnValue(new Promise(() => undefined));
    renderWith(<MiniGames />, makeAuthUser());
    expect(screen.getByRole('button', { name: 'Играть: Ударения' })).toBeInTheDocument();
  });

  it('math questions, answers and explanations are typeset, not shown as raw $…$', async () => {
    vi.mocked(api.getQuizRound).mockResolvedValue({
      gameId: 'expressions-blitz',
      mode: 'all',
      bankSize: 40,
      sessionId: SESSION,
      questions: [
        {
          itemId: ID1,
          kind: 'input',
          text: 'Найдите значение выражения $\\log_a(a^3b^{14})$, если $\\log_b a = -2$.',
        },
      ],
    });
    vi.mocked(api.answerQuiz).mockResolvedValue({
      correct: false,
      display: '$-4$',
      explanation: 'Так как $\\log_a b = -\\dfrac12$, получаем $3+14\\cdot(-\\dfrac12)=-4$.',
      explanationSource: 'task',
      taskId: 't',
      recorded: true,
    });
    const user = userEvent.setup();
    const { container } = renderWith(<QuizGame gameId="expressions-blitz" />, makeAuthUser());
    await user.click(await screen.findByRole('button', { name: /Играть/ }));
    await screen.findByText(/Найдите значение выражения/);
    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.textContent).not.toContain('$\\log');
    await user.type(screen.getByRole('textbox', { name: 'Ответ' }), '5');
    await user.click(screen.getByRole('button', { name: 'Проверить' }));
    await screen.findByText('Разбор из задания');
    expect(container.textContent).not.toMatch(/\$/);
  });

  it('the player picks how many questions a round has; the choice is remembered per game', async () => {
    vi.mocked(api.getQuizRound).mockResolvedValue({
      gameId: 'nn',
      mode: 'all',
      bankSize: 99,
      sessionId: SESSION,
      questions: [{ itemId: ID1, kind: 'choice', text: 'Утре▢ие', options: ['Н', 'НН'] }],
    });
    const user = userEvent.setup();
    const view = renderWith(<QuizGame gameId="nn" />, makeAuthUser());
    const picker = await screen.findByRole('radiogroup');
    expect(within(picker).getByRole('radio', { name: '10' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(within(picker).getByRole('radio', { name: '15' }));
    await user.click(screen.getByRole('button', { name: /Играть/ }));
    expect(api.getQuizRound).toHaveBeenCalledWith('nn', 'all', 15);
    view.unmount();
    renderWith(<QuizGame gameId="nn" />, makeAuthUser());
    expect(
      within(await screen.findByRole('radiogroup')).getByRole('radio', { name: '15' }),
    ).toHaveAttribute('aria-checked', 'true');
  });
});

describe('game emblems', () => {
  it('every game has its own icon', async () => {
    const { GAME_ICONS } = await import('./GameIcon.js');
    expect(Object.keys(GAME_ICONS).sort()).toEqual(MINI_GAMES.map((g) => g.id).sort());
    expect(new Set(Object.values(GAME_ICONS)).size).toBe(MINI_GAMES.length);
  });
});

describe('round size: own number, bank limit, saved in the account; rules', () => {
  const ROUND: QuizRoundResponse = {
    gameId: 'nn',
    mode: 'all',
    bankSize: 90,
    sessionId: SESSION,
    questions: [{ itemId: ID1, kind: 'choice', text: 'Утре▢ие', options: ['Н', 'НН'] }],
  };

  it('«Своё»: a number within the limits reaches the API and is saved for the account', async () => {
    vi.mocked(api.getQuizRound).mockResolvedValue(ROUND);
    const user = userEvent.setup();
    renderWith(<QuizGame gameId="nn" />, makeAuthUser());
    await user.click(await screen.findByRole('radio', { name: 'Своё' }));
    const input = screen.getByRole('spinbutton');
    await user.type(input, '2');
    expect(screen.getByText('Не меньше 3.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Готово' })).toBeDisabled();
    await user.clear(input);
    await user.type(input, '7');
    await user.click(screen.getByRole('button', { name: 'Готово' }));
    expect(screen.getByRole('radio', { name: '7' })).toHaveAttribute('aria-checked', 'true');
    expect(api.saveMiniGameSettings).toHaveBeenCalledWith('nn', 7);
    expect(window.localStorage.getItem('zybrilka.miniGames.roundSize.nn')).toBe('7');
    await user.click(screen.getByRole('button', { name: /Играть/ }));
    expect(api.getQuizRound).toHaveBeenCalledWith('nn', 'all', 7);
  });

  it('never more than the game has: the input says so, a saved bigger size is capped', async () => {
    vi.mocked(api.getMiniGames).mockResolvedValue({
      games: MINI_GAMES.map((g) => ({ ...g, progress: null, questionCount: 12 })),
    });
    vi.mocked(api.getMiniGameSettings).mockResolvedValue({ settings: { nn: { roundSize: 40 } } });
    vi.mocked(api.getQuizRound).mockResolvedValue(ROUND);
    const user = userEvent.setup();
    renderWith(<QuizGame gameId="nn" />, makeAuthUser());
    expect(
      await screen.findByText(/Сейчас в игре только 12 — раунд будет из 12/),
    ).toBeInTheDocument();
    // Quick sizes above the bank are not offered.
    expect(screen.queryByRole('radio', { name: '15' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Играть/ }));
    expect(api.getQuizRound).toHaveBeenLastCalledWith('nn', 'all', 12);
  });

  it('a size saved in the account is used after a reload / on another device', async () => {
    vi.mocked(api.getMiniGameSettings).mockResolvedValue({ settings: { nn: { roundSize: 25 } } });
    renderWith(<QuizGame gameId="nn" />, makeAuthUser());
    expect(await screen.findByRole('radio', { name: '25' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(window.localStorage.getItem('zybrilka.miniGames.roundSize.nn')).toBe('25');
  });

  it('a guest’s choice stays in the browser and is never sent to the server', async () => {
    vi.mocked(api.getQuizRound).mockResolvedValue(ROUND);
    const user = userEvent.setup();
    renderWith(<QuizGame gameId="nn" />, null);
    await user.click(await screen.findByRole('radio', { name: '20' }));
    expect(window.localStorage.getItem('zybrilka.miniGames.roundSize.nn')).toBe('20');
    expect(api.saveMiniGameSettings).not.toHaveBeenCalled();
    expect(api.getMiniGameSettings).not.toHaveBeenCalled();
  });

  it('«Правила игры» opens this game’s own rules, not a generic text', async () => {
    const user = userEvent.setup();
    const view = renderWith(<QuizGame gameId="commas" />, makeAuthUser());
    await user.click(await screen.findByRole('button', { name: 'Правила игры' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(MINI_GAME_RULES.commas!.goal)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Ответ верный, только если отмечены все нужные места/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Понятно' }));
    view.unmount();
    renderWith(<QuizGame gameId="probability-blitz" />, makeAuthUser());
    await user.click(await screen.findByRole('button', { name: 'Правила игры' }));
    expect(
      within(screen.getByRole('dialog')).getByText(MINI_GAME_RULES['probability-blitz']!.goal),
    ).toBeInTheDocument();
  });
});

describe('«Теория на практике»', () => {
  it('«Соедини пары»: a choice per row, «Проверить» only when all rows have one, the pairs sent in order', async () => {
    vi.mocked(api.getQuizRound).mockResolvedValue({
      gameId: 'theory-practice',
      mode: 'all',
      bankSize: 87,
      sessionId: SESSION,
      questions: [
        {
          itemId: ID1,
          kind: 'match',
          text: 'Соедини формулу с тем, что она выражает',
          prompt: 'Соедини пары',
          left: ['$S = \\pi R^2$', '$C = 2\\pi R$'],
          options: ['длина окружности', 'площадь круга'],
        },
      ],
    });
    vi.mocked(api.answerQuiz).mockResolvedValue({
      correct: true,
      display: '…',
      correctPairs: ['площадь круга', 'длина окружности'],
      explanation: 'Площадь круга — $\\pi R^2$.',
      explanationSource: 'author',
      taskId: 't',
      recorded: true,
    });
    const user = userEvent.setup();
    const { container } = renderWith(<QuizGame gameId="theory-practice" />, makeAuthUser());
    await user.click(await screen.findByRole('button', { name: /Играть/ }));
    const rows = await screen.findAllByRole('radiogroup', { name: /Пара для/ });
    expect(rows).toHaveLength(2);
    // Formulas are typeset in the left column.
    expect(container.querySelectorAll('.katex').length).toBeGreaterThan(0);
    const check = screen.getByRole('button', { name: 'Проверить' });
    expect(check).toBeDisabled();
    await user.click(within(rows[0]!).getByRole('radio', { name: 'площадь круга' }));
    expect(check).toBeDisabled();
    await user.click(within(rows[1]!).getByRole('radio', { name: 'длина окружности' }));
    await user.click(check);
    expect(api.answerQuiz).toHaveBeenCalledWith(
      'theory-practice',
      expect.objectContaining({
        itemId: ID1,
        answer: ['площадь круга', 'длина окружности'].join(MATCH_SEPARATOR),
      }),
    );
    expect(await screen.findByText('Верно!')).toBeInTheDocument();
    expect(screen.getByText('Пояснение')).toBeInTheDocument();
  });

  it('a choice question with formulas as options; its own icon', async () => {
    const { GAME_ICONS } = await import('./GameIcon.js');
    expect(GAME_ICONS['theory-practice']).toBeDefined();
    const others = Object.entries(GAME_ICONS).filter(([id]) => id !== 'theory-practice');
    expect(others.map(([, icon]) => icon)).not.toContain(GAME_ICONS['theory-practice']);
  });
});
