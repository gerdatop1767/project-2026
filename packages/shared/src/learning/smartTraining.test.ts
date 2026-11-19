import { describe, expect, it } from 'vitest';
import { examSkillsForSubject } from './examSkills.js';
import type { SkillState, SubjectState } from './engine.js';
import {
  problemInfo,
  problemSkills,
  smartSetupSkills,
  smartTrainingPlan,
} from './smartTraining.js';

const MATH = examSkillsForSubject('math').filter((s) => s.examNumber !== null);

function skill(key: string, over: Partial<SkillState> = {}): SkillState {
  const info = MATH.find((s) => s.key === key)!;
  return {
    key,
    subjectId: 'math',
    title: info.title,
    examNumber: info.examNumber,
    part: info.part,
    mastery: 0,
    confidence: 0,
    level: 'none',
    attempts: 0,
    correct: 0,
    incorrect: 0,
    lastAttemptAt: null,
    daysSince: null,
    trend: null,
    repeatedErrorTasks: 0,
    recoveredTasks: 0,
    recent: { attempts: 0, wrong: 0 },
    openMistakes: 0,
    stuckAfterExplanation: 0,
    myAverageRating: null,
    hardButCorrect: 0,
    availableTasks: 30,
    ...over,
  };
}

const weak = (key: string, over: Partial<SkillState> = {}) =>
  skill(key, {
    level: 'weak',
    mastery: 30,
    attempts: 10,
    correct: 3,
    incorrect: 7,
    recent: { attempts: 7, wrong: 5 },
    openMistakes: 3,
    daysSince: 1,
    ...over,
  });
const strong = (key: string, over: Partial<SkillState> = {}) =>
  skill(key, {
    level: 'strong',
    mastery: 90,
    attempts: 12,
    correct: 11,
    incorrect: 1,
    recent: { attempts: 7, wrong: 0 },
    daysSince: 2,
    ...over,
  });

function subject(skills: SkillState[]): SubjectState {
  return {
    subjectId: 'math',
    selected: true,
    targetScore: 'unknown',
    skills,
    totals: { attempts: 0, correct: 0, solvedTasks: 0, accuracy: null },
  };
}

const keys = MATH.map((s) => s.key);
const s = subject([
  weak(keys[0]!),
  weak(keys[1]!, { mastery: 45, openMistakes: 0, repeatedErrorTasks: 2 }),
  strong(keys[2]!),
  strong(keys[3]!, { daysSince: 20 }),
  ...keys.slice(4).map((k) => skill(k)),
]);

describe('«Проблемные темы»', () => {
  it('only topics with real problems, biggest first, with reasons; no data → no verdict', () => {
    const problems = problemSkills(s).map((x) => x.key);
    expect(problems).toEqual([keys[0], keys[1]]);
    const info = problemInfo(s.skills[0]!)!;
    expect(info.reasons).toEqual(
      expect.arrayContaining(['точность 30%', 'не исправлено ошибок: 3']),
    );
    expect(problemInfo(skill(keys[5]!))).toBeNull();
    expect(problemInfo(strong(keys[2]!))).toBeNull();
    // Two answers, both wrong, no open mistake: too little to judge.
    expect(problemInfo(skill(keys[6]!, { attempts: 2, incorrect: 2 }))).toBeNull();
  });
});

describe('every mode is its own plan', () => {
  const skillsOf = (r: ReturnType<typeof smartTrainingPlan>) =>
    r.ok ? r.plan.slots.map((x) => x.skillKey) : [];

  it('«Конкретные темы»: every slot is one of the chosen topics, untouched ones included', () => {
    const chosen = [keys[2]!, keys[7]!];
    const r = smartTrainingPlan(s, 12, { mode: 'topics', skillKeys: chosen });
    expect(r.ok).toBe(true);
    expect(skillsOf(r)).toHaveLength(12);
    expect(new Set(skillsOf(r))).toEqual(new Set(chosen));
  });

  it('«Проблемные темы»: only problem topics, weak and mistake buckets', () => {
    const r = smartTrainingPlan(s, 10, { mode: 'problems' });
    expect(r.ok && r.skillKeys).toEqual([keys[0], keys[1]]);
    expect(new Set(skillsOf(r))).toEqual(new Set([keys[0], keys[1]]));
    expect(r.ok && r.plan.counts.stale + r.plan.counts.strong).toBe(0);
    const none = smartTrainingPlan(subject(keys.map((k) => skill(k))), 10, { mode: 'problems' });
    expect(none).toEqual({ ok: false, reason: 'no_problem_topics' });
  });

  it('«Весь предмет»: a different topic per slot before any repeats, not driven by weak spots', () => {
    const r = smartTrainingPlan(s, 8, { mode: 'subject' });
    expect(new Set(skillsOf(r)).size).toBe(8);
    const many = smartTrainingPlan(s, keys.length + 3, { mode: 'subject' });
    expect(new Set(skillsOf(many)).size).toBe(keys.length);
  });

  it('«По статистике» leans on weak topics and mistakes; «Смешанная» adds review and strong', () => {
    const stats = smartTrainingPlan(s, 20, { mode: 'stats' });
    const mixed = smartTrainingPlan(s, 20, { mode: 'mixed' });
    expect(stats.ok && mixed.ok).toBe(true);
    if (!stats.ok || !mixed.ok) return;
    expect(stats.plan.counts.strong).toBe(0);
    expect(mixed.plan.counts.strong).toBeGreaterThan(0);
    expect(stats.plan.counts.weak + stats.plan.counts.mistakes).toBeGreaterThan(
      mixed.plan.counts.weak + mixed.plan.counts.mistakes,
    );
    expect(skillsOf(stats)).not.toEqual(skillsOf(mixed));
  });

  it('difficulty goes into the plan; «Смешанные» leaves it to the student’s level', () => {
    const easy = smartTrainingPlan(s, 5, { mode: 'stats', difficulty: 'easy' });
    const hard = smartTrainingPlan(s, 5, { mode: 'stats', difficulty: 'hard' });
    const mixed = smartTrainingPlan(s, 5, { mode: 'stats', difficulty: 'mixed' });
    expect(easy.ok && easy.plan.difficulty).toBe(1);
    expect(hard.ok && hard.plan.difficulty).toBe(3);
    expect(mixed.ok && mixed.plan.difficulty).toBeUndefined();
  });

  it('topics of another subject or none: refused', () => {
    expect(smartTrainingPlan(s, 5, { mode: 'topics', skillKeys: [] })).toEqual({
      ok: false,
      reason: 'no_topics',
    });
    expect(smartTrainingPlan(s, 5, { mode: 'topics', skillKeys: ['russian.15-n-nn'] })).toEqual({
      ok: false,
      reason: 'unknown_topic',
    });
  });

  it('the set-up list: every trainable topic, mastery only with answers', () => {
    const list = smartSetupSkills(s);
    expect(list.length).toBe(keys.length);
    expect(list.find((x) => x.key === keys[5])!.mastery).toBeNull();
    expect(list.find((x) => x.key === keys[0])!.problem).not.toBeNull();
  });
});
