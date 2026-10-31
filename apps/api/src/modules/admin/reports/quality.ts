import type { Database } from '@zybrilka/db';
import { sql } from 'drizzle-orm';
import type { Period } from '../period.js';
import { registeredAttempts, rows } from './common.js';
import type { AdminSettings } from './settings.js';

const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

export type QualitySignal =
  | 'low_accuracy'
  | 'accuracy_drop'
  | 'complaints'
  | 'abandonment'
  | 'missing_explanation'
  | 'missing_topic'
  | 'choice_without_options'
  | 'published_needs_review';

/**
 * Качество обучения: tasks worth a human look, each with the signals it
 * triggered and the numbers behind them. A signal never says a task is
 * wrong — a hard task is just hard; accuracy signals need a minimum sample
 * (settings.quality.minSample) and every threshold is configurable.
 */
export async function qualityReport(db: Database, period: Period, settings: AdminSettings) {
  const q = settings.quality;
  const s = ts(period.startUtc);
  const e = ts(period.endUtc);
  const ps = ts(period.previous.startUtc);
  const data = await rows<{
    id: string;
    subjectId: string;
    taskNumber: number;
    status: string;
    preview: string;
    attempts: number;
    correct: number;
    prevAttempts: number;
    prevCorrect: number;
    openComplaints: number;
    opens: number;
    openedNoAnswer: number;
    explanationLength: number;
    hasTopic: boolean;
    answerType: string;
    optionsCount: number;
  }>(
    db,
    sql`SELECT t.id, t.subject_id AS "subjectId", t.task_number AS "taskNumber", t.status, left(t.condition_md, 120) AS preview,
      coalesce(cur.attempts, 0)::int AS attempts, coalesce(cur.correct, 0)::int AS correct,
      coalesce(prev.attempts, 0)::int AS "prevAttempts", coalesce(prev.correct, 0)::int AS "prevCorrect",
      coalesce(cp.n, 0)::int AS "openComplaints",
      coalesce(op.opens, 0)::int AS opens, coalesce(op.no_answer, 0)::int AS "openedNoAnswer",
      length(coalesce(t.explanation_md, ''))::int AS "explanationLength",
      (t.topic_id IS NOT NULL) AS "hasTopic", t.answer_type AS "answerType",
      coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(t.answer_options) = 'array' THEN t.answer_options END), 0)::int AS "optionsCount"
      FROM tasks t
      LEFT JOIN (SELECT a.task_id, count(*) AS attempts, count(*) FILTER (WHERE a.is_correct) AS correct
        FROM ${registeredAttempts} a WHERE a.created_at >= ${s} AND a.created_at < ${e} GROUP BY a.task_id) cur ON cur.task_id = t.id
      LEFT JOIN (SELECT a.task_id, count(*) AS attempts, count(*) FILTER (WHERE a.is_correct) AS correct
        FROM ${registeredAttempts} a WHERE a.created_at >= ${ps} AND a.created_at < ${s} GROUP BY a.task_id) prev ON prev.task_id = t.id
      LEFT JOIN (SELECT task_id, count(*) AS n FROM task_complaints WHERE status IN ('new', 'in_progress') GROUP BY task_id) cp ON cp.task_id = t.id
      LEFT JOIN (
        SELECT o.task_id, count(*) AS opens,
          count(*) FILTER (WHERE NOT EXISTS (
            SELECT 1 FROM analytics_events x WHERE x.type = 'answer_checked' AND x.task_id = o.task_id
              AND x.visitor_id = o.visitor_id AND x.occurred_at >= o.occurred_at)) AS no_answer
        FROM analytics_events o WHERE o.type = 'task_started' AND o.visitor_id IS NOT NULL
          AND o.occurred_at >= ${s} AND o.occurred_at < ${e} GROUP BY o.task_id
      ) op ON op.task_id = t.id
      WHERE t.status IN ('published', 'needs_review')`,
  );
  const items: {
    id: string;
    subjectId: string;
    taskNumber: number;
    status: string;
    preview: string;
    attempts: number;
    accuracy: number | null;
    previousAccuracy: number | null;
    openComplaints: number;
    signals: { type: QualitySignal; detail: string }[];
  }[] = [];
  for (const t of data) {
    const signals: { type: QualitySignal; detail: string }[] = [];
    const acc = t.attempts > 0 ? t.correct / t.attempts : null;
    const prevAcc = t.prevAttempts > 0 ? t.prevCorrect / t.prevAttempts : null;
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    if (acc !== null && t.attempts >= q.minSample && acc < q.lowAccuracy) {
      signals.push({
        type: 'low_accuracy',
        detail: `Точность ${pct(acc)} при ${t.attempts} ответах (порог ${pct(q.lowAccuracy)}, выборка ≥ ${q.minSample})`,
      });
    }
    if (
      acc !== null &&
      prevAcc !== null &&
      t.attempts >= q.minSample &&
      t.prevAttempts >= q.minSample &&
      prevAcc - acc >= q.accuracyDrop
    ) {
      signals.push({
        type: 'accuracy_drop',
        detail: `Точность упала с ${pct(prevAcc)} до ${pct(acc)} (порог −${pct(q.accuracyDrop)})`,
      });
    }
    if (t.openComplaints >= q.complaints) {
      signals.push({ type: 'complaints', detail: `Открытых жалоб: ${t.openComplaints}` });
    }
    if (t.opens >= q.minSample && t.openedNoAnswer / t.opens >= q.abandonment) {
      signals.push({
        type: 'abandonment',
        detail: `Открыли ${t.opens} раз, без ответа ${pct(t.openedNoAnswer / t.opens)} (порог ${pct(q.abandonment)})`,
      });
    }
    if (t.answerType !== 'essay' && t.explanationLength < 20) {
      signals.push({
        type: 'missing_explanation',
        detail: 'Нет разбора или он короче 20 символов',
      });
    }
    if (!t.hasTopic) signals.push({ type: 'missing_topic', detail: 'Не указана тема' });
    if (t.answerType === 'multiple_choice' && t.optionsCount < 2) {
      signals.push({
        type: 'choice_without_options',
        detail: 'Тип «выбор», но вариантов меньше двух',
      });
    }
    if (t.status === 'needs_review') {
      signals.push({ type: 'published_needs_review', detail: 'Задание отмечено «нужна проверка»' });
    }
    if (signals.length > 0) {
      items.push({
        id: t.id,
        subjectId: t.subjectId,
        taskNumber: t.taskNumber,
        status: t.status,
        preview: t.preview,
        attempts: t.attempts,
        accuracy: acc,
        previousAccuracy: prevAcc,
        openComplaints: t.openComplaints,
        signals,
      });
    }
  }
  // Behavioural signals (they need real use) first, then the metadata gaps.
  const weight = (i: (typeof items)[number]) =>
    i.signals.filter((sg) =>
      ['low_accuracy', 'accuracy_drop', 'complaints', 'abandonment'].includes(sg.type),
    ).length *
      10 +
    i.signals.length;
  items.sort((a, b) => weight(b) - weight(a) || b.attempts - a.attempts);
  const counts: Partial<Record<QualitySignal, number>> = {};
  for (const item of items)
    for (const sg of item.signals) counts[sg.type] = (counts[sg.type] ?? 0) + 1;
  return { thresholds: q, counts, items: items.slice(0, 300), totalFlagged: items.length };
}
