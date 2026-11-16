import { describe, expect, it } from 'vitest';
import { adviceForSkill, cardProblems } from './adviceBase.js';
import { diagnoseSkill, setAnswerDiff, type DiagnosisAttempt } from './diagnosis.js';
import { allExamSkills, examSkillInfo } from './examSkills.js';
import { cardPartKeys, cardSubtypeOf, numberCard, numberCards } from './numberCards.js';
import { taskFeatures } from './taskFeatures.js';

const supported = allExamSkills().filter(
  (s) => s.subjectId === 'math' || s.subjectId === 'russian',
);

describe('advice base coverage', () => {
  it('every supported EGE skill (all numbers, every edition) has a card', () => {
    const missing = supported.filter((s) => !numberCard(s.key)).map((s) => s.key);
    expect(missing).toEqual([]);
    expect(
      numberCards()
        .map((c) => c.skill)
        .sort(),
    ).toEqual(supported.map((s) => s.key).sort());
  });

  it('every card is complete: algorithm, rule, slip, check, trap, theory, exercises', () => {
    for (const c of numberCards()) {
      expect(c.algorithm.length, c.skill).toBeGreaterThanOrEqual(3);
      expect(c.exercises.length, c.skill).toBeGreaterThanOrEqual(2);
      expect(c.theory.length, c.skill).toBeGreaterThanOrEqual(2);
      expect(c.name.length, c.skill).toBeGreaterThan(3);
      for (const text of [c.rule, c.slip, c.selfCheck, c.conditionTrap, c.hard]) {
        expect(text.trim().length, c.skill).toBeGreaterThan(10);
      }
      const keys = (c.subtypes ?? []).map((s) => s.key);
      expect(new Set(keys).size, c.skill).toBe(keys.length);
    }
  });

  it('every (number, cause) has a specific, complete advice — practice, control and a success criterion', () => {
    let total = 0;
    for (const c of numberCards()) {
      for (const p of cardProblems(c)) {
        const detail =
          p === 'weak_part' ? { kind: 'part' as const, key: c.parts!.items[0]!.key } : null;
        const a = adviceForSkill(c.skill, p, detail);
        const where = `${c.skill}:${p}`;
        expect(a.generic, where).toBe(false);
        expect(a.problem, where).toBe(p);
        for (const text of [
          a.title,
          a.whatIsWrong,
          a.howItShows ?? '',
          a.why,
          a.successCriterion ?? '',
        ]) {
          expect(text.trim().length, where).toBeGreaterThan(5);
        }
        expect(a.review.length, where).toBeGreaterThan(0);
        expect(a.steps.length, where).toBeGreaterThanOrEqual(3);
        expect(new Set(a.steps).size, `${where} duplicate step`).toBe(a.steps.length);
        expect(a.exercises?.length ?? 0, where).toBeGreaterThan(0);
        expect(a.practice.tasks, where).toBeGreaterThan(0);
        expect(a.control.tasks, where).toBeGreaterThan(0);
        expect(a.control.passAccuracy, where).toBeGreaterThan(0);
        expect(a.theorySections?.length ?? 0, where).toBeGreaterThan(0);
        expect([...a.steps, a.why].join(' '), where).not.toMatch(
          /больше практикуйся|undefined|null/i,
        );
        total++;
      }
    }
    expect(total).toBeGreaterThanOrEqual(370);
  });

  it('advice differs by number, not only by the title: no two numbers share the same content', () => {
    const byProblem = new Map<string, Map<string, string>>();
    for (const c of numberCards()) {
      for (const p of cardProblems(c)) {
        if (p === 'weak_part') continue;
        const a = adviceForSkill(c.skill, p);
        const body = [a.howItShows, ...a.steps, ...(a.exercises ?? [])]
          .join('|')
          .replace(/№\d+|«[^»]+»/g, '');
        const seen = byProblem.get(p) ?? new Map<string, string>();
        expect(seen.get(body), `${c.skill} repeats ${seen.get(body)} for ${p}`).toBeUndefined();
        seen.set(body, c.skill);
        byProblem.set(p, seen);
      }
    }
  });

  it('numbers with several subtypes get advice per subtype', () => {
    let split = 0;
    for (const c of numberCards()) {
      if ((c.subtypes?.length ?? 0) < 2) continue;
      const seen = new Set<string>();
      for (const s of c.subtypes!) {
        const a = adviceForSkill(c.skill, 'confuses_methods', { kind: 'subtype', key: s.key });
        expect(a.focus).toEqual({ kind: 'subtype', key: s.key, label: s.label });
        expect(a.steps.join(' ')).toContain(s.method);
        seen.add(a.whatIsWrong);
        split++;
      }
      expect(seen.size, c.skill).toBe(c.subtypes!.length);
    }
    expect(split).toBeGreaterThanOrEqual(50);
  });

  it('multi-part numbers get advice per part (№8 error types, №22 devices, №19 а/б/в)', () => {
    for (const skill of [
      'russian.08-syntax-norms',
      'russian.22-expressive-means',
      'math.number-theory',
    ]) {
      const c = numberCard(skill)!;
      const seen = new Set<string>();
      for (const part of c.parts!.items) {
        const a = adviceForSkill(skill, 'weak_part', { kind: 'part', key: part.key });
        expect(a.focus?.key).toBe(part.key);
        expect(a.steps).toEqual(expect.arrayContaining([...part.steps]));
        seen.add(a.howItShows!);
      }
      expect(seen.size).toBe(c.parts!.items.length);
    }
  });

  it('an unknown cause is never presented as a fact', () => {
    for (const c of numberCards()) {
      for (const p of ['unclear', 'insufficient_data'] as const) {
        const a = adviceForSkill(c.skill, p);
        expect(a.title).toBe('Нужна диагностика');
        expect(a.focus ?? null).toBeNull();
        expect(a.steps.join(' ')).toMatch(/диагностическую подборку/);
        expect(a.why).toMatch(/нельзя определить/);
      }
      // A part the evidence did not name falls back to the number's rule advice, not to a guess.
      if (c.parts) expect(adviceForSkill(c.skill, 'weak_part').focus ?? null).toBeNull();
    }
  });

  it('math №13: lost and extra roots have their own advice', () => {
    const lost = adviceForSkill('math.equations-advanced', 'missed_items');
    const extra = adviceForSkill('math.equations-advanced', 'extra_items');
    expect(lost.title).toBe('Потерянные корни');
    expect(extra.title).toBe('Лишние корни');
    expect(lost.steps[0]).toMatch(/выноси его за скобки/);
    expect(extra.steps[0]).toMatch(/ОДЗ/);
  });
});

