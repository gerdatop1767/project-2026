import { describe, expect, it } from 'vitest';
import {
  CODIFIER_EXTRAS,
  EXAM_EDITIONS,
  EXAM_TASK_SPECS,
  EXAM_TOPICS,
  YASHCHENKO_2027_PROJECT_SOURCE,
  examEditionForTask,
  examEditionsFor,
  examNumbersForTopic,
  examTaskSpec,
  topicKeysForTask,
  type ExamEditionId,
} from './examSpecs.js';
import { EXAM_SCORING_RULES } from './examScoring.js';

const numbers = (subjectId: string, edition: ExamEditionId) =>
  EXAM_TASK_SPECS.filter((s) => s.subjectId === subjectId && s.edition === edition).map(
    (s) => s.number,
  );
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('exam editions: ЕГЭ-2026, current ЕГЭ-2027, the 2027 project (old Ященко)', () => {
  it('math: 19 numbers in 2026 and in the current 2027, 20 only in the project; Russian 27/27', () => {
    expect(numbers('math', 'ege-2026')).toEqual(range(19));
    expect(numbers('math', 'ege-2027')).toEqual(range(19));
    expect(numbers('math', 'ege-2027-project')).toEqual(range(20));
    expect(numbers('russian', 'ege-2026')).toEqual(range(27));
    expect(numbers('russian', 'ege-2027')).toEqual(range(27));
    expect(numbers('russian', 'ege-2027-project')).toEqual([]);
  });

  it('the current 2027 is identical to 2026 number by number (FIPI: «Изменений нет»)', () => {
    for (const subjectId of ['math', 'russian']) {
      for (const n of numbers(subjectId, 'ege-2026')) {
        const a = examTaskSpec(subjectId, 'ege-2026', n)!;
        const b = examTaskSpec(subjectId, 'ege-2027', n)!;
        expect({
          part: b.part,
          title: b.title,
          keys: topicKeysForTask(subjectId, 'ege-2027', n),
        }).toEqual({
          part: a.part,
          title: a.title,
          keys: topicKeysForTask(subjectId, 'ege-2026', n),
        });
        expect(b.topics.every((x) => x.status === 'official')).toBe(true);
      }
    }
  });

  it('the project numbering differs and is never official', () => {
    // Shift +1 after the project's new №6; finance moved to part 1; №17 new.
    expect(topicKeysForTask('math', 'ege-2027-project', 7)).toEqual(
      topicKeysForTask('math', 'ege-2027', 6),
    );
    expect(topicKeysForTask('math', 'ege-2027-project', 20)).toEqual(
      topicKeysForTask('math', 'ege-2027', 19),
    );
    expect(topicKeysForTask('math', 'ege-2027-project', 13)).toEqual(['math.finance']);
    expect(topicKeysForTask('math', 'ege-2027', 16)).toEqual(['math.finance']);
    expect(topicKeysForTask('math', 'ege-2027', 6)).not.toEqual(
      topicKeysForTask('math', 'ege-2027-project', 6),
    );
    for (const spec of EXAM_TASK_SPECS.filter((s) => s.edition === 'ege-2027-project')) {
      for (const b of spec.topics) expect(b.status).not.toBe('official');
    }
    expect(EXAM_EDITIONS.find((e) => e.id === 'ege-2027-project')!.superseded).toBe(true);
  });

  it('the scoring rules of each format agree with the part split of its edition', () => {
    const editionOf: Record<string, ExamEditionId> = {
      'ege-math-profile-2026': 'ege-2026',
      // The 20-task rules score the Ященко-2027 book (the August project).
      'ege-math-profile-2027': 'ege-2027-project',
    };
    for (const rules of EXAM_SCORING_RULES) {
      const edition = editionOf[rules.format]!;
      expect(Object.keys(rules.tasks).map(Number)).toEqual(numbers(rules.subjectId, edition));
      for (const n of Object.keys(rules.tasks).map(Number)) {
        expect(examTaskSpec(rules.subjectId, edition, n)!.part).toBe(
          n <= rules.partOneLast ? 1 : 2,
        );
      }
    }
  });

  it('every binding names a known topic of the same subject; keys are unique', () => {
    const keys = new Set(EXAM_TOPICS.map((t) => t.key));
    expect(keys.size).toBe(EXAM_TOPICS.length);
    for (const spec of EXAM_TASK_SPECS) {
      expect(spec.topics.length).toBeGreaterThan(0);
      for (const b of spec.topics) {
        expect(EXAM_TOPICS.find((t) => t.key === b.topicKey)?.subjectId).toBe(spec.subjectId);
      }
    }
    for (const extra of CODIFIER_EXTRAS) expect(keys.has(extra.topicKey)).toBe(true);
  });

  it('a topic lists every edition where it is checked, current edition first', () => {
    expect(examNumbersForTopic('math.finance').map((x) => `${x.edition}:${x.number}`)).toEqual([
      'ege-2027:16',
      'ege-2026:16',
      'ege-2027-project:13',
    ]);
    // Random variables have a position only in the project.
    expect(examNumbersForTopic('math.random-variables').map((x) => x.edition)).toEqual([
      'ege-2027-project',
    ]);
  });

  it('a task finds its edition: old Ященко by its source, others by year', () => {
    expect(
      examEditionForTask({
        subjectId: 'math',
        sourceYear: 2027,
        source: YASHCHENKO_2027_PROJECT_SOURCE,
      }),
    ).toBe('ege-2027-project');
    expect(examEditionForTask({ subjectId: 'math', sourceYear: 2027, source: 'ФИПИ' })).toBe(
      'ege-2027',
    );
    expect(
      examEditionForTask({ subjectId: 'math', sourceYear: 2026, source: 'Ященко ЕГЭ 2026' }),
    ).toBe('ege-2026');
    expect(examEditionForTask({ subjectId: 'russian', sourceYear: 2027, source: 'x' })).toBe(
      'ege-2027',
    );
    // No year: the 19-task numbering, the same in 2026 and current 2027.
    expect(examEditionForTask({ subjectId: 'math', sourceYear: null })).toBe('ege-2027');
    expect(examEditionsFor('russian').map((e) => e.id)).toEqual(['ege-2027', 'ege-2026']);
  });
});
