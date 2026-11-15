import { describe, expect, it } from 'vitest';
import { EXAM_TOPICS, YASHCHENKO_2027_PROJECT_SOURCE } from '../examSpecs.js';
import {
  allExamSkills,
  examSkillInfo,
  examSkillsForSubject,
  examSkillsForTask,
  isExamSkillSlug,
} from './examSkills.js';

describe('exam skills: one stable key per EGE topic', () => {
  it('the same topic in different editions and years is the same skill', () => {
    // ЕГЭ-2026 №16, ЕГЭ-2027 №16 and the old Ященко-2027 №13 — all finance.
    expect(
      examSkillsForTask({ subjectId: 'math', taskNumber: 16, sourceYear: 2026 }).skillKeys,
    ).toEqual(['math.finance']);
    expect(
      examSkillsForTask({ subjectId: 'math', taskNumber: 16, sourceYear: 2027 }).skillKeys,
    ).toEqual(['math.finance']);
    expect(
      examSkillsForTask({
        subjectId: 'math',
        taskNumber: 13,
        sourceYear: 2027,
        source: YASHCHENKO_2027_PROJECT_SOURCE,
      }),
    ).toEqual({ edition: 'ege-2027-project', skillKeys: ['math.finance'] });
    // …while ЕГЭ-2026 №13 is equations.
    expect(
      examSkillsForTask({ subjectId: 'math', taskNumber: 13, sourceYear: 2026 }).skillKeys,
    ).toEqual(['math.equations-advanced']);
  });

  it('Russian №1–27 map to their own topics', () => {
    for (let n = 1; n <= 27; n++) {
      const { skillKeys } = examSkillsForTask({
        subjectId: 'russian',
        taskNumber: n,
        sourceYear: 2027,
      });
      expect(skillKeys).toHaveLength(1);
      expect(skillKeys[0]).toMatch(new RegExp(`^russian\\.${String(n).padStart(2, '0')}-`));
    }
  });

  it('a number the specification does not have gets no invented skill', () => {
    expect(
      examSkillsForTask({ subjectId: 'math', taskNumber: 20, sourceYear: 2026 }).skillKeys,
    ).toEqual([]);
    expect(examSkillsForTask({ subjectId: 'russian', taskNumber: 28 }).skillKeys).toEqual([]);
    expect(examSkillsForTask({ subjectId: 'physics', taskNumber: 1 }).skillKeys).toEqual([]);
  });

  it('every skill knows its current «№ ЕГЭ»; project-only topics have none', () => {
    expect(examSkillInfo('math.finance')).toMatchObject({ examNumber: 16, part: 2 });
    expect(examSkillInfo('math.planimetry')).toMatchObject({ examNumber: 1, part: 1 });
    expect(examSkillInfo('russian.27-essay')).toMatchObject({ examNumber: 27, part: 2 });
    expect(examSkillInfo('math.random-variables')?.examNumber).toBeNull();
    expect(
      examSkillsForSubject('math')
        .map((s) => s.examNumber)
        .slice(0, 19),
    ).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    expect(examSkillsForSubject('russian')).toHaveLength(27);
    expect(allExamSkills()).toHaveLength(EXAM_TOPICS.length);
  });

  it('exam skill slugs never collide with method skills (no dot in those)', () => {
    expect(isExamSkillSlug('math.planimetry')).toBe(true);
    expect(isExamSkillSlug('substitution')).toBe(false);
  });
});
