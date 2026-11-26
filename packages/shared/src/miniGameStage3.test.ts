import { describe, expect, it } from 'vitest';
import { MINI_GAMES, orderRoundItems, roundSizeLimits } from './miniGames.js';
import { MINI_GAME_RULES } from './miniGameRules.js';
import { expressionDrillItems, mathExpressionDrills } from './mathDrills.js';
import {
  checkQuizAnswer,
  dedupeItems,
  formErrorItems,
  paronymItems,
  type QuizItem,
} from './quizGames.js';

describe('«Правила игры»', () => {
  it('every game has its own rules: goal, how to answer, scoring, end', () => {
    for (const g of MINI_GAMES) {
      const r = MINI_GAME_RULES[g.id];
      expect(r, g.id).toBeDefined();
      expect(r!.goal.length, g.id).toBeGreaterThan(20);
      expect(r!.how.length, g.id).toBeGreaterThan(0);
      expect(r!.scoring.length, g.id).toBeGreaterThan(20);
      expect(r!.end.length, g.id).toBeGreaterThan(20);
    }
    // No two games share the same goal or the same «how to answer».
    const goals = MINI_GAMES.map((g) => MINI_GAME_RULES[g.id]!.goal);
    const hows = MINI_GAMES.map((g) => MINI_GAME_RULES[g.id]!.how.join(' '));
    expect(new Set(goals).size).toBe(goals.length);
    expect(new Set(hows).size).toBe(hows.length);
  });
});

describe('«Вычисления»: computed questions', () => {
  const drills = mathExpressionDrills();

  it('every stored answer equals the expression evaluated independently', () => {
    expect(drills.length).toBeGreaterThan(100);
    for (const d of drills) {
      const value = new Function(`return ${d.check};`)() as number;
      expect(Math.abs(value - d.value), d.key).toBeLessThan(1e-9);
    }
  });

  it('keys are unique, answers are exact decimals and accepted with a comma', () => {
    expect(new Set(drills.map((d) => d.key)).size).toBe(drills.length);
    for (const item of expressionDrillItems()) {
      expect(item.text).toMatch(/^Найдите значение выражения \$.+\$\.$/);
      expect(item.explanationSource).toBe('auto');
      expect(checkQuizAnswer(item, item.display)).toBe(true);
      expect(checkQuizAnswer(item, item.display.replace(',', '.'))).toBe(true);
      expect(checkQuizAnswer(item, String(Number(item.correct) + 1))).toBe(false);
    }
  });
});

const PARONYM_ROW = {
  id: 't5',
  taskNumber: 5,
  conditionMd: [
    'В одном из приведённых ниже предложений неверно употреблено выделенное слово. Исправьте ошибку.',
    'Он был ДИПЛОМАНТОМ конкурса.',
    'Это был ГУМАНИСТИЧЕСКИЙ поступок.',
    'Учитель дал ЭФФЕКТИВНЫЙ совет.',
    'Мы купили ПАМЯТНЫЙ подарок.',
    'Работа была ДЛИТЕЛЬНОЙ.',
  ].join('\n'),
  correctAnswer: 'гуманный',
  acceptedAnswers: null,
  explanationMd: null,
  passageMd: null,
  imageUrl: null,
};

describe('more questions from the same tasks', () => {
  it('№5: one «Да/Нет» question per sentence, answered by the task’s own key', () => {
    const items = paronymItems(PARONYM_ROW);
    const single = items.filter((i) => i.key.includes(':w:'));
    expect(single).toHaveLength(5);
    const wrong = single.filter((i) => i.correct === 'Нет');
    expect(wrong.map((i) => i.text)).toEqual(['Это был ГУМАНИСТИЧЕСКИЙ поступок.']);
    expect(single.filter((i) => i.correct === 'Да')).toHaveLength(4);
    for (const i of single.filter((x) => x.correct === 'Да')) {
      expect(i.explanationSource).toBe('auto');
      expect(i.explanation).toContain('ГУМАНИСТИЧЕСКИЙ');
    }
  });

  it('№7: one question per form', () => {
    const items = formErrorItems({
      ...PARONYM_ROW,
      id: 't7',
      taskNumber: 7,
      conditionMd: [
        'В одном из выделенных ниже слов допущена ошибка в образовании формы слова.',
        'пара САПОГ',
        'ПОЛОЖЬ на место',
        'ДВУМЯСТАМИ рублями',
        'ПОЕЗЖАЙ скорее',
        'много ДЕЛ',
      ].join('\n'),
      correctAnswer: 'положи',
    });
    const single = items.filter((i) => i.key.includes(':w:'));
    expect(single).toHaveLength(5);
    expect(single.find((i) => i.correct === 'Нет')!.text).toBe('ПОЛОЖЬ на место');
  });

  it('«Да/Нет» copies that disagree are dropped, never «both right»', () => {
    const base: QuizItem = {
      key: 'a',
      taskId: 'a',
      kind: 'choice',
      text: 'Одно и то же предложение.',
      prompt: 'Верно?',
      options: ['Да', 'Нет'],
      correct: 'Да',
      display: 'Да',
    };
    expect(dedupeItems([base, { ...base, key: 'b', correct: 'Нет' }])).toHaveLength(0);
    expect(dedupeItems([base, { ...base, key: 'b' }])).toHaveLength(1);
  });
});

describe('rounds without repeats', () => {
  const items = Array.from({ length: 6 }, (_, i) => ({ id: `q${i}` }));
  const t = (min: number) => new Date(Date.UTC(2026, 10, 19, 10, min));

  it('never-seen first, then the longest-unseen, learned last', () => {
    const state = new Map([
      ['q0', { streak: 1, lastAnsweredAt: t(30) }],
      ['q1', { streak: 1, lastAnsweredAt: t(10) }],
      ['q2', { streak: 3, lastAnsweredAt: t(1) }],
    ]);
    const order = orderRoundItems(items, state).map((x) => x.id);
    expect(new Set(order.slice(0, 3))).toEqual(new Set(['q3', 'q4', 'q5']));
    expect(order.slice(3)).toEqual(['q1', 'q0', 'q2']);
  });

  it('a question answered a moment ago is not in the next round while others remain', () => {
    const state = new Map(
      items.slice(0, 3).map((x, i) => [x.id, { streak: 1, lastAnsweredAt: t(i) }]),
    );
    state.set('q5', { streak: 0, lastAnsweredAt: t(59) });
    const round = orderRoundItems(items, state)
      .slice(0, 5)
      .map((x) => x.id);
    expect(round).not.toContain('q5');
  });
});

describe('round size limits', () => {
  it('quiz 3–500, «Ударения» 5–500, with short and long presets inside the limits', () => {
    expect(roundSizeLimits('nn')).toMatchObject({ min: 3, max: 500 });
    expect(roundSizeLimits('stress')).toMatchObject({ min: 5, max: 500 });
    for (const id of ['nn', 'stress']) {
      const l = roundSizeLimits(id);
      for (const p of [...l.preset, ...l.long]) expect(p >= l.min && p <= l.max).toBe(true);
      expect(l.long).toEqual([100, 150, 200, 250, 300, 350, 400, 450, 500]);
    }
  });
});
