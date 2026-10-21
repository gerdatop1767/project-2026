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
