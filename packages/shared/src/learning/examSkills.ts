import {
  EXAM_TOPICS,
  examEditionForTask,
  examNumbersForTopic,
  examTaskSpec,
  topicKeysForTask,
  type ExamEditionId,
} from '../examSpecs.js';

/**
 * Learning Engine skills (docs/learning/LEARNING-ENGINE-ARCHITECTURE.md).
 *
 * A skill is one topic of the EGE specification — `EXAM_TOPICS` in
 * `examSpecs.ts` (`math.planimetry`, `russian.15-n-nn`). The same key in
 * every year, variant and edition: a task is linked to it through its own
 * metadata only (subject, source, year, number), never through a list of
 * task ids. Ященко-2027 (old edition) №13 «Финансы» and ЕГЭ-2027 №16 are
 * the same skill `math.finance`.
 *
 * In the `skills` table these rows have `slug` = the topic key (always
 * `<subject>.<name>`, with a dot). The method skills of
 * `apps/api/src/modules/skills/sync.ts` (`substitution`, …) never contain a
 * dot, so the two kinds never collide.
 */

/** The edition whose numbering the student sees («№ ЕГЭ»). */
export const CURRENT_EXAM_EDITION: ExamEditionId = 'ege-2027';

export interface ExamTaskIdentity {
  readonly subjectId: string;
  readonly taskNumber: number;
  readonly source?: string | null;
  readonly sourceYear?: number | null;
}

export interface ExamSkillLink {
  /** Edition whose numbering the task itself uses. */
  readonly edition: ExamEditionId;
  /** Topic keys the task checks; empty = no known position (needs review). */
  readonly skillKeys: readonly string[];
}

/** The exam skills of one task, from its metadata alone. */
export function examSkillsForTask(task: ExamTaskIdentity): ExamSkillLink {
  const edition = examEditionForTask(task);
  return { edition, skillKeys: topicKeysForTask(task.subjectId, edition, task.taskNumber) };
}

export function isExamSkillSlug(slug: string): boolean {
  return EXAM_TOPICS.some((t) => t.key === slug);
}

export interface ExamSkillInfo {
  readonly key: string;
  readonly subjectId: string;
  readonly title: string;
  /** Number in the current edition, or null for a topic it has no position for
   * (e.g. «Случайные величины» — only in the old Ященко-2027 numbering). */
  readonly examNumber: number | null;
  /** 1 = short answer, 2 = extended answer, null when not in the current edition. */
  readonly part: 1 | 2 | null;
}

const infoByKey = new Map<string, ExamSkillInfo>(
  EXAM_TOPICS.map((topic) => {
    const placement = examNumbersForTopic(topic.key).find(
      (p) => p.edition === CURRENT_EXAM_EDITION && p.relation === 'same',
    );
    const spec = placement
      ? examTaskSpec(topic.subjectId, CURRENT_EXAM_EDITION, placement.number)
      : null;
    return [
      topic.key,
      {
        key: topic.key,
        subjectId: topic.subjectId,
        title: topic.title,
        examNumber: placement?.number ?? null,
        part: spec?.part ?? null,
      },
    ] as const;
  }),
);

export function examSkillInfo(key: string): ExamSkillInfo | null {
  return infoByKey.get(key) ?? null;
}

/** Every exam skill of a subject, in current exam order (positionless last). */
export function examSkillsForSubject(subjectId: string): ExamSkillInfo[] {
  return [...infoByKey.values()]
    .filter((s) => s.subjectId === subjectId)
    .sort((a, b) => (a.examNumber ?? 99) - (b.examNumber ?? 99) || a.key.localeCompare(b.key));
}

/** All exam skills, for seeding the `skills` table. */
export function allExamSkills(): ExamSkillInfo[] {
  return [...infoByKey.values()];
}
