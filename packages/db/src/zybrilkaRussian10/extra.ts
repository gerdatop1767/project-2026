import { orthogramOf, parseWord, type Word } from './rules.js';
import { AUTHORED_TASKS_10, type AuthoredTask10 } from './tasks.js';

/**
 * Tasks 51–100 of the №10 bank, generated from the words of tasks 1–50:
 * every one of them already carries its rule and passes `checkWord`, so a
 * new row is only a new combination of checked words. Tasks 1–50 are not
 * touched. Deterministic (fixed seed); rows never repeat tasks 1–50.
 */
const TIPS: Record<string, string> = {
  'приставки на З/С':
    'В приставках на З/С букву выбирают по следующему звуку: перед звонким согласным и гласной — З (бездомный, изгнать), перед глухим — С (бесполезный, испортить).',
  'неизменяемые приставки':
    'Приставки от-, об-, под-, над-, пред-, с- не изменяются: их пишут одинаково перед любым согласным, даже если слышится другой звук (сделать, отбросить, подписать).',
  'ПРЕ-/ПРИ-':
    'ПРИ- — приближение, присоединение, неполнота действия, близость; ПРЕ- — «очень» или «пере-». Если значение приставки не выделяется (президент, привилегия, преамбула), слово запоминают по словарю.',
  'Ы/И после приставок':
    'После русских приставок на согласный И меняется на Ы (разыграть, подытожить); после иноязычных приставок и приставок меж-, сверх- И сохраняется (дезинформация, сверхинтересный). Исключение — «взимать».',
  'разделительные Ъ и Ь':
    'Ъ пишется после приставки на согласный перед е, ё, ю, я (подъезд, объявление) и после иноязычных приставок (адъютант, инъекция); Ь — внутри корня (вьюга, пьеса, барьер).',
  'РАЗ-/РОЗ- (РАС-/РОС-)':
    'В приставке РАЗ-/РОЗ- (РАС-/РОС-) под ударением пишется О (рóзыск, рóспись), без ударения — А (разыскать, расписать).',
  'ПРА-':
    'Приставка ПРА- означает родство через поколение или древность: прадед, праязык, праотец.',
};

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(xs: readonly T[], rand: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const letterOf = (w: Word) => parseWord(w.raw).letter.toUpperCase();
const shownOf = (w: Word) => parseWord(w.raw).shown;
const rowKey = (r: readonly Word[]) => r.map(shownOf).sort().join('|');
const same = (r: readonly Word[]) => new Set(r.map(letterOf)).size === 1;

export function generateTasks10(
  base: readonly AuthoredTask10[] = AUTHORED_TASKS_10,
  count = 50,
  seed = 10102027,
  maxUses = 6,
): AuthoredTask10[] {
  const rand = rng(seed);
  const byShown = new Map<string, Word>();
  const uses = new Map<string, number>();
  const seenRows = new Set<string>();
  for (const t of base)
    for (const r of t.rows) {
      seenRows.add(rowKey(r));
      for (const w of r) {
        byShown.set(shownOf(w), w);
        uses.set(shownOf(w), (uses.get(shownOf(w)) ?? 0) + 1);
      }
    }
  const words = [...byShown.values()];
  const byLetter = new Map<string, Word[]>();
  for (const w of words) byLetter.set(letterOf(w), [...(byLetter.get(letterOf(w)) ?? []), w]);
  const letters = [...byLetter.keys()].filter((l) => byLetter.get(l)!.length >= 3);
  const fresh = (pool: readonly Word[], taken: Set<string>) =>
    shuffle(pool, rand)
      .filter((w) => !taken.has(shownOf(w)) && (uses.get(shownOf(w)) ?? 0) < maxUses)
      .sort((a, b) => (uses.get(shownOf(a)) ?? 0) - (uses.get(shownOf(b)) ?? 0));

  const drafts: { rows: [Word, Word, Word][]; score: number; trap: Word | null }[] = [];
  let guard = 0;
  while (drafts.length < count) {
    if (++guard > count * 300) throw new Error('task 10: cannot build enough tasks');
    const sameCount = [2, 2, 3, 3, 3, 4][Math.floor(rand() * 6)]!;
    const plan = shuffle(
      [0, 1, 2, 3, 4].map((i) => i < sameCount),
      rand,
    );
    const taken = new Set<string>();
    const rows: [Word, Word, Word][] = [];
    let trap: Word | null = null;
    let ok = true;
    for (const want of plan) {
      let row: [Word, Word, Word] | null = null;
      for (let attempt = 0; attempt < 40 && !row; attempt++) {
        const l = letters[Math.floor(rand() * letters.length)]!;
        const pick = fresh(byLetter.get(l)!, taken);
        if (want) {
          if (pick.length >= 3) row = [pick[0]!, pick[1]!, pick[2]!];
        } else {
          const others = fresh(
            words.filter((w) => letterOf(w) !== l),
            taken,
          );
          if (pick.length >= 2 && others.length >= 1)
            row = shuffle([pick[0]!, pick[1]!, others[0]!], rand) as [Word, Word, Word];
        }
        if (row && (seenRows.has(rowKey(row)) || same(row) !== want)) row = null;
      }
      if (!row) {
        ok = false;
        break;
      }
      if (!want && !trap) {
        const counts = new Map<string, number>();
        for (const w of row) counts.set(letterOf(w), (counts.get(letterOf(w)) ?? 0) + 1);
        trap = row.find((w) => counts.get(letterOf(w)) === 1) ?? null;
      }
      for (const w of row) taken.add(shownOf(w));
      rows.push(row);
    }
    if (!ok) continue;
    for (const r of rows) {
      seenRows.add(rowKey(r));
      for (const w of r) uses.set(shownOf(w), (uses.get(shownOf(w)) ?? 0) + 1);
    }
    const kinds = new Set(rows.flat().map((w) => orthogramOf(w.rule))).size;
    const traps = rows.filter((r) => !same(r)).length;
    drafts.push({ rows, trap, score: kinds + traps * 0.5 + rand() * 0.01 });
  }
  // 15 / 18 / 17 here; with tasks 1–50 (15 / 22 / 13) the bank is 30 / 40 / 30.
  const order = drafts.map((d, i) => ({ i, s: d.score })).sort((a, b) => a.s - b.s);
  const diff = new Map<number, 1 | 2 | 3>();
  order.forEach((o, rank) => diff.set(o.i, rank < 15 ? 1 : rank < 33 ? 2 : 3));
  return drafts.map((d, i) => {
    const focus = d.trap ?? d.rows[0]![0];
    return {
      n: base.length + i + 1,
      difficulty: diff.get(i)!,
      rows: d.rows,
      note: TIPS[orthogramOf(focus.rule)]!,
    };
  });
}

export const AUTHORED_TASKS_10_EXTRA: readonly AuthoredTask10[] = generateTasks10();
export const ALL_TASKS_10: readonly AuthoredTask10[] = [
  ...AUTHORED_TASKS_10,
  ...AUTHORED_TASKS_10_EXTRA,
];
