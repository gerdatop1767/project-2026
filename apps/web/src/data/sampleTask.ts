/**
 * Sample EGE task content (S1 Block 6 — approved design, Training/
 * Result screenshots). Subject-agnostic shape, seeded with one
 * profile-math logarithm item matching the approved reference
 * (условие, ответ, шаги решения, вариант задания №15, code #3214).
 * Demo/seed content for the UI only — not the real task database.
 */
import type { CanonicalSolutionDto } from '@zybrilka/shared';

export interface SolutionStep {
  /** Task-specific step name ("ОДЗ", "Считываем данные с графика", ...) — absent for the single-block fallback. */
  title?: string;
  text: string;
}

export interface TaskVariant {
  id: string;
  code: string;
  difficultyLabel: 'Лёгкое' | 'Среднее' | 'Сложное';
  preview: string;
}

export type SessionTaskStatus = 'correct' | 'incorrect' | 'current' | 'pending';

export interface SessionTask {
  index: number;
  status: SessionTaskStatus;
}

export interface SampleTaskAnswerPart {
  id: string;
  label: string;
}

export interface SampleTask {
  id: string;
  subjectId: string;
  subjectName: string;
  topic: string;
  /** The official EGE question number (mobile's 11-19 number strip). */
  number: number;
  totalInSession: number;
  /** Position of this task within the current training session (desktop sidebar / "Задание N из M"). */
  indexInSession: number;
  difficulty: 1 | 2 | 3;
  difficultyLabel: 'Лёгкое' | 'Среднее' | 'Сложное';
  source: string;
  code: string;
  condition: string;
  /** A graph/figure required to solve the task (e.g. derivative or parabola graphs). */
  imageUrl: string | null;
  /** 'short_answer' unless the backend says otherwise — most tasks need no UI branch at all. */
  answerType: 'short_answer' | 'multiple_choice' | 'interval' | 'multi_part' | 'essay';
  /** Non-null only for multi_part tasks — one input per part, no answers included. */
  answerParts: readonly SampleTaskAnswerPart[] | null;
  /** Numeric/short-text answer tasks (most of EGE profile-math Part 1). For
   * multi_part this is a JSON-encoded MultiPartSpec (see @zybrilka/shared),
   * not a display string — never render it directly. */
  correctAnswer: string;
  /** Presentation-only LaTeX form of `correctAnswer` — render this
   * (via MathText) when present, falling back to `correctAnswer`
   * otherwise. Never used for grading. */
  correctAnswerDisplay: string | null;
  explanation: string;
  hint: string;
  steps: readonly SolutionStep[];
  /**
   * A structured, exam-annotated reference solution (Canonical
   * Solution System) — a separate, additional source of solution
   * content from `explanation`/`steps` above, which keep working
   * unchanged for every task. Present only for the small set of tasks
   * that have one (today: exactly one real math task №13). No screen
   * renders this yet — this is data plumbing only, ahead of the UI
   * work that will actually display it.
   */
  canonicalSolution?: CanonicalSolutionDto;
  otherVariants: readonly TaskVariant[];
  sessionTasks: readonly SessionTask[];
}

/**
 * Placeholder lookup. Subject/task-agnostic on purpose: every screen
 * asks for a task by id rather than importing `sampleTask` directly,
 * so swapping this for a real API call later touches only this file.
 */
export function getTaskById(_id: string): SampleTask {
  return sampleTask;
}

export const sampleTask: SampleTask = {
  id: 'demo-3214',
  subjectId: 'math',
  subjectName: 'Математика',
  topic: 'Логарифмы',
  number: 15,
  totalInSession: 12,
  indexInSession: 3,
  difficulty: 3,
  difficultyLabel: 'Сложное',
  source: 'ФИПИ',
  code: '#3214',
  condition: 'Решите неравенство: log₂(x² − 3x − 4) ≥ 1',
  imageUrl: null,
  answerType: 'short_answer',
  answerParts: null,
  correctAnswer: '(−∞; −1] ∪ [2; +∞)',
  correctAnswerDisplay: null,
  explanation:
    'log₂(x² − 3x − 4) ≥ 1 равносильно системе: x² − 3x − 4 ≥ 2 и x² − 3x − 4 > 0. Решая первое неравенство, получаем x² − 3x − 6 ≥ 0, откуда x ∈ (−∞; −1] ∪ [2; +∞) — это же множество удовлетворяет и области определения логарифма.',
  hint: 'Подставляй значение переменной по шагам, не сокращая вычисление сразу. Не забудь про область определения логарифма.',
  steps: [
    { text: 'Область определения: x² − 3x − 4 > 0, откуда x ∈ (−∞; −1) ∪ (4; +∞).' },
    { text: 'Так как основание 2 > 1, неравенство равносильно x² − 3x − 4 ≥ 2¹ = 2.' },
    { text: 'Решаем x² − 3x − 6 ≥ 0 — получаем x ∈ (−∞; −1] ∪ [2; +∞).' },
    { text: 'Пересекаем с областью определения: ответ (−∞; −1] ∪ [2; +∞).' },
  ],
  otherVariants: [
    { id: 'demo-3215', code: '#3215', difficultyLabel: 'Среднее', preview: 'log₅(x − 1) ≤ 2' },
    {
      id: 'demo-3216',
      code: '#3216',
      difficultyLabel: 'Сложное',
      preview: 'log₃(x + 2) + log₃x ≥ 1',
    },
    { id: 'demo-3217', code: '#3217', difficultyLabel: 'Лёгкое', preview: 'log₂(x − 4) ≥ 0' },
  ],
  sessionTasks: [
    { index: 1, status: 'correct' },
    { index: 2, status: 'correct' },
    { index: 3, status: 'correct' },
    { index: 4, status: 'correct' },
    { index: 5, status: 'correct' },
    { index: 6, status: 'current' },
    { index: 7, status: 'pending' },
    { index: 8, status: 'pending' },
    { index: 9, status: 'pending' },
    { index: 10, status: 'pending' },
  ],
};
