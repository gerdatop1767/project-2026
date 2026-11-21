import type { Paronym5 } from './build.js';
import { rng, shuffle } from './types.js';

/**
 * Composes «one of five is wrong» tasks (5, 7) from pools: each error
 * becomes one task (it is the answer), joined by four right units whose
 * conflict keys differ from each other and from the error's — the least
 * used right units first, so the pool is spread evenly.
 */
export interface WrongUnit {
  readonly d: 1 | 2 | 3;
  readonly key: string;
  readonly kind: string;
  readonly s: string;
  readonly fix: string;
  readonly why: string;
  readonly note: string;
  readonly accepted?: readonly string[];
}
export interface RightUnit {
  readonly key: string;
  readonly s: string;
  readonly why: string;
}

/**
 * Two tasks of a number may share at most this many right units: without
 * the limit, picking «the least used first» kept returning the same four
 * units, and neighbouring tasks differed only in the wrong one.
 */
export const MAX_SHARED_RIGHT = 2;

/** Would `unit` make `picked` share more than MAX_SHARED_RIGHT with an earlier task? */
export function tooClose(
  earlier: readonly ReadonlySet<string>[],
  picked: readonly string[],
  unit: string,
): boolean {
  return earlier.some(
    (set) => picked.filter((p) => set.has(p)).length + (set.has(unit) ? 1 : 0) > MAX_SHARED_RIGHT,
  );
}

export function composeOneWrong(
  errors: readonly WrongUnit[],
  rights: readonly RightUnit[],
  seed: number,
  conflictKey: (key: string) => string = (k) => k,
): Paronym5[] {
  const rand = rng(seed);
  const uses = new Map<string, number>();
  let pool = shuffle(rights, rand);
  const earlier: Set<string>[] = [];
  return errors.map((e) => {
    const keys = new Set([conflictKey(e.key)]);
    const picked: RightUnit[] = [];
    pool = [...pool].sort((a, b) => (uses.get(a.s) ?? 0) - (uses.get(b.s) ?? 0));
    for (const unit of pool) {
      if (picked.length === 4) break;
      const k = conflictKey(unit.key);
      if (keys.has(k)) continue;
      if (
        tooClose(
          earlier,
          picked.map((u) => u.s),
          unit.s,
        )
      )
        continue;
      picked.push(unit);
      keys.add(k);
    }
    if (picked.length < 4) throw new Error(`not enough right units for «${e.s}»`);
    for (const u of picked) uses.set(u.s, (uses.get(u.s) ?? 0) + 1);
    earlier.push(new Set(picked.map((u) => u.s)));
    const at = Math.floor(rand() * 5);
    const order = shuffle(picked, rand);
    const s = order.map((u) => u.s);
    const why = order.map((u) => u.why);
    s.splice(at, 0, e.s);
    why.splice(at, 0, e.why);
    return {
      d: e.d,
      kind: e.kind,
      s: s as unknown as Paronym5['s'],
      why: why as unknown as Paronym5['why'],
      wrong: (at + 1) as Paronym5['wrong'],
      fix: e.fix,
      ...(e.accepted ? { accepted: e.accepted } : {}),
      note: e.note,
    };
  });
}
