import { z } from 'zod';

/**
 * Task complaints («Сообщить об ошибке»): the categories, the request a
 * user sends, and the structured bug report an admin copies for Claude
 * Code. Shared so the form, the API and the admin panel agree on every
 * value and label.
 */

/** Every stored category. `typo` is legacy (no longer offered). Mirrors
 * `complaintReasons` in @zybrilka/db (a text column, no DB enum). */
export const complaintReasonValues = [
  'wrong_answer',
  'condition_error',
  'typo',
  'bad_explanation',
  'display_problem',
  'answer_check',
  'wrong_topic',
  'duplicate',
  'other',
] as const;
export type ComplaintReasonValue = (typeof complaintReasonValues)[number];

/** What the form offers, in this order. */
export const offeredComplaintReasons = [
  'wrong_answer',
  'condition_error',
  'bad_explanation',
  'display_problem',
  'answer_check',
  'wrong_topic',
  'duplicate',
  'other',
] as const satisfies readonly ComplaintReasonValue[];

export const complaintReasonLabels: Record<ComplaintReasonValue, string> = {
  wrong_answer: 'Неправильный ответ в задании',
  condition_error: 'Ошибка в условии',
  typo: 'Опечатка',
  bad_explanation: 'Ошибка в решении или объяснении',
  display_problem: 'Ошибка в изображении, формуле или форматировании',
  answer_check: 'Невозможно отправить или проверить ответ',
  wrong_topic: 'Задание относится не к той теме',
  duplicate: 'Задание дублируется',
  other: 'Другая причина',
};

/** One-line hint under each offered reason in «Сообщить об ошибке». */
export const complaintReasonHints: Record<(typeof offeredComplaintReasons)[number], string> = {
  wrong_answer: 'Считаю, что правильный ответ другой',
  condition_error: 'Условие неполное или некорректное',
  bad_explanation: 'Ошибка или пробел в разборе',
  display_problem: 'Не видно картинку, формула или вёрстка сломаны',
  answer_check: 'Сбой при вводе, отправке или проверке ответа',
  wrong_topic: 'Не подходит к указанной теме или номеру',
  duplicate: 'Такое задание уже встречалось',
  other: 'Опишите проблему в комментарии',
};

export const COMPLAINT_COMMENT_MAX = 1000;

/** Screens a complaint can come from. */
export const complaintScreens = ['task', 'result', 'variant', 'mistakes', 'other'] as const;

export const complaintContextSchema = z.object({
  screen: z.enum(complaintScreens),
  /** The app path (no origin, no query secrets — the client sends pathname + search). */
  path: z
    .string()
    .max(300)
    .regex(/^\/[^\s]*$/)
    .optional(),
  variantId: z.uuid().optional(),
});
export type ComplaintContextInput = z.infer<typeof complaintContextSchema>;

export const complaintRequestSchema = z
  .object({
    reason: z.enum(complaintReasonValues),
    comment: z.string().trim().max(COMPLAINT_COMMENT_MAX).optional(),
    context: complaintContextSchema.optional(),
  })
  // «Другая причина» says nothing by itself — the user's text is the report.
  .refine((v) => v.reason !== 'other' || (v.comment ?? '').length > 0, {
    message: 'comment_required',
    path: ['comment'],
  })
  // Legacy category: stored ones stay readable, new ones are not accepted.
  .refine((v) => v.reason !== 'typo', { message: 'reason_retired', path: ['reason'] });
export type ComplaintRequest = z.infer<typeof complaintRequestSchema>;

export const formatReportId = (reportNumber: number) => `RPT-${reportNumber}`;

/** Accepts `RPT-12`, `rpt12`, `12` → 12; anything else → null. */
export function parseReportId(value: string): number | null {
  const match = /^\s*(?:rpt-?)?(\d{1,9})\s*$/i.exec(value);
  return match ? Number(match[1]) : null;
}

