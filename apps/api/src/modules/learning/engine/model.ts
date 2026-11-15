import type { Database } from '@zybrilka/db';
import { schema } from '@zybrilka/db';
import {
  allExamSkills,
  calculateSkillMastery,
  examSkillsForSubject,
  skillLevel,
  type SkillAttemptRecord,
  type SkillState,
  type StudentModel,
  type SubjectState,
  type TargetScore,
} from '@zybrilka/shared';
import { and, count, eq, inArray, ne } from 'drizzle-orm';
import * as learningProfileRepo from '../../learningProfile/repo.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EXAM_SUBJECTS = ['math', 'russian'] as const;
const examKeys = allExamSkills().map((s) => s.key);

interface SkillAttemptRow extends SkillAttemptRecord {
  readonly slug: string;
  readonly taskId: string;
}

/** Every attempt of the student, tagged with its exam skill(s). */
async function attemptsBySkill(db: Database, userId: string): Promise<SkillAttemptRow[]> {
  return db
    .select({
      slug: schema.skills.slug,
      taskId: schema.attempts.taskId,
      isCorrect: schema.attempts.isCorrect,
      createdAt: schema.attempts.createdAt,
      difficulty: schema.tasks.difficulty,
    })
    .from(schema.attempts)
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.attempts.taskId))
    .innerJoin(schema.taskSkills, eq(schema.taskSkills.taskId, schema.attempts.taskId))
    .innerJoin(schema.skills, eq(schema.skills.id, schema.taskSkills.skillId))
    .where(and(eq(schema.attempts.userId, userId), inArray(schema.skills.slug, examKeys)));
}

/** Published, auto-checked tasks per exam skill — what training can serve. */
export async function availableTasksBySkill(db: Database): Promise<Map<string, number>> {
  const rows = await db
    .select({ slug: schema.skills.slug, n: count() })
    .from(schema.taskSkills)
    .innerJoin(schema.skills, eq(schema.skills.id, schema.taskSkills.skillId))
    .innerJoin(schema.tasks, eq(schema.tasks.id, schema.taskSkills.taskId))
    .where(
      and(
        inArray(schema.skills.slug, examKeys),
        eq(schema.tasks.status, 'published'),
        ne(schema.tasks.answerType, 'essay'),
      ),
    )
    .groupBy(schema.skills.slug);
  return new Map(rows.map((r) => [r.slug, r.n]));
}

async function openMistakesBySkill(db: Database, userId: string) {
  return db
    .select({
      slug: schema.skills.slug,
      taskId: schema.mistakes.taskId,
      timesWrong: schema.mistakes.timesWrong,
      explanationOpened: schema.mistakes.explanationOpened,
    })
    .from(schema.mistakes)
    .innerJoin(schema.taskSkills, eq(schema.taskSkills.taskId, schema.mistakes.taskId))
    .innerJoin(schema.skills, eq(schema.skills.id, schema.taskSkills.skillId))
    .where(
      and(
        eq(schema.mistakes.userId, userId),
        eq(schema.mistakes.status, 'open'),
        inArray(schema.skills.slug, examKeys),
      ),
    );
}

async function ratingsBySkill(db: Database, userId: string) {
  return db
    .select({
      slug: schema.skills.slug,
      taskId: schema.taskDifficultyRatings.taskId,
      rating: schema.taskDifficultyRatings.rating,
    })
    .from(schema.taskDifficultyRatings)
    .innerJoin(schema.taskSkills, eq(schema.taskSkills.taskId, schema.taskDifficultyRatings.taskId))
    .innerJoin(schema.skills, eq(schema.skills.id, schema.taskSkills.skillId))
    .where(
      and(eq(schema.taskDifficultyRatings.userId, userId), inArray(schema.skills.slug, examKeys)),
    );
}

function group<T extends { slug: string }>(rows: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) out.set(r.slug, [...(out.get(r.slug) ?? []), r]);
  return out;
}

/**
 * The student model (docs/learning/LEARNING-ENGINE-ARCHITECTURE.md): selected
 * subjects and targets, and per EGE skill the mastery (same
 * `calculateSkillMastery` as the stored statistics), recent results,
 * repeated errors, open mistakes, days since practice and the student's own
 * difficulty ratings. Statistics, recommendations and smart training all
 * read this one model.
 *
 * Subjects: the ones chosen in the profile; with no profile yet, every exam
 * subject (so a new student still gets a starting point). `allSubjects`
 * (analytics of a subject the student did not choose) includes every exam
 * subject; `selected` still tells which ones were chosen.
 */
