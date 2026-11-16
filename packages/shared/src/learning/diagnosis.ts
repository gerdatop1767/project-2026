import { calculateSkillMastery, skillLevel, type SkillLevel } from './mastery.js';

/**
 * Why a student struggles with one EGE number (docs/learning/PERSONAL-PLANS.md
 * § Диагностика). Deterministic rules over what the attempts really show —
 * never a guess: every type has a minimum amount of evidence, and below it
 * the answer is «мало данных» with a diagnostic training instead of a cause.
 *
 * The server prepares per attempt only facts it can check itself:
 * - `nearMiss` — a wrong numeric answer close to the right one (sign flipped,
 *   decimal point shifted, within 10 %): a calculation slip, not a method one;
 * - `partial` — a «запишите номера» answer that shares some digits with the
 *   key but misses or adds others: part of the condition was not applied;
 * - `blank` — nothing entered;
 * - `afterExplanation` — a wrong answer on a task whose solution the student
 *   had already opened;
 * - `subtype` — what the task asks / which rule (the number's card,
 *   `numberCards.ts`, over `taskFeatures`);
 * - `setDiff` — for an answer that is a set (roots of №13, digits of a
 *   «запишите номера» task): every entered item is right but some are
 *   missing (`missing`), or every right item is there plus wrong ones
 *   (`extra`); `mixed` otherwise;
 * - `parts` — for a multi-part task, each part's own key (the error type of
 *   №8, the device group of №22, «а/б/в» of a number-theory task) and
 *   whether that part was right.
 */
export const problemTypes = [
  'theory_gap',
  'algorithm_gap',
  'formula_misuse',
  'computational',
  'condition',
  'confuses_methods',
  'careless',
  'hard_tasks',
  'forgetting',
  'missed_items',
  'extra_items',
  'weak_part',
  'unclear',
  'insufficient_data',
  'none',
] as const;
export type ProblemType = (typeof problemTypes)[number];

/** A cause that comes with a specific advice (not «мало данных» / «всё хорошо»). */
export function isConcreteProblem(type: ProblemType): boolean {
  return type !== 'unclear' && type !== 'insufficient_data' && type !== 'none';
}

export interface DiagnosisAttempt {
  readonly taskId: string;
  readonly isCorrect: boolean;
  readonly createdAt: Date;
  /** Authored 1..3. */
  readonly difficulty: number;
  readonly subtype?: string | null;
  readonly nearMiss?: boolean;
  readonly partial?: boolean;
  readonly blank?: boolean;
  readonly afterExplanation?: boolean;
  readonly setDiff?: SetDiff | null;
  readonly parts?: readonly { readonly key: string; readonly ok: boolean }[];
}

export type SetDiff = 'missing' | 'extra' | 'mixed';

/**
 * What exactly inside the number the cause concerns, when the evidence
 * names it: the weakest subtype (`confuses_methods`) or the weakest part
 * (`weak_part`). Keys are those of the number's card.
 */
export interface DiagnosisDetail {
  readonly kind: 'subtype' | 'part';
  readonly key: string;
}

export interface Diagnosis {
  readonly type: ProblemType;
  /** All causes the evidence supports, strongest first (`type` is the first). */
  readonly also: readonly ProblemType[];
  /** The student's own numbers behind the conclusion, in Russian. */
  readonly evidence: readonly string[];
  /** The subtype or part the main cause concerns, when known. */
  readonly detail?: DiagnosisDetail | null;
  readonly mastery: number;
  readonly level: SkillLevel;
  readonly attempts: number;
  readonly accuracy: number | null;
}

const DAY = 86_400_000;

