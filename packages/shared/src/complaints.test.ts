import { describe, expect, it } from 'vitest';
import {
  buildClaudeReport,
  buildShortReport,
  complaintRequestSchema,
  parseReportId,
  type ComplaintReportData,
} from './complaints.js';

const full: ComplaintReportData = {
  reportNumber: 1042,
  id: '9a0e5d0c-3c6f-4c1e-9b1a-2f4d5e6f7a8b',
  status: 'new',
  createdAt: '2026-10-23 12:00:00+03',
  subjectName: 'Русский язык',
  taskId: '1b2c3d4e-0000-4000-8000-000000000001',
  taskNumber: 9,
  source: 'ФИПИ',
  sourceYear: 2026,
  sourceDocument: 'ege-2026-variant-1.pdf',
  variant: '1',
  reason: 'wrong_answer',
  comment: 'В ответе должно быть «приезжать»',
  statement: 'Укажите варианты ответов…',
  statementFromSnapshot: true,
  taskChangedSinceReport: false,
  expectedAnswer: '24',
  explanation: 'Проверяем безударные гласные…',
  context: { screen: 'task', path: '/task/1b2c?from=training' },
  duplicateOf: null,
  adminUrl: 'https://zybrilka.ru/admin/complaints/9a0e5d0c-3c6f-4c1e-9b1a-2f4d5e6f7a8b',
};

describe('buildClaudeReport', () => {
  it('lays out every real field in a fixed, greppable order', () => {
    const text = buildClaudeReport(full);
    expect(text.startsWith('[ZUBRILKA BUG REPORT]\nReport ID: RPT-1042\n')).toBe(true);
    for (const line of [
      'Status: new',
      'Subject: Русский язык',
      `Task ID: ${full.taskId}`,
      'Source: ФИПИ',
      'Variant: 1',
      'Task number: 9',
      'Category: wrong_answer',
      'Task statement (as shown to the user when reported):\nУкажите варианты ответов…',
      'Expected answer:\n24',
      'User report:\nВ ответе должно быть «приезжать»',
      'Screen: task',
      'Path: /task/1b2c?from=training',
      'Task changed since report: no',
      '1. Find the task by Task ID.',
      '5. Add a test that prevents the error from coming back.',
    ]) {
      expect(text).toContain(line);
    }
  });

  it('writes «not available» for every missing value instead of inventing one', () => {
    const text = buildClaudeReport({
      ...full,
      subjectName: null,
      taskNumber: null,
      source: null,
      sourceYear: null,
      sourceDocument: null,
      variant: null,
      comment: null,
      expectedAnswer: null,
      explanation: null,
      context: null,
      statementFromSnapshot: false,
      taskChangedSinceReport: null,
      adminUrl: null,
    });
    for (const line of [
      'Subject: not available',
      'Source: not available',
      'Variant: not available',
      'Task number: not available',
      'User report:\nnot available',
      'Expected answer:\nnot available',
      'Screen: not available',
      'Task changed since report: not available',
      'Task statement (current version; no snapshot was stored for this report):',
    ]) {
      expect(text).toContain(line);
    }
    expect(text).not.toMatch(/undefined|null/);
  });

  it('names the original when the report is a duplicate', () => {
    expect(buildClaudeReport({ ...full, duplicateOf: 7 })).toContain('Duplicate of: RPT-7');
  });
});

describe('buildShortReport', () => {
  it('is one line with the id, status, category and where', () => {
    const line = buildShortReport(full);
    expect(line).not.toContain('\n');
    expect(line).toBe(
      `RPT-1042 [new] wrong_answer: Русский язык, №9, task ${full.taskId} — «В ответе должно быть «приезжать»»`,
    );
  });
});

describe('complaint request', () => {
  it('«other» needs the user’s text; others do not', () => {
    expect(complaintRequestSchema.safeParse({ reason: 'other' }).success).toBe(false);
    expect(complaintRequestSchema.safeParse({ reason: 'other', comment: '  ' }).success).toBe(
      false,
    );
    expect(complaintRequestSchema.safeParse({ reason: 'other', comment: 'Опечатка' }).success).toBe(
      true,
    );
    expect(complaintRequestSchema.safeParse({ reason: 'wrong_answer' }).success).toBe(true);
  });

  it('parses report ids loosely', () => {
    expect(parseReportId('RPT-12')).toBe(12);
    expect(parseReportId('rpt12')).toBe(12);
    expect(parseReportId(' 12 ')).toBe(12);
    expect(parseReportId('RPT-x')).toBeNull();
  });
});