describe('card classification of real tasks', () => {
  it('subtypes come from the task text; a task no subtype fits has none', () => {
    const card = numberCard('math.equations-simple')!;
    const f = (md: string) =>
      cardSubtypeOf(card, taskFeatures({ subjectId: 'math', conditionMd: md }));
    expect(f('Решите уравнение $\\log_2(x+3)=4$.')?.key).toBe('log');
    expect(f('Решите уравнение $\\sqrt{x+6}=x$.')?.key).toBe('sqrt');
    expect(f('Решите уравнение $\\frac{x}{x-2}=3$.')?.key).toBe('rational');
    expect(
      cardSubtypeOf(numberCard('math.modelling')!, { primary: ['motion'], secondary: [] }),
    ).toBeNull();
  });

  it('№8: each letter gets the error type named in its own line', () => {
    const md = [
      '**ГРАММАТИЧЕСКИЕ ОШИБКИ**',
      'А) неправильное употребление падежной (предложно-падежной) формы управляемого слова',
      'Б) нарушение в построении сложного предложения',
      'В) неправильное построение предложения с причастным оборотом',
      'Г) неправильное построение предложения с деепричастным оборотом',
      'Д) ошибка в построении предложения с однородными членами',
      '**ПРЕДЛОЖЕНИЯ**',
      '1) По возвращению в Россию …',
    ].join('\n\n');
    const parts = ['А', 'Б', 'В', 'Г', 'Д'].map((label, i) => ({
      id: 'abvgd'[i]!,
      label,
      correctAnswer: String(i + 1),
    }));
    expect(
      Object.fromEntries(cardPartKeys(numberCard('russian.08-syntax-norms')!, md, parts)),
    ).toEqual({
      a: 'case',
      b: 'complex',
      v: 'participle',
      g: 'gerund',
      d: 'homogeneous',
    });
  });

  it('№22: the device is read from the answer column; №19: «а/б/в»', () => {
    const md = [
      '**ПРЕДЛОЖЕНИЯ**',
      'А) Жизнь моя! Иль ты приснилась мне?',
      'Б) Весь вечер были ужасные молнии, удары, ливень.',
      '**ИЗОБРАЗИТЕЛЬНО-ВЫРАЗИТЕЛЬНЫЕ СРЕДСТВА ЯЗЫКА**',
      '1) многосоюзие',
      '2) метонимия',
      '3) аллитерация',
      '9) риторическое обращение',
    ].join('\n\n');
    const keys = cardPartKeys(numberCard('russian.22-expressive-means')!, md, [
      { id: 'a', label: 'А', correctAnswer: '9' },
      { id: 'b', label: 'Б', correctAnswer: '2' },
      { id: 'c', label: 'В', correctAnswer: '7' }, // no such term: not guessed
    ]);
    expect(Object.fromEntries(keys)).toEqual({ a: 'syntax', b: 'transfer' });
    const nt = cardPartKeys(numberCard('math.number-theory')!, '', [
      { id: 'a', label: 'а', correctAnswer: 'да' },
      { id: 'b', label: 'б', correctAnswer: 'нет' },
      { id: 'c', label: 'в', correctAnswer: '12' },
    ]);
    expect([...nt.values()]).toEqual(['part-a', 'part-b', 'part-c']);
    // «корень 1 / корень 2» of a multi-part №13 are not parts of the card.
    expect(
      cardPartKeys(numberCard('math.equations-advanced')!, '', [
        { id: 'a', label: 'корень 1', correctAnswer: '1' },
      ]).size,
    ).toBe(0);
  });
});