export async function buildStudentModel(
  db: Database,
  userId: string,
  now: Date = new Date(),
  options: { allSubjects?: boolean } = {},
): Promise<StudentModel> {
  const [profiles, attempts, mistakes, ratings, available] = await Promise.all([
    learningProfileRepo.getSubjectProfiles(db, userId),
    attemptsBySkill(db, userId),
    openMistakesBySkill(db, userId),
    ratingsBySkill(db, userId),
    availableTasksBySkill(db),
  ]);
  const attemptsOf = group(attempts);
  const mistakesOf = group(mistakes);
  const ratingsOf = group(ratings);
  const profileBySubject = new Map(profiles.map((p) => [p.subjectId, p]));
  const hasProfile = profiles.length > 0;

  const subjectIds = EXAM_SUBJECTS.filter(
    (id) => options.allSubjects || !hasProfile || profileBySubject.has(id),
  );
  const subjects: SubjectState[] = subjectIds.map((subjectId) => {
    const skills: SkillState[] = examSkillsForSubject(subjectId).map((info) => {
      const rows = attemptsOf.get(info.key) ?? [];
      const m = calculateSkillMastery(rows);
      const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const recent = sorted.slice(-7);
      const correctTasks = new Set(rows.filter((r) => r.isCorrect).map((r) => r.taskId));
      const myRatings = ratingsOf.get(info.key) ?? [];
      const open = mistakesOf.get(info.key) ?? [];
      return {
        key: info.key,
        subjectId,
        title: info.title,
        examNumber: info.examNumber,
        part: info.part,
        mastery: m.mastery,
        confidence: m.confidence,
        level: skillLevel(m),
        attempts: m.attempts,
        correct: m.correctAttempts,
        incorrect: m.incorrectAttempts,
        lastAttemptAt: m.lastAttemptAt ? m.lastAttemptAt.toISOString() : null,
        daysSince: m.lastAttemptAt
          ? Math.floor((now.getTime() - m.lastAttemptAt.getTime()) / MS_PER_DAY)
          : null,
        trend: m.trend,
        repeatedErrorTasks: m.repeatedErrorTasks,
        recoveredTasks: m.recoveredTasks,
        recent: { attempts: recent.length, wrong: recent.filter((r) => !r.isCorrect).length },
        openMistakes: open.length,
        stuckAfterExplanation: open.filter((o) => o.explanationOpened && o.timesWrong >= 2).length,
        myAverageRating: myRatings.length
          ? Math.round((myRatings.reduce((s, r) => s + r.rating, 0) / myRatings.length) * 10) / 10
          : null,
        hardButCorrect: myRatings.filter((r) => r.rating >= 8 && correctTasks.has(r.taskId)).length,
        availableTasks: available.get(info.key) ?? 0,
      };
    });

    // Subject totals from the attempts themselves (a task with two skills
    // must not count twice).
    const subjectAttempts = new Map<string, { isCorrect: boolean; taskId: string; t: number }>();
    for (const r of attempts) {
      if (!r.slug.startsWith(`${subjectId}.`)) continue;
      subjectAttempts.set(`${r.taskId}|${r.createdAt.getTime()}`, {
        isCorrect: r.isCorrect,
        taskId: r.taskId,
        t: r.createdAt.getTime(),
      });
    }
    const list = [...subjectAttempts.values()];
    const correct = list.filter((a) => a.isCorrect).length;
    const profile = profileBySubject.get(subjectId);
    return {
      subjectId,
      selected: Boolean(profile),
      targetScore: (profile?.targetScore ?? 'unknown') as TargetScore,
      skills,
      totals: {
        attempts: list.length,
        correct,
        solvedTasks: new Set(list.filter((a) => a.isCorrect).map((a) => a.taskId)).size,
        accuracy: list.length ? Math.round((correct / list.length) * 100) : null,
      },
    };
  });

  return { subjects, hasProfile };
}

/** Skills practiced in the last 20 hours with 3+ attempts and no error. */
export async function recentlyPracticedClean(
  db: Database,
  userId: string,
  now: Date = new Date(),
): Promise<Set<string>> {
  const since = now.getTime() - 20 * 60 * 60 * 1000;
  const rows = (await attemptsBySkill(db, userId)).filter((r) => r.createdAt.getTime() >= since);
  const out = new Set<string>();
  for (const [slug, list] of group(rows)) {
    if (list.length >= 3 && list.every((r) => r.isCorrect)) out.add(slug);
  }
  return out;
}
