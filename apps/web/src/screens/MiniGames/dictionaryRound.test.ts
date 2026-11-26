import type { DictionaryQuestion } from '@zybrilka/shared';
import { describe, expect, it } from 'vitest';
import {
  dictCurrent,
  dictNext,
  dictRecord,
  dictScore,
  matchesSearch,
  resumeDictRound,
  startDictRound,
} from './dictionaryRound.js';

const q = (id: string): DictionaryQuestion => ({
  itemId: id,
  mechanic: 'gap',
  prompt: 'Какая буква пропущена?',
  text: 'к▢лендарь',
  options: ['а', 'о'],
});

describe('dictionary round', () => {
  it('a miss comes back once, the first answer is the score', () => {
    let s = startDictRound(['a', 'b', 'c', 'd', 'e'].map(q));
    s = dictRecord(s, false);
    expect(s.queue.map((x) => x.itemId)).toEqual(['a', 'b', 'c', 'd', 'a', 'e']);
    for (let i = 0; i < 6; i++) {
      s = dictRecord(s, true);
      s = dictNext(s);
    }
    expect(dictCurrent(s)).toBeNull();
    expect(dictScore(s)).toEqual({ correct: 4, total: 5, missed: ['a'] });
  });

  it('a saved round continues after its answered questions', () => {
    const s = resumeDictRound(['a', 'b', 'c'].map(q), [{ itemId: 'b', firstCorrect: true }]);
    expect(dictCurrent(s)!.itemId).toBe('a');
    expect(s.position).toBe(1);
    expect(dictScore(s).correct).toBe(1);
  });

  it('search ignores case, «ё» and hyphens', () => {
    expect(matchesSearch('крест накрест', 'крест-накрест')).toBe(true);
    expect(matchesSearch('ЕЛКА', 'ёлка')).toBe(true);
    expect(matchesSearch('', 'что угодно')).toBe(true);
    expect(matchesSearch('xyz', 'календарь', 'проверочного слова нет')).toBe(false);
  });
});
