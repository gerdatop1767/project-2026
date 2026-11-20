import { describe, expect, it } from 'vitest';
import {
  classifyFactIssue,
  FACT_CATEGORIES_CRITICAL,
  statesNumberOrDate,
} from './factClassification.js';

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
      rule: 'minor_with_number',
    });
    expect(classifyFactIssue({ claim: 'экзамен в июне', category: 'style' }).criticality).toBe(
      'ambiguous',
    );
    // No keyword lists on topics: a plain wording note stays minor.
    expect(
      classifyFactIssue({
        claim: '«баллы ЕГЭ» лучше писать как «баллы за ЕГЭ»',
        category: 'wording',
      }).criticality,
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