/** Everything the report is built from. `null` = not known for this complaint. */
export interface ComplaintReportData {
  reportNumber: number;
  id: string;
  status: string;
  createdAt: string;
  subjectName: string | null;
  taskId: string;
  taskNumber: number | null;
  source: string | null;
  sourceYear: number | null;
  sourceDocument: string | null;
  variant: string | null;
  reason: string;
  comment: string | null;
  /** The task as it was when reported (snapshot), else the current task. */
  statement: string | null;
  statementFromSnapshot: boolean;
  /** True when the task was edited after the complaint was sent. */
  taskChangedSinceReport: boolean | null;
  expectedAnswer: string | null;
  explanation: string | null;
  context: { screen: string; path?: string } | null;
  duplicateOf: number | null;
  adminUrl: string | null;
}

const NA = 'not available';
const or = (value: string | number | null | undefined) =>
  value === null || value === undefined || value === '' ? NA : String(value);

function contextLines(d: ComplaintReportData): string[] {
  if (!d.context) return [`Screen: ${NA}`, `Path: ${NA}`];
  return [`Screen: ${d.context.screen}`, `Path: ${or(d.context.path)}`];
}

/**
 * The full report for Claude Code: what is broken, where to find it, what
 * the user said, how to reproduce, what to check. Every field comes from
 * the complaint — a missing one reads `not available`, never a guess.
 */
export function buildClaudeReport(d: ComplaintReportData): string {
  const lines = [
    '[ZUBRILKA BUG REPORT]',
    `Report ID: ${formatReportId(d.reportNumber)}`,
    `Complaint UUID: ${d.id}`,
    `Status: ${d.status}`,
    `Created at: ${d.createdAt}`,
    ...(d.duplicateOf !== null ? [`Duplicate of: ${formatReportId(d.duplicateOf)}`] : []),
    '',
    `Subject: ${or(d.subjectName)}`,
    `Task ID: ${d.taskId}`,
    `Source: ${or(d.source)}`,
    `Source year: ${or(d.sourceYear)}`,
    `Source document: ${or(d.sourceDocument)}`,
    `Variant: ${or(d.variant)}`,
    `Task number: ${or(d.taskNumber)}`,
    '',
    `Category: ${d.reason}`,
    '',
    d.statementFromSnapshot
      ? 'Task statement (as shown to the user when reported):'
      : 'Task statement (current version; no snapshot was stored for this report):',
    or(d.statement),
    '',
    'Expected answer:',
    or(d.expectedAnswer),
    '',
    'Explanation:',
    or(d.explanation),
    '',
    'User report:',
    or(d.comment),
    '',
    'Reproduction context:',
    ...contextLines(d),
    `Task changed since report: ${d.taskChangedSinceReport === null ? NA : d.taskChangedSinceReport ? 'yes' : 'no'}`,
    `Admin card: ${or(d.adminUrl)}`,
    '',
    'Where to look:',
    '- Database: table `tasks`, row id = Task ID (condition_md, correct_answer, explanation_md).',
    '- Snapshot at report time: table `task_snapshots` via task_complaints.snapshot_id.',
    '- Answer checking: packages/shared/src/answerChecker.ts (and intervalAnswer.ts, multiPartAnswer.ts).',
    '- Content import: packages/db/src (import scripts) and docs/imports.',
    '',
    'Requested investigation:',
    '1. Find the task by Task ID.',
    '2. Check the statement, the correct answer and the answer-checking logic.',
    '3. Determine the root cause.',
    '4. Propose a minimal fix.',
    '5. Add a test that prevents the error from coming back.',
  ];
  return lines.join('\n');
}

/** One line, for a chat message or a ticket title. */
export function buildShortReport(d: ComplaintReportData): string {
  const where = [
    or(d.subjectName),
    d.taskNumber !== null ? `№${d.taskNumber}` : null,
    `task ${d.taskId}`,
  ]
    .filter(Boolean)
    .join(', ');
  const text = d.comment
    ? ` — «${d.comment.length > 140 ? `${d.comment.slice(0, 139)}…` : d.comment}»`
    : '';
  return `${formatReportId(d.reportNumber)} [${d.status}] ${d.reason}: ${where}${text}`;
}
