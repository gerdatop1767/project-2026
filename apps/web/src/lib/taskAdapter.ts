import type { TaskPublic, TaskWithSolution } from '@zybrilka/shared';
import type { SampleTask, SessionTask } from '../data/sampleTask.js';
import { subjects } from '../data/subjects.js';
import type { TaskNavigationEntry } from './useTaskNavigation.js';

const DIFFICULTY_LABELS = ['Лёгкое', 'Среднее', 'Сложное'] as const;

function difficultyLabel(difficulty: number): SampleTask['difficultyLabel'] {
  return DIFFICULTY_LABELS[difficulty - 1] ?? 'Среднее';
}

function shortCode(id: string): string {
  return `#${id.slice(0, 8)}`;
}

/**
 * Maps a real API task (+ its siblings sharing the same task number,
 * for the "Другие задания"/"Похожие задания" comparison list ONLY)
 * onto the `SampleTask` shape the approved-design components already
 * render. `hint`/`steps` come straight from the task's own `hintMd`/
 * `solutionSteps` — an empty hint hides the hint UI entirely (see
 * TaskDesktop/TaskMobile) rather than falling back to a generic one,
 * and a task with no `solutionSteps` falls back to one block holding
 * the whole `explanationMd`.
 *
 * `totalInSession`/`indexInSession`/`sessionTasks` are set to a safe
 * single-item default here (this task alone) — NOT derived from
 * `siblings`. `siblings` is every published task across every
 * source/variant that happens to share this exact `taskNumber` (the
 * `listTasksByNumber` endpoint), which answers "which other sources
 * have a task numbered N", never "what training session/list am I in
 * right now". Callers that have a real ordered list (from
 * `useTaskNavigation`'s `orderedTasks` — the same list that already
 * correctly drives the top TaskNumberStrip/prev/next) must call
 * `buildSessionProgress()` below and use ITS result for the progress
 * header, desktop sidebar and "Прогресс в теме" ring instead of these
 * fields. See docs/imports/ or the nav bugfix report for the full
 * story: before Вариант 2-5 existed this was invisible (usually one
 * row), and became a visibly wrong fake "Задание K из 5" the moment a
 * real fifth variant existed.
 */
export function toSampleTask(
  task: TaskPublic | TaskWithSolution,
  siblings: readonly TaskPublic[],
): SampleTask {
  const subject = subjects.find((s) => s.id === task.subjectId);
  const hasSolution = 'correctAnswer' in task;
  const others = siblings.filter((t) => t.id !== task.id);

  return {
    id: task.id,
    subjectId: task.subjectId,
    subjectName: subject?.name ?? task.subjectId,
    topic: task.topicName ?? 'Общее',
    number: task.taskNumber,
    totalInSession: 1,
    indexInSession: 1,
    difficulty: task.difficulty as 1 | 2 | 3,
    difficultyLabel: difficultyLabel(task.difficulty),
    source: task.source,
    code: shortCode(task.id),
    condition: task.conditionMd,
    imageUrl: task.imageUrl,
    answerType: task.answerType,
    answerParts: task.answerParts,
    correctAnswer: hasSolution ? task.correctAnswer : '',
    correctAnswerDisplay: hasSolution ? task.correctAnswerDisplay : null,
    explanation: hasSolution ? task.explanationMd : '',
    hint: task.hintMd ?? '',
    steps: hasSolution
      ? (task.solutionSteps?.map((s) => ({ title: s.title, text: s.explanation })) ?? [
          { text: task.explanationMd },
        ])
      : [],
    canonicalSolution: hasSolution ? task.canonicalSolution : undefined,
    otherVariants: others.slice(0, 3).map((t) => ({
      id: t.id,
      code: shortCode(t.id),
      difficultyLabel: difficultyLabel(t.difficulty),
      preview: t.conditionMd.slice(0, 60),
    })),
    sessionTasks: [{ index: 1, status: 'current' }],
  };
}

export interface SessionProgress {
  indexInSession: number;
  totalInSession: number;
  sessionTasks: readonly SessionTask[];
}

/**
 * The REAL "position in the current list" — for the progress header
 * ("Задание X из Y" + its bar), the desktop sidebar list, and the
 * "Прогресс в теме" ring. Driven by the exact same ordered list
 * `useTaskNavigation`'s `orderedTasks` already resolves (customOrderedTasks
 * a user/mode assembled, or the real variant/collection order) — the
 * same list the top TaskNumberStrip and prev/next already use — never
 * by `listTasksByNumber`'s cross-source same-number `siblings` (see
 * `toSampleTask`'s doc comment for why that one's wrong here). `taskId`
 * identifies the current task within the list; falls back to a
 * single-item "1 of 1" when there is no real list (e.g. reached via
 * Темы/Мои ошибки/Избранное with no session context) — never invents a
 * range that doesn't exist.
 */
export function buildSessionProgress(
  currentTaskId: string,
  orderedTasks: readonly TaskNavigationEntry[],
): SessionProgress {
  const list = orderedTasks.length > 0 ? orderedTasks : [{ taskId: currentTaskId, taskNumber: 0 }];
  const indexInSession = Math.max(list.findIndex((t) => t.taskId === currentTaskId) + 1, 1);
  return {
    indexInSession,
    totalInSession: list.length,
    sessionTasks: list.map((t, i) => ({
      index: i + 1,
      status: t.taskId === currentTaskId ? 'current' : 'pending',
    })),
  };
}

export interface ExplanationSection {
  heading: string;
  text: string;
}

/**
 * Splits a multi_part task's explanationMd into per-part sections at its
 * `### <heading>` markers (see importEge2026Variant1.ts's task 19 for the
 * convention). Falls back to one unheaded section when there are none, so
 * this is safe to call on any explanation, not just multi_part ones.
 */
export function splitMultiPartExplanation(explanationMd: string): readonly ExplanationSection[] {
  const chunks = explanationMd.split(/\n(?=###\s+)/);
  return chunks
    .map((chunk) => {
      // Greedy `.+` (not `.` spans newlines) consumes the whole heading
      // line up to but not past it — a lazy quantifier here would stop
      // after a single character whenever the trailing `\n?` is free to
      // match zero characters instead, truncating multi-word headings.
      const match = /^###\s+(.+)\n?/.exec(chunk);
      if (!match) return { heading: '', text: chunk.trim() };
      return { heading: match[1]!.trim(), text: chunk.slice(match[0].length).trim() };
    })
    .filter((section) => section.heading.length > 0 || section.text.length > 0);
}

/** Finds the explanation section for a given part label ("а", "б", ...) by
 * case-insensitive substring match against its heading (task 19's "Б и В"
 * heading covers both the б and в parts) — falls back to the whole
 * explanation when no section names this part specifically. */
export function explanationForPart(
  sections: readonly ExplanationSection[],
  partLabel: string,
): string {
  const match = sections.find((s) => s.heading.toLowerCase().includes(partLabel.toLowerCase()));
  return match ? match.text : sections.map((s) => s.text).join('\n\n');
}
