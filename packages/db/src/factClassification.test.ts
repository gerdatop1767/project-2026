import { describe, expect, it } from 'vitest';
import {
  classifyFactIssue,
  classifyStyleNote,
  FACT_CATEGORIES_CRITICAL,
  factMarkers,
  statesNumberOrDate,
} from './factClassification.js';
import { buildFactCheckRecord } from './publicationGate.js';

describe('deterministic fact criticality', () => {
  it('every required critical category is critical whatever the model says', () => {
    for (const c of [
      'exam_dates',
      'exam_structure',
      'task_count',
      'primary_scores',
      'test_scores',
      'grading_criteria',
      'exam_rules',
      'regulations',
      'deadlines',
      'numeric_fact',
    ]) {
      expect(FACT_CATEGORIES_CRITICAL).toContain(c);
      expect(classifyFactIssue({ claim: 'x', category: c, severity: 'minor' })).toMatchObject({
        criticality: 'critical',
        rule: 'critical_category',
        modelSeverity: 'minor',
      });
    }
  });

  it('unknown, missing or «other» category → ambiguous (blocks auto publication)', () => {
    for (const category of [undefined, null, '', 'other', 'scores', 'EXAM_DATES'])
      expect(classifyFactIssue({ claim: 'x', category }).criticality).toBe('ambiguous');
  });

  it('a «minor» issue that states a number or a date is not trusted as minor', () => {
    expect(classifyFactIssue({ claim: 'Порог — 27 баллов', category: 'wording' })).toMatchObject({
      criticality: 'ambiguous',
      rule: 'minor_with_marker',
    });
    expect(classifyFactIssue({ claim: 'экзамен в июне', category: 'style' }).criticality).toBe(
      'ambiguous',
    );
    // Exam terms in a «wording» note: not trusted as minor (conservative).
    expect(
      classifyFactIssue({
        claim: '«баллы ЕГЭ» лучше писать как «баллы за ЕГЭ»',
        category: 'wording',
      }).criticality,
    ).toBe('ambiguous');
    // A plain wording note stays minor (as a factual issue it still blocks auto mode).
    expect(
      classifyFactIssue({ claim: '«прорешивать» лучше заменить на «решать»', category: 'wording' })
        .criticality,
    ).toBe('minor');
  });

  it('unknown status counts as a contradiction', () => {
    expect(classifyFactIssue({ claim: 'x', category: 'deadlines', status: 'maybe' }).status).toBe(
      'contradicted',
    );
    expect(
      classifyFactIssue({ claim: 'x', category: 'deadlines', status: 'unverified' }).status,
    ).toBe('unverified');
  });

  it('number/date detector', () => {
    expect(statesNumberOrDate('2 балла')).toBe(true);
    expect(statesNumberOrDate('до первого апреля')).toBe(true);
    expect(statesNumberOrDate('сдавать в мае')).toBe(true);
    expect(statesNumberOrDate('тренируйся каждый день')).toBe(false);
    expect(statesNumberOrDate('самая частая ошибка — маятник')).toBe(false);
  });
});

describe('stage 2.1 review: a factual statement cannot pass as style', () => {
  const FACTUAL_AS_STYLE = [
    'ЕГЭ начинается на два дня раньше',
    'В варианте вдвое больше заданий',
    'Порог изменился',
    'Экзамен перенесли',
    'Критерии оценивания изменились',
  ];
  const record = (o: Parameters<typeof buildFactCheckRecord>[0]['styleNotes'], issues = []) =>
    buildFactCheckRecord({
      verdict: 'pass',
      factualIssues: issues,
      styleNotes: o,
      webChecked: true,
      webSources: ['https://fipi.ru'],
      contentHash: 'a'.repeat(64),
      checkedAt: new Date(),
    });

  it.each(FACTUAL_AS_STYLE)(
    '«%s» as a style note: blocked even if the triage wrongly calls it style_only',
    (text) => {
      expect(classifyStyleNote({ text, triage: 'style_only' })).toMatchObject({
        safe: false,
        rule: 'style_fact_marker',
      });
      const r = record([{ text, triage: 'style_only' }]);
      expect(r.result).toBe('failed');
      expect(r.ambiguous).toHaveLength(1);
      expect(r.criticalContradictions).toEqual([]); // manual review stays possible
    },
  );

  it.each(FACTUAL_AS_STYLE)(
    '«%s» as a factual issue labelled «wording»: blocks auto mode, manual allowed',
    (claim) => {
      const r = record([], [{ claim, category: 'wording', status: 'contradicted' }] as never);
      expect(r.result).toBe('failed');
      expect(r.issues[0]!.criticality).toBe('ambiguous');
      expect(r.criticalContradictions).toEqual([]);
    },
  );

  it('the same claims under their real category: a contradiction no manual approval overrides', () => {
    const r = record([], [
      { claim: 'ЕГЭ начинается на два дня раньше', category: 'exam_dates', status: 'contradicted' },
      {
        claim: 'Критерии оценивания изменились',
        category: 'grading_criteria',
        status: 'contradicted',
      },
    ] as never);
    expect(r.criticalContradictions).toHaveLength(2);
  });

  it('a truly stylistic note passes only with both signals', () => {
    const text = 'Убрать лишнее слово «очень» в абзаце про подготовку';
    expect(factMarkers(text)).toEqual([]);
    expect(classifyStyleNote({ text, triage: 'style_only' }).safe).toBe(true);
    expect(record([{ text, triage: 'style_only' }]).result).toBe('verified');
    for (const triage of [null, undefined, 'unsure', 'may_change_facts', 'yes'])
      expect(record([{ text, triage }]).result).toBe('failed');
  });

  it('common style notes are not over-blocked by the markers', () => {
    for (const text of [
      'Сократить вступление, много воды',
      'Добавить пример в раздел про ошибки',
      'Убрать повтор во втором абзаце',
      'Канцелярит: «осуществить подготовку» → «подготовиться»',
    ])
      expect(factMarkers(text), text).toEqual([]);
  });
});
