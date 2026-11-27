import { gapCount, nnItems } from '@zybrilka/shared';
import { describe, expect, it } from 'vitest';
import { BANK_NUMBERS } from './zybrilkaRussian/bank.js';

const byNumber = (n: number) => BANK_NUMBERS.find((b) => b.taskNumber === n)!.tasks;

describe('Зубрилка №15 in the «Н и НН» mini-game', () => {
  it('every place of every task becomes a question with exactly one gap, in its own word', () => {
    let questions = 0;
    for (const t of byNumber(15)) {
      const digits = t.answer.type === 'digits' ? t.answer.digits : '';
      const items = nnItems({
        id: `zr15-${t.n}`,
        taskNumber: 15,
        conditionMd: t.conditionMd,
        correctAnswer: digits,
        acceptedAnswers: null,
        explanationMd: t.explanationMd,
        passageMd: null,
        imageUrl: null,
      });
      const places = (t.conditionMd.match(/\(\d\)/g) ?? []).length;
      expect(items, `№15.${t.n}`).toHaveLength(places);
      for (const it of items) {
        expect(gapCount(it.text), `№15.${t.n}`).toEqual({ quizGaps: 1, otherGaps: 0 });
        expect(it.text).not.toMatch(/\(\d\)/);
      }
      questions += items.length;
    }
    expect(questions).toBeGreaterThanOrEqual(400);
  });
});
