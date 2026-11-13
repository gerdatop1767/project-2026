import { describe, expect, it } from 'vitest';
import {
  EXAM_TASK_SPECS,
  EXAM_TOPICS,
  examNumbersForTopic,
  examTaskSpec,
  examYears,
  topicKeysForTask,
} from './examSpecs.js';
import { EXAM_SCORING_RULES } from './examScoring.js';

const numbers = (subjectId: string, year: number) =>
  EXAM_TASK_SPECS.filter((s) => s.subjectId === subjectId && s.year === year).map((s) => s.number);

describe('exam specifications 2026 / 2027', () => {
  it('math: 19 numbers in 2026, 20 in 2027; Russian: 27 in both — each exactly once', () => {
    expect(numbers('math', 2026)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
    expect(numbers('math', 2027)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    for (const year of [2026, 2027]) {
      expect(numbers('russian', year)).toEqual(Array.from({ length: 27 }, (_, i) => i + 1));
    }
    expect(examYears('math')).toEqual([2026, 2027]);
  });

  it('the part split matches the scoring rules of each year', () => {
    for (const rules of EXAM_SCORING_RULES) {
      for (const n of Object.keys(rules.tasks).map(Number)) {
        const spec = examTaskSpec(rules.subjectId, rules.examYear, n)!;
        expect(spec, `${rules.examYear} №${n}`).not.toBeNull();
        expect(spec.part).toBe(n <= rules.partOneLast ? 1 : 2);
      }
    }
  });

  it('every binding names a known topic of the same subject, keys are unique', () => {
    const keys = new Set(EXAM_TOPICS.map((t) => t.key));
    expect(keys.size).toBe(EXAM_TOPICS.length);
    for (const spec of EXAM_TASK_SPECS) {
      expect(spec.topics.length).toBeGreaterThan(0);
      for (const b of spec.topics) {
        const topic = EXAM_TOPICS.find((t) => t.key === b.topicKey);
        expect(topic, b.topicKey).toBeDefined();
        expect(topic!.subjectId).toBe(spec.subjectId);
      }
    }
  });

  it('known 2026 → 2027 moves are bound to the same topic, never by guessing the number', () => {
    // Shift +1 after the new №6.
    expect(topicKeysForTask('math', 2026, 6)).toEqual(topicKeysForTask('math', 2027, 7));
    expect(topicKeysForTask('math', 2026, 11)).toEqual(topicKeysForTask('math', 2027, 12));
    expect(topicKeysForTask('math', 2026, 13)).toEqual(topicKeysForTask('math', 2027, 14));
    expect(topicKeysForTask('math', 2026, 19)).toEqual(topicKeysForTask('math', 2027, 20));
    // Finance moved from part 2 (№16) to part 1 (№13).
    expect(examNumbersForTopic('math.finance').map((x) => `${x.year}:${x.number}`)).toEqual([
      '2027:13',
      '2026:16',
    ]);
    // New in 2027, no 2026 counterpart.
    expect(examNumbersForTopic('math.random-variables').map((x) => x.year)).toEqual([2027]);
    expect(examNumbersForTopic('math.modelling').map((x) => x.year)).toEqual([2027]);
    // Same number does not mean same topic.
    expect(topicKeysForTask('math', 2026, 6)).not.toEqual(topicKeysForTask('math', 2027, 6));
  });

  it('2027 bindings are marked as not yet checked against the FIPI PDF', () => {
    for (const spec of EXAM_TASK_SPECS.filter((s) => s.year === 2027)) {
      for (const b of spec.topics) expect(b.status).toBe('secondary');
    }
  });

  it('Russian numbering is the same in both years', () => {
    for (let n = 1; n <= 27; n++) {
      expect(topicKeysForTask('russian', 2027, n)).toEqual(topicKeysForTask('russian', 2026, n));
    }
  });
});