describe('precise diagnosis facts', () => {
  it('set answers: missing and extra items, never a guess on a different spelling', () => {
    expect(setAnswerDiff('-4π; -3π', '-4π; -3π; -8π/3')).toBe('missing');
    expect(setAnswerDiff('-4π; -3π; -8π/3; -2π', '-4π; -3π; -8π/3')).toBe('extra');
    expect(setAnswerDiff('π, 2π', 'π, 3π/2, 2π')).toBe('missing');
    expect(setAnswerDiff('1.5π', 'π, 3π/2')).toBeNull();
    expect(setAnswerDiff('13', '135')).toBe('missing');
    expect(setAnswerDiff('1345', '135')).toBe('extra');
    expect(setAnswerDiff('12', '135')).toBe('mixed');
    expect(setAnswerDiff('2', '3')).toBeNull();
    expect(setAnswerDiff('0,5', '0,5')).toBeNull();
  });

  const at = (i: number, extra: Partial<DiagnosisAttempt> = {}): DiagnosisAttempt => ({
    taskId: `t${i}`,
    isCorrect: false,
    createdAt: new Date(Date.UTC(2026, 10, 1, 10, i)),
    difficulty: 2,
    ...extra,
  });

  it('lost roots / missed options need two such answers, never one', () => {
    const one = diagnoseSkill({
      subjectId: 'math',
      attempts: [
        at(1, { setDiff: 'missing' }),
        at(2),
        at(3, { isCorrect: true }),
        at(4, { isCorrect: true }),
      ],
    });
    expect(one.type).not.toBe('missed_items');
    const two = diagnoseSkill({
      subjectId: 'math',
      attempts: [
        at(1, { setDiff: 'missing', partial: true }),
        at(2, { setDiff: 'missing', partial: true }),
        at(3, { isCorrect: true }),
        at(4, { isCorrect: true }),
      ],
    });
    expect(two.type).toBe('missed_items');
    expect(two.also).not.toContain('condition');
    const extra = diagnoseSkill({
      subjectId: 'russian',
      attempts: [
        at(1, { setDiff: 'extra' }),
        at(2, { setDiff: 'extra' }),
        at(3, { setDiff: 'extra' }),
        at(4, { isCorrect: true }),
      ],
    });
    expect(extra.type).toBe('extra_items');
  });

  it('a part that keeps failing while others hold is named (№8 letter)', () => {
    const parts = (gerundOk: boolean) => [
      { key: 'gerund', ok: gerundOk },
      { key: 'case', ok: true },
      { key: 'homogeneous', ok: true },
    ];
    const d = diagnoseSkill({
      subjectId: 'russian',
      attempts: [
        at(1, { parts: parts(false) }),
        at(2, { parts: parts(false) }),
        at(3, { parts: parts(false) }),
        at(4, { isCorrect: true, parts: parts(true) }),
      ],
    });
    expect(d.type).toBe('weak_part');
    expect(d.detail).toEqual({ kind: 'part', key: 'gerund' });
    // Twice is not enough evidence.
    const few = diagnoseSkill({
      subjectId: 'russian',
      attempts: [
        at(1, { parts: parts(false) }),
        at(2, { parts: parts(false) }),
        at(3, { isCorrect: true }),
        at(4, { isCorrect: true }),
      ],
    });
    expect(few.type).not.toBe('weak_part');
  });

  it('«confuses methods» names the weakest subtype', () => {
    const d = diagnoseSkill({
      subjectId: 'russian',
      attempts: [
        at(1, { subtype: 'one-n', isCorrect: true }),
        at(2, { subtype: 'one-n', isCorrect: true }),
        at(3, { subtype: 'one-n', isCorrect: true }),
        at(4, { subtype: 'double-n' }),
        at(5, { subtype: 'double-n' }),
        at(6, { subtype: 'double-n' }),
      ],
    });
    expect(d.type).toBe('confuses_methods');
    expect(d.detail).toEqual({ kind: 'subtype', key: 'double-n' });
    expect(adviceForSkill('russian.15-n-nn', d.type, d.detail).whatIsWrong).toMatch(/«НН»/);
  });

  it('every skill key in the cards resolves to an exam skill', () => {
    for (const c of numberCards()) expect(examSkillInfo(c.skill)?.subjectId).toBe(c.subjectId);
  });
});
