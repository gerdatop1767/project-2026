import { schema, type Database } from '@zybrilka/db';
import {
  problemSkills,
  smartSetupSkills,
  smartTrainingPlan,
  type SmartSetupResponse,
  type SmartTrainingOptions,
  type TrainingPickInfo,
  type TrainingPlan,
} from '@zybrilka/shared';
import { and, countDistinct, eq, inArray, ne, notExists, sql } from 'drizzle-orm';
import { buildStudentModel } from './model.js';
import { pickForSlot } from './training.js';

/**
 * Distinct tasks a training over these skills can serve (published,
 * auto-checked; with `unseenOnly`, never attempted by this student).
 */
export async function availableTasksFor(
  db: Database,
  userId: string,
  skillKeys: readonly string[],
  unseenOnly = false,
): Promise<number> {
  if (skillKeys.length === 0) return 0;
  const [row] = await db
    .select({ n: countDistinct(schema.tasks.id) })
    .from(schema.tasks)
    .innerJoin(schema.taskSkills, eq(schema.taskSkills.taskId, schema.tasks.id))
    .innerJoin(schema.skills, eq(schema.skills.id, schema.taskSkills.skillId))
    .where(
      and(
        inArray(schema.skills.slug, [...skillKeys]),
        eq(schema.tasks.status, 'published'),
        ne(schema.tasks.answerType, 'essay'),
        unseenOnly
          ? notExists(
              db
                .select({ one: sql`1` })
                .from(schema.attempts)
                .where(
                  and(
                    eq(schema.attempts.userId, userId),
                    eq(schema.attempts.taskId, schema.tasks.id),
                  ),
                ),
            )
          : undefined,
      ),
    );
  return Number(row?.n ?? 0);
}

export async function getSmartSetup(
  db: Database,
  userId: string,
  subjectId: string,
): Promise<SmartSetupResponse | null> {
  const model = await buildStudentModel(db, userId, new Date(), { allSubjects: true });
  const subject = model.subjects.find((s) => s.subjectId === subjectId);
  if (!subject) return null;
  const skills = smartSetupSkills(subject);
  return {
    subjectId,
    skills,
    problemKeys: problemSkills(subject).map((s) => s.key),
    subjectTasks: await availableTasksFor(
      db,
      userId,
      skills.map((s) => s.key),
    ),
  };
}

export type SmartStart =
  | {
      readonly ok: true;
      readonly plan: TrainingPlan;
      readonly taskId: string;
      readonly pick: TrainingPickInfo;
    }
  | {
      readonly ok: false;
      readonly error: 'no_topics' | 'no_problem_topics' | 'unknown_topic' | 'subject_not_found';
    }
  | { readonly ok: false; readonly error: 'not_enough_tasks'; readonly available: number };

/**
 * Starts a configured training: the plan from `smartTrainingPlan`, a check
 * that the chosen topics have enough tasks for the chosen number, and the
 * first task. Later tasks come from `pickForSlot` over the same plan, whose
 * slots name only the plan's skills — nothing outside the chosen topics.
 */
export async function startSmartTraining(
  db: Database,
  userId: string,
  input: {
    subjectId: string;
    total: number;
    smart: SmartTrainingOptions;
    unseenOnly?: boolean;
  },
): Promise<SmartStart> {
  const model = await buildStudentModel(db, userId, new Date(), { allSubjects: true });
  const subject = model.subjects.find((s) => s.subjectId === input.subjectId);
  if (!subject) return { ok: false, error: 'subject_not_found' };
  const result = smartTrainingPlan(subject, input.total, input.smart);
  if (!result.ok) return { ok: false, error: result.reason };
  // Every topic the training may use (the plan's), for «Весь предмет» the whole subject.
  const scope =
    input.smart.mode === 'topics' || input.smart.mode === 'problems'
      ? result.skillKeys
      : subject.skills.map((s) => s.key);
  const available = await availableTasksFor(db, userId, scope, input.unseenOnly);
  if (available < input.total) return { ok: false, error: 'not_enough_tasks', available };
  const first = await pickForSlot(db, userId, {
    subjectId: input.subjectId,
    plan: result.plan,
    index: 0,
    consumed: [],
    unseenOnly: input.unseenOnly,
  });
  if (!first) return { ok: false, error: 'not_enough_tasks', available: 0 };
  return { ok: true, plan: result.plan, taskId: first.taskId, pick: first.pick };
}
