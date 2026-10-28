import { describe, expect, it } from 'vitest';
import type { StressQuestion } from '@zybrilka/shared';
import {
  REQUEUE_GAP,
  currentQuestion,
  isFinished,
  next,
  recordAnswer,
  roundScore,
  startRound,
} from './stressRound.js';

const q = (id: string): StressQuestion => ({
  wordId: id,
  display: 'торты',
  vowels: [1, 4],
  partOfSpeech: 'сущ.',
  formNote: null,
});

describe('«Ударения» round logic', () => {
  it('a missed word comes back once, a few questions later; the score counts first tries', () => {
    let s = startRound(['a', 'b', 'c', 'd', 'e', 'f'].map(q));
    s = recordAnswer(s, false); // a wrong
    expect(s.queue.map((x) => x.wordId)).toEqual(['a', 'b', 'c', 'd', 'a', 'e', 'f']);
    expect(s.queue.indexOf(s.queue[0]!, 1)).toBe(1 + REQUEUE_GAP);
    s = recordAnswer(s, true); // «Повторить слово» right away — still a first-try miss
    s = next(s);
    for (const ok of [true, true, true]) s = next(recordAnswer(s, ok));
    expect(currentQuestion(s)!.wordId).toBe('a');
    s = recordAnswer(s, false); // wrong again: not sent back a second time
    expect(s.queue.filter((x) => x.wordId === 'a')).toHaveLength(2);
    s = next(s);
    s = next(recordAnswer(s, true));
    s = next(recordAnswer(s, true));
    expect(isFinished(s)).toBe(true);
    expect(roundScore(s)).toEqual({ correct: 5, total: 6, missed: ['a'] });
  });

  it('a miss near the end returns at the very end', () => {
    let s = startRound(['a', 'b'].map(q));
    s = next(recordAnswer(s, true));
    s = recordAnswer(s, false);
    expect(s.queue.map((x) => x.wordId)).toEqual(['a', 'b', 'b']);
  });
});
