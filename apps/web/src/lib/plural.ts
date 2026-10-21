/** Russian plural form: pluralRu(5, ['задание', 'задания', 'заданий']) → 'заданий'. */
export function pluralRu(count: number, [one, few, many]: readonly [string, string, string]) {
  const mod10 = Math.abs(count) % 10;
  const mod100 = Math.abs(count) % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
