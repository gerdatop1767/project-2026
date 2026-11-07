/**
 * Data format for «ЕГЭ. Русский язык: типовые экзаменационные варианты:
 * 36 вариантов» (под ред. Р. А. Дощинского, «Национальное образование»,
 * 2027). One generated module per variant (`variantNN.ts`), read by
 * `importRussianDoshchinsky2027Book36.ts`.
 */
export interface R36Passage {
  title: string;
  bodyMd: string;
  sourceAuthor: string | null;
  sourceNote: string | null;
}

export interface R36MultiPartCell {
  id: string;
  label: string;
  correctAnswer: string;
}

export interface R36Task {
  taskNumber: number;
  topicSlug: string;
  topicName: string;
  /** 'A' — text for tasks 1–3, 'B' — text for tasks 23–26, null — own text. */
  passage: 'A' | 'B' | null;
  sourcePage: number;
  conditionMd: string;
  /** Plain-text statement (markdown removed), used for the content hash. */
  rawStatement: string;
  answerType: 'short_answer' | 'multi_part';
  correctAnswer: string;
  /** Other answers the official key accepts («<или>»). */
  acceptedAnswers: readonly string[];
  digitSetOrderInsensitive: boolean;
  correctAnswerDisplay: string | null;
  /** Only for multi_part (tasks 8 and 22): the А–Д cells. */
  multiPart?: readonly R36MultiPartCell[];
  explanationMd: string;
  hintMd: string;
  status: 'published' | 'needs_review';
  /** Why the task is not published, when status is needs_review. */
  reviewReason: string | null;
}

export interface R36Variant {
  variant: number;
  sourceFile: string;
  sourcePageStart: number;
  sourcePageEnd: number;
  passages: { A: R36Passage; B: R36Passage };
  tasks: readonly R36Task[];
}
