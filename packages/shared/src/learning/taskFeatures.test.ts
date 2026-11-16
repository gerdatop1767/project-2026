import { describe, expect, it } from 'vitest';
import { canonicalSubtopic, taskFeatures } from './taskFeatures.js';
import { closeness, matchOf, rankSimilarTasks, type SimilarCandidate } from './similarRanking.js';

const math = (conditionMd: string) => taskFeatures({ subjectId: 'math', conditionMd });
const ru = (conditionMd: string) => taskFeatures({ subjectId: 'russian', conditionMd });

describe('task features (classification from the condition text)', () => {
  it('stereometry: what is asked tells the subtype; the solid is context', () => {
    const a = math(
      'В правильной пирамиде $SABC$ ... б) Найдите угол между прямой $SA$ и плоскостью $ABC$.',
    );
    expect(a.primary).toContain('angle-line-plane');
    expect(a.secondary).toContain('pyramid');
    const b = math(
      'В кубе $ABCDA_1B_1C_1D_1$ ... б) Найдите расстояние от точки $A$ до плоскости $BDC_1$.',
    );
    expect(b.primary).toContain('dist-point-plane');
    expect(b.secondary).toContain('box');
    const c = math('В правильной призме ... б) Найдите угол между плоскостями $ABC$ и $A_1BC$.');
    expect(c.primary).toContain('angle-planes');
    expect(a.subtype).not.toBe(b.subtype);
    expect(a.subtype).not.toBe(c.subtype);
  });

  it('«докажите» and «на отрезке» are context, not a different kind of task', () => {
    const x = math(
      'а) Решите уравнение $2\\sin^2 x = \\cos x + 1$. б) Найдите все корни, принадлежащие отрезку.',
    );
    const y = math('Решите уравнение $2\\sin^2 x = \\cos x + 1$.');
    expect(x.subtype).toBe(y.subtype);
    expect(x.secondary).toEqual(expect.arrayContaining(['trig', 'root-selection']));
  });

  it('Russian: the asked spelling or mark is the subtype (Cyrillic-safe)', () => {
    expect(ru('Укажите цифру(-ы), на месте которой(-ых) пишется **одна буква Н**.').subtype).toBe(
      'one-n',
    );
    expect(ru('Укажите цифру(-ы), на месте которой(-ых) пишется НН.').subtype).toBe('double-n');
    expect(ru('Укажите цифру(-ы), на месте которой(-ых) пишется Н. Графиня...').subtype).toBe(
      'one-n',
    );
    expect(ru('Найдите предложения, в которых тире ставится в соответствии...').subtype).toBe(
      'mark-dash',
    );
    expect(
      ru('Укажите варианты ответов, в которых НЕ с выделенным словом пишется РАЗДЕЛЬНО.').subtype,
    ).toBe('write-apart');
    expect(ru('Какие из высказываний не соответствуют содержанию текста?').subtype).toBe(
      'statements-false',
    );
    expect(ru('Какие из высказываний соответствуют содержанию текста?').subtype).toBe(
      'statements-true',
    );
  });

  it('no rule → no subtype (never a guess); same text → same result', () => {
    const plain = ru(
      'Укажите варианты ответов, в которых во всех словах одного ряда пропущена одна и та же буква.',
    );
    expect(plain.subtype).toBeNull();
    expect(taskFeatures({ subjectId: 'history', conditionMd: 'Найдите угол' }).subtype).toBeNull();
    expect(math('Найдите объём куба')).toEqual(math('Найдите объём куба'));
  });

  it('importer subtopic aliases collapse to one spelling', () => {
    expect(canonicalSubtopic('russian-n-nn-spelling')).toBe(
      canonicalSubtopic('russian-nn-spelling'),
    );
    expect(canonicalSubtopic('trigonometry-identities')).toBe('trig-identities');
    expect(canonicalSubtopic(null)).toBeNull();
  });
});

function task(
  id: string,
  condition: string,
  extra: Partial<SimilarCandidate> = {},
): SimilarCandidate {
  return {
    taskId: id,
    taskNumber: 15,
    features: ru(condition),
    subtopic: 'russian-nn-spelling',
    methodSkills: [],
    difficulty: 50,
    answerType: 'short_answer',
    ...extra,
  };
}
const ONE = 'Укажите цифру(-ы), на месте которой(-ых) пишется одна буква Н.';
const TWO = 'Укажите цифру(-ы), на месте которой(-ых) пишется НН.';
const none = {
  solved: new Set<string>(),
  recent: new Set<string>(),
  mistakeSubtypes: new Set<string>(),
  failedTarget: false,
};

describe('similar ranking', () => {
  it('the same subtype first, then the rest of the same topic', () => {
    const target = task('t', ONE);
    const pool = [task('b-two', TWO), task('a-one', ONE), task('c-one', ONE)];
    const ranked = rankSimilarTasks(target, pool, none, 10);
    expect(ranked.map((r) => r.taskId)).toEqual(['a-one', 'c-one', 'b-two']);
    expect(ranked.map((r) => r.match)).toEqual(['exact', 'exact', 'close']);
    expect(matchOf(target, pool[0]!)).toBe('close'); // same subtopic, other rule
  });

  it('widens step by step and never adds anything outside the pool', () => {
    const target = task('t', ONE);
    const pool = [task('x', TWO, { subtopic: 'other' }), task('y', ONE), task('z', TWO)];
    const ranked = rankSimilarTasks(target, pool, none, 10);
    expect(ranked.map((r) => [r.taskId, r.match])).toEqual([
      ['y', 'exact'],
      ['z', 'close'],
      ['x', 'topic'],
    ]);
    expect(rankSimilarTasks(target, pool, none, 2)).toHaveLength(2);
    expect(rankSimilarTasks(target, [], none, 5)).toEqual([]);
  });

  it('never the task itself, nothing just answered or shown; solved tasks only last', () => {
    const target = task('t', ONE);
    const pool = [task('t', ONE), task('a', ONE), task('b', ONE), task('c', ONE)];
    const ranked = rankSimilarTasks(
      target,
      pool,
      { ...none, recent: new Set(['b']), solved: new Set(['a']) },
      10,
    );
    expect(ranked.map((r) => r.taskId)).toEqual(['c', 'a']);
  });

  it('the student’s own wrong subtype goes first within a tier; after a miss, not harder', () => {
    const target = task('t', ONE, { features: ru('Укажите варианты, где пишется слитно') });
    const pool = [task('a', ONE), task('b', TWO)];
    const plain = rankSimilarTasks(target, pool, none, 10).map((r) => r.taskId);
    const personal = rankSimilarTasks(
      target,
      pool,
      { ...none, mistakeSubtypes: new Set(['double-n']) },
      10,
    ).map((r) => r.taskId);
    expect(personal[0]).toBe('b');
    expect(plain).toHaveLength(2);

    const easy = task('easy', ONE, { difficulty: 50 });
    const hard = task('hard', ONE, { difficulty: 90 });
    const failed = rankSimilarTasks(
      task('t', ONE),
      [hard, easy],
      { ...none, failedTarget: true },
      2,
    );
    expect(failed[0]!.taskId).toBe('easy');
  });

  it('closeness is symmetric-ish and bounded', () => {
    const a = task('a', ONE);
    const b = task('b', TWO);
    expect(closeness(a, a)).toBe(100);
    expect(closeness(a, b)).toBeGreaterThanOrEqual(0);
    expect(closeness(a, b)).toBeLessThan(100);
  });
});