function pct(correct: number, total: number): number {
  return total === 0 ? 0 : Math.round((correct / total) * 100);
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} ${one}`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}
const attemptsWord = (n: number) => plural(n, 'попытка', 'попытки', 'попыток');
const errorsWord = (n: number) => plural(n, 'ошибка', 'ошибки', 'ошибок');

/** Minimum history before any cause is named. */
export const MIN_ATTEMPTS_FOR_DIAGNOSIS = 4;
export const MIN_ERRORS_FOR_DIAGNOSIS = 2;

export function diagnoseSkill(input: {
  readonly subjectId: string;
  readonly attempts: readonly DiagnosisAttempt[];
}): Diagnosis {
  const list = [...input.attempts].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const m = calculateSkillMastery(list);
  const level = skillLevel(m);
  const n = list.length;
  const wrong = list.filter((a) => !a.isCorrect);
  const correct = n - wrong.length;
  const base = { mastery: m.mastery, level, attempts: n, accuracy: n ? pct(correct, n) : null };

  if (n < MIN_ATTEMPTS_FOR_DIAGNOSIS || wrong.length < MIN_ERRORS_FOR_DIAGNOSIS) {
    const good = n >= MIN_ATTEMPTS_FOR_DIAGNOSIS && wrong.length < MIN_ERRORS_FOR_DIAGNOSIS;
    return {
      ...base,
      type: good ? 'none' : 'insufficient_data',
      also: [],
      evidence: [
        good
          ? `${attemptsWord(n)}, ${errorsWord(wrong.length)} — причин для тревоги нет.`
          : `Пока ${attemptsWord(n)} и ${errorsWord(wrong.length)} — этого мало, чтобы понять причину.`,
      ],
    };
  }

  const found: { type: ProblemType; evidence: string; detail?: DiagnosisDetail }[] = [];

  // Forgetting: solid before a long break, clearly worse after it.
  for (let i = 1; i < n; i++) {
    const gap = list[i]!.createdAt.getTime() - list[i - 1]!.createdAt.getTime();
    if (gap < 14 * DAY) continue;
    const before = list.slice(0, i);
    const after = list.slice(i);
    const accBefore = pct(before.filter((a) => a.isCorrect).length, before.length);
    const accAfter = pct(after.filter((a) => a.isCorrect).length, after.length);
    if (before.length >= 4 && after.length >= 3 && accBefore >= 70 && accAfter <= accBefore - 25) {
      found.push({
        type: 'forgetting',
        evidence: `До перерыва в ${Math.round(gap / DAY)} дн. — ${accBefore}% верных, после — ${accAfter}%.`,
      });
      break;
    }
  }

  const afterExpl = wrong.filter((a) => a.afterExplanation).length;
  if (afterExpl >= 2) {
    found.push({
      type: 'formula_misuse',
      evidence: `${errorsWord(afterExpl)} уже после просмотра разбора того же задания.`,
    });
  }

  // One part of a multi-part number keeps failing while the others hold:
  // e.g. the «деепричастный оборот» letter of №8, or «в)» of №19.
  const byPart = new Map<string, { n: number; ok: number }>();
  for (const a of list) {
    for (const part of a.parts ?? []) {
      const s = byPart.get(part.key) ?? { n: 0, ok: 0 };
      byPart.set(part.key, { n: s.n + 1, ok: s.ok + (part.ok ? 1 : 0) });
    }
  }
  const weakParts = [...byPart]
    .map(([key, s]) => {
      let restN = 0;
      let restOk = 0;
      for (const [k, o] of byPart) {
        if (k === key) continue;
        restN += o.n;
        restOk += o.ok;
      }
      return {
        key,
        n: s.n,
        fails: s.n - s.ok,
        acc: pct(s.ok, s.n),
        restN,
        rest: pct(restOk, restN),
      };
    })
    .filter((w) => w.n >= 3 && w.fails >= 2 && w.acc <= 50 && w.restN >= 3 && w.rest - w.acc >= 30)
    .sort((a, b) => a.acc - b.acc || b.n - a.n);
  if (weakParts.length > 0) {
    const w = weakParts[0]!;
    found.push({
      type: 'weak_part',
      evidence: `Одна часть задания неверна в ${w.fails} из ${w.n} случаев, остальные части — ${w.rest}% верных.`,
      detail: { kind: 'part', key: w.key },
    });
  }

  // Set answers: every entered item right, but some missing / extra.
  const missing = wrong.filter((a) => a.setDiff === 'missing').length;
  if (missing >= 2 && missing / wrong.length >= 0.4) {
    found.push({
      type: 'missed_items',
      evidence: `В ${plural(missing, 'ответе', 'ответах', 'ответах')} из ${wrong.length} всё записанное верно, но часть верных вариантов не записана.`,
    });
  }
  const extra = wrong.filter((a) => a.setDiff === 'extra').length;
  if (extra >= 2 && extra / wrong.length >= 0.4) {
    found.push({
      type: 'extra_items',
      evidence: `В ${plural(extra, 'ответе', 'ответах', 'ответах')} из ${wrong.length} все верные варианты есть, но добавлены лишние.`,
    });
  }

  // Confusing similar methods / rules: one subtype fine, a sibling one not.
  const bySubtype = new Map<string, { n: number; ok: number }>();
  for (const a of list) {
    if (!a.subtype) continue;
    const s = bySubtype.get(a.subtype) ?? { n: 0, ok: 0 };
    bySubtype.set(a.subtype, { n: s.n + 1, ok: s.ok + (a.isCorrect ? 1 : 0) });
  }
  const measured = [...bySubtype].filter(([, s]) => s.n >= 2);
  if (measured.length >= 2) {
    const sorted = measured
      .map(([k, s]) => ({ k, acc: pct(s.ok, s.n), n: s.n }))
      .sort((a, b) => b.acc - a.acc);
    const best = sorted[0]!;
    const worst = sorted[sorted.length - 1]!;
    if (best.acc >= 70 && worst.acc <= 40 && best.acc - worst.acc >= 35) {
      found.push({
        type: 'confuses_methods',
        evidence: `Задания одного вида решаются на ${best.acc}%, похожего на него — на ${worst.acc}%.`,
        detail: { kind: 'subtype', key: worst.k },
      });
    }
  }

  const near = wrong.filter((a) => a.nearMiss).length;
  if (input.subjectId === 'math' && near >= 2 && near / wrong.length >= 0.4) {
    found.push({
      type: 'computational',
      evidence: `${plural(near, 'неверный ответ', 'неверных ответа', 'неверных ответов')} из ${wrong.length} почти совпадают с верным (знак, запятая, близкое число).`,
    });
  }

  // Partial answers not already explained as «missing» / «extra».
  const cond = wrong.filter(
    (a) => (a.partial && a.setDiff !== 'missing' && a.setDiff !== 'extra') || a.blank,
  ).length;
  if (cond >= 2 && cond / wrong.length >= 0.4) {
    found.push({
      type: 'condition',
      evidence: `В ${plural(cond, 'ответе', 'ответах', 'ответах')} из ${wrong.length} часть верных вариантов найдена, а часть пропущена, лишняя или ответа нет.`,
    });
  }

  const easy = list.filter((a) => a.difficulty <= 2);
  const hard = list.filter((a) => a.difficulty >= 3);
  const accEasy = pct(easy.filter((a) => a.isCorrect).length, easy.length);
  const accHard = pct(hard.filter((a) => a.isCorrect).length, hard.length);
  if (easy.length >= 3 && hard.length >= 3 && accEasy >= 70 && accHard <= 40) {
    found.push({
      type: 'hard_tasks',
      evidence: `Базовые задания — ${accEasy}% верных, сложные — ${accHard}%.`,
    });
  }

  // Careless: mostly right, and slips fixed on the very next try without a
  // solution opened.
  const accuracy = pct(correct, n);
  let quickFixes = 0;
  for (const w of wrong) {
    const next = list.find((a) => a.taskId === w.taskId && a.createdAt > w.createdAt);
    if (
      next?.isCorrect &&
      !next.afterExplanation &&
      next.createdAt.getTime() - w.createdAt.getTime() < DAY
    ) {
      quickFixes++;
    }
  }
  if (n >= 6 && accuracy >= 65 && quickFixes >= 2 && quickFixes / wrong.length >= 0.5) {
    found.push({
      type: 'careless',
      evidence: `${accuracy}% верных в целом; ${plural(quickFixes, 'ошибку', 'ошибки', 'ошибок')} ты сам исправил со второй попытки, без разбора.`,
    });
  }

  // A real gap in the rule (Russian) or the solving algorithm (math): low
  // results across several different tasks.
  const recent = list.slice(-8);
  const recentAcc = pct(recent.filter((a) => a.isCorrect).length, recent.length);
  const wrongTasks = new Set(wrong.map((a) => a.taskId)).size;
  if (n >= 5 && recentAcc <= 45 && wrongTasks >= 3) {
    found.push({
      type: input.subjectId === 'russian' ? 'theory_gap' : 'algorithm_gap',
      evidence: `За последние ${attemptsWord(recent.length)} — ${recentAcc}% верных; ошибки в ${plural(wrongTasks, 'разном задании', 'разных заданиях', 'разных заданиях')}.`,
    });
  }

  if (found.length === 0) {
    return {
      ...base,
      type: 'unclear',
      also: [],
      evidence: [
        `${attemptsWord(n)}, ${errorsWord(wrong.length)} (${accuracy}% верных). По этим ответам причину не определить — нужна диагностическая подборка.`,
      ],
    };
  }
  return {
    ...base,
    type: found[0]!.type,
    also: found.slice(1).map((f) => f.type),
    evidence: found.map((f) => f.evidence),
    detail: found[0]!.detail ?? null,
  };
}

// -------------------------------------------------------------- answer facts

function num(s: string): number | null {
  const t = s.trim().replace(/\s+/g, '').replace(',', '.').replace(/−/g, '-');
  if (!/^-?\d+(?:\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** A wrong numeric answer that is a slip away from the right one. */
export function isNearMiss(answer: string, correct: string): boolean {
  const u = num(answer);
  const c = num(correct);
  if (u === null || c === null || u === c) return false;
  if (c !== 0 && u === -c) return true;
  if (c !== 0) {
    const ratio = u / c;
    if ([10, 100, 0.1, 0.01].some((r) => Math.abs(ratio - r) < 1e-9)) return true;
    if (Math.abs(u - c) / Math.abs(c) <= 0.1) return true;
  }
  return Number.isInteger(c) && Math.abs(u - c) === 1 && Math.abs(c) >= 3;
}

/** A «запишите номера» answer sharing some digits with the key, not all. */
export function isPartialDigitAnswer(answer: string, correct: string): boolean {
  const digits = (s: string) =>
    /^[\d\s,;]+$/.test(s.trim()) ? new Set(s.replace(/\D/g, '')) : null;
  const u = digits(answer);
  const c = digits(correct);
  if (!u || !c || u.size === 0 || c.size < 2) return false;
  const shared = [...u].filter((d) => c.has(d)).length;
  const same = shared === c.size && u.size === c.size;
  return shared > 0 && !same;
}

/**
 * Splits a set answer into items: «-4π; -3π; -8π/3», «π, 3π/2», «135» (a
 * «запишите номера» answer, one digit per item). A comma between two
 * digits is a decimal comma, not a separator.
 */
export function answerItems(answer: string): string[] | null {
  const t = answer.trim().replace(/−/g, '-').toLowerCase();
  if (t === '') return null;
  if (/^\d+$/.test(t)) return [...new Set(t.split(''))];
  if (/^[\d\s,;]+$/.test(t) && /[,;\s]/.test(t))
    return [...new Set(t.replace(/\D/g, '').split(''))];
  const items = t
    .split(/;|,(?!\d)|(?<!\d),/)
    .map((x) => x.replace(/\s+/g, ''))
    .filter(Boolean);
  return items.length ? [...new Set(items)] : null;
}

/**
 * How a wrong set answer differs from the key: only when the key has two or
 * more items and items compare exactly (no guessing about equal forms like
 * «1.5π» and «3π/2» — a different spelling is `mixed`, never «missing»).
 */
export function setAnswerDiff(answer: string, correct: string): SetDiff | null {
  const u = answerItems(answer);
  const c = answerItems(correct);
  if (!u || !c || c.length < 2) return null;
  const inKey = u.filter((x) => c.includes(x)).length;
  const covered = c.filter((x) => u.includes(x)).length;
  if (inKey === u.length && covered === c.length) return null; // same set
  if (inKey === u.length && covered < c.length) return 'missing';
  if (covered === c.length && inKey < u.length) return 'extra';
  return inKey > 0 ? 'mixed' : null;
}
