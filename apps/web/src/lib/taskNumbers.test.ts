import { describe, expect, it } from 'vitest';
import type { CollectionListItem } from '@zybrilka/shared';
import { availableTaskNumbers } from './taskNumbers.js';

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

function collection(taskNumbers?: number[]): CollectionListItem {
  return {
    collection: {
      id: '00000000-0000-4000-8000-000000000027',
      subjectId: 'math',
      slug: 'ege-2027-yashchenko',
      title: 'ЕГЭ 2027 Ященко',
      publisher: null,
      year: 2027,
      description: null,
    },
    variants: [],
    ...(taskNumbers ? { taskNumbers } : {}),
  };
}

describe('availableTaskNumbers', () => {
  it('a chosen Сборник: exactly its numbers from the API (ЕГЭ 2027: 1–20)', () => {
    expect(
      availableTaskNumbers({
        subjectId: 'math',
        collection: collection(range(20)),
        poolNumbers: range(19),
      }),
    ).toEqual(range(20));
  });

  it('a chosen Сборник with no available tasks offers no numbers', () => {
    expect(availableTaskNumbers({ subjectId: 'math', collection: collection([]) })).toEqual([]);
  });

  it('«Все источники»: the pool numbers from /tasks/counts', () => {
    expect(availableTaskNumbers({ subjectId: 'math', poolNumbers: [1, 2, 3] })).toEqual([1, 2, 3]);
  });

  it('not loaded yet / older API: the subject’s static count', () => {
    expect(availableTaskNumbers({ subjectId: 'math' })).toEqual(range(19));
    expect(availableTaskNumbers({ subjectId: 'russian', poolNumbers: [] })).toEqual(range(27));
    expect(availableTaskNumbers({ subjectId: 'math', collection: collection() })).toEqual(
      range(19),
    );
  });
});
