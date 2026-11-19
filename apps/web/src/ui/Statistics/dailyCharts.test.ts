import { describe, expect, it } from 'vitest';
import { accuracyLinePoints, solvedBarPoints } from './dailyCharts.js';

const day = (date: string, solved: number, accuracyPercent: number) => ({
  date,
  label: date.slice(8),
  solved,
  accuracyPercent,
});

describe('daily chart tooltips', () => {
  it('bars: the exact solved count with correct Russian plural, and an honest zero', () => {
    const [a, b, c] = solvedBarPoints([
      day('2026-10-19', 1, 100),
      day('2026-10-20', 3, 66.7),
      day('2026-10-21', 0, 0),
    ]);
    expect(a!.tooltip!.value).toBe('Решено 1 задание');
    expect(b!.tooltip!.value).toBe('Решено 3 задания');
    expect(b!.tooltip!.detail).toBe('67% правильных');
    expect(c!.tooltip!.value).toBe('Ничего не решено');
    expect(a!.tooltip!.title).toMatch(/19 октября/);
  });

  it('line: the exact percent and what it is based on; no fake 0% for an empty day', () => {
    const [a, b] = accuracyLinePoints([day('2026-10-20', 12, 75), day('2026-10-21', 0, 0)]);
    expect(a!.tooltip).toMatchObject({ value: '75% правильных ответов', detail: 'по 12 заданий' });
    expect(b!.tooltip!.value).toBe('Нет решённых заданий');
  });
});

describe('period buckets as chart points', () => {
  it('a week says which days it covers; accuracy is per answers, an empty bucket says so', async () => {
    const { bucketPoints } = await import('./dailyCharts.js');
    const [week, empty] = bucketPoints([
      {
        start: '2026-11-09',
        end: '2026-11-15',
        answers: 8,
        correct: 6,
        solvedTasks: 5,
        accuracyPercent: 75,
      },
      {
        start: '2026-11-16',
        end: '2026-11-16',
        answers: 0,
        correct: 0,
        solvedTasks: 0,
        accuracyPercent: null,
      },
    ]);
    const [bar] = solvedBarPoints([week!]);
    expect(bar!.tooltip!.title).toBe('9 ноября – 15 ноября');
    expect(bar!.tooltip!.value).toBe('Решено 5 заданий');
    const [line, none] = accuracyLinePoints([week!, empty!]);
    expect(line!.tooltip).toMatchObject({
      value: '75% правильных ответов',
      detail: 'по 8 ответам',
    });
    expect(none!.tooltip!.value).toBe('Нет ответов');
  });
});
