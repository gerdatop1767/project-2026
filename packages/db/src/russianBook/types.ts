/**
 * Data format for a printed Russian-language EGE variant book (one
 * generated module per variant), read by `russianBook/importBook.ts`.
 * Used by «36 вариантов» под ред. Р. А. Дощинского (2026 and 2027).
 */
export interface RussianBookPassage {
  title: string;
  bodyMd: string;
  sourceAuthor: string | null;
  sourceNote: string | null;
}

export interface RussianBookMultiPartCell {
  id: string;
  label: string;
  correctAnswer: string;
}

export interface RussianBookTask {
  taskNumber: number;
  topicSlug: string;
  topicName: string;
  /** 'A' — text for tasks 1–3, 'B' — text for tasks 23–27, null — own text. */
  passage: 'A' | 'B' | null;
  sourcePage: number;
  conditionMd: string;
  /** Plain-text statement (markdown removed), used for the content hash. */
  rawStatement: string;
  /** 'essay' — task 27: no correct answer, never graded automatically. */
  answerType: 'short_answer' | 'multi_part' | 'essay';
  /** Empty for an essay. */
  correctAnswer: string;
  /** Other answers the official key accepts («<или>»). */
  acceptedAnswers: readonly string[];
  digitSetOrderInsensitive: boolean;
  correctAnswerDisplay: string | null;
  /** Only for multi_part (tasks 8 and 22): the А–Д cells. */
  multiPart?: readonly RussianBookMultiPartCell[];
  explanationMd: string;
  hintMd: string;
  /** Only for an essay: an example essay, labelled as written for the project. */
  sampleEssayMd?: string | null;
  status: 'published' | 'needs_review';
  /** Why the task is not published, when status is needs_review. */
  reviewReason: string | null;
  /**
   * The book prints this task word for word in an earlier variant. The
   * importer then links that earlier task row into this variant instead of
   * creating a second copy (a task may belong to several variants).
   */
  sameAs?: { variant: number; taskNumber: number };
}

export interface RussianBookVariant {
  variant: number;
  sourceFile: string;
  sourcePageStart: number;
  sourcePageEnd: number;
  passages: { A: RussianBookPassage; B: RussianBookPassage };
  tasks: readonly RussianBookTask[];
}
