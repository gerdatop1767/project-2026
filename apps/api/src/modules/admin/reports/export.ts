import type { Database } from '@zybrilka/db';
import { sql } from 'drizzle-orm';
import type { Period } from '../period.js';
import { campaignsReport } from './campaigns.js';
import { complaintListQuerySchema } from './complaints.js';
import { rows } from './common.js';
import { subjectDetailReport, subjectsReport } from './content.js';
import { toCsv } from './csv.js';
import { overviewReport } from './overview.js';
import { qualityReport } from './quality.js';
import { loadSettings } from './settings.js';
import { userFilters, userListQuerySchema, userRowsSql } from './users.js';

export const exportKinds = [
  'overview',
  'subjects',
  'numbers',
  'users',
  'campaigns',
  'complaints',
  'quality',
] as const;
export type ExportKind = (typeof exportKinds)[number];

/** Hard cap on exported rows — larger sets are cut and the audit entry says so. */
export const EXPORT_MAX_ROWS = 50_000;

/**
 * CSV exports. Each one respects the same filters as its page and contains
 * only the columns shown there — users: id, display name, dates and
 * aggregates; never e-mails, provider ids, sessions or answers.
 */
export async function exportCsv(
  db: Database,
  kind: ExportKind,
  period: Period,
  query: unknown,
): Promise<{ csv: string; rows: number; truncated: boolean }> {
  const done = (columns: { key: string; label: string }[], records: Record<string, unknown>[]) => {
    const truncated = records.length > EXPORT_MAX_ROWS;
    const cut = truncated ? records.slice(0, EXPORT_MAX_ROWS) : records;
    return { csv: toCsv(columns, cut), rows: cut.length, truncated };
  };
  switch (kind) {
    case 'overview': {
      const r = await overviewReport(db, period);
      return done(
        [
          { key: 'bucket', label: 'Период (МСК)' },
          { key: 'registrations', label: 'Регистрации' },
          { key: 'activeRegistered', label: 'Активные зарегистрированные' },
          { key: 'activeGuests', label: 'Активные гости' },
          { key: 'correct', label: 'Верные ответы (зарег.)' },
          { key: 'incorrect', label: 'Неверные ответы (зарег.)' },
          { key: 'guestCorrect', label: 'Верные ответы (гости)' },
          { key: 'guestIncorrect', label: 'Неверные ответы (гости)' },
        ],
        r.series,
      );
    }
    case 'subjects':
      return done(
        [
          { key: 'subjectId', label: 'Предмет (id)' },
          { key: 'name', label: 'Предмет' },
          { key: 'tasks', label: 'Заданий' },
          { key: 'published', label: 'Опубликовано' },
          { key: 'attempts', label: 'Ответов' },
          { key: 'correct', label: 'Верных' },
          { key: 'uniqueSolvers', label: 'Уникальных решающих' },
          { key: 'guestChecks', label: 'Проверок гостей' },
          { key: 'openComplaints', label: 'Открытых жалоб' },
        ],
        await subjectsReport(db, period),
      );
    case 'numbers': {
      const subjects = await rows<{ id: string; name: string }>(
        db,
        sql`SELECT id, name FROM subjects ORDER BY id`,
      );
      const records: Record<string, unknown>[] = [];
      for (const subject of subjects) {
        const detail = await subjectDetailReport(db, subject.id, period);
        for (const n of detail?.byNumber ?? []) records.push({ subject: subject.name, ...n });
      }
      return done(
        [
          { key: 'subject', label: 'Предмет' },
          { key: 'taskNumber', label: 'Номер ЕГЭ' },
          { key: 'tasks', label: 'Заданий' },
          { key: 'attempts', label: 'Ответов' },
          { key: 'correct', label: 'Верных' },
          { key: 'incorrect', label: 'Неверных' },
          { key: 'uniqueSolvers', label: 'Уникальных решающих' },
          { key: 'solved', label: 'Решили' },
          { key: 'openComplaints', label: 'Открытых жалоб' },
        ],
        records,
      );
    }
    case 'users': {
      const q = userListQuerySchema.parse({ ...(query as object), page: 1, pageSize: 100 });
      const records = await rows<Record<string, unknown>>(
        db,
        sql`SELECT x.id, x.name, x.registered_at::text AS "registeredAt", x.last_activity::text AS "lastActivity",
          x.subjects, x.solves, x.correct, x.incorrect, x.active_days AS "activeDays", x.source, x.campaign
          FROM (${userRowsSql()}) x WHERE ${userFilters(q, new Date())}
          ORDER BY x.registered_at DESC, x.id LIMIT ${EXPORT_MAX_ROWS + 1}`,
      );
      return done(
        [
          { key: 'id', label: 'ID' },
          { key: 'name', label: 'Имя' },
          { key: 'registeredAt', label: 'Регистрация' },
          { key: 'lastActivity', label: 'Последняя активность' },
          { key: 'subjects', label: 'Предметы' },
          { key: 'solves', label: 'Ответов' },
          { key: 'correct', label: 'Верных' },
          { key: 'incorrect', label: 'Неверных' },
          { key: 'activeDays', label: 'Активных дней' },
          { key: 'source', label: 'Источник' },
          { key: 'campaign', label: 'Кампания' },
        ],
        records,
      );
    }
    case 'campaigns': {
      const r = await campaignsReport(db, period, { includeArchived: true });
      return done(
        [
          { key: 'name', label: 'Кампания' },
          { key: 'slug', label: 'Метка' },
          { key: 'source', label: 'Источник' },
          { key: 'channel', label: 'Канал' },
          { key: 'creative', label: 'Креатив' },
          { key: 'status', label: 'Статус' },
          { key: 'clicks', label: 'Переходы' },
          { key: 'uniqueVisitors', label: 'Уникальные посетители' },
          { key: 'registrations', label: 'Регистрации' },
          { key: 'conversion', label: 'Конверсия' },
          { key: 'a1', label: 'Первый ответ' },
          { key: 'a5', label: '5 ответов' },
          { key: 'a10', label: '10 ответов' },
          { key: 'd7', label: 'Активны через 7 дней' },
          { key: 'd30', label: 'Активны через 30 дней' },
        ],
        r.items,
      );
    }
    case 'complaints': {
      const q = complaintListQuerySchema.parse({ ...(query as object), page: 1, pageSize: 100 });
      const where = sql.join(
        [
          sql`c.created_at >= ${period.startUtc.toISOString()}::timestamptz AND c.created_at < ${period.endUtc.toISOString()}::timestamptz`,
          ...(q.status ? [sql`c.status = ${q.status}`] : []),
          ...(q.reason ? [sql`c.reason = ${q.reason}`] : []),
          ...(q.subject ? [sql`t.subject_id = ${q.subject}`] : []),
        ],
        sql` AND `,
      );
      const records = await rows<Record<string, unknown>>(
        db,
        sql`SELECT c.id, c.created_at::text AS "createdAt", t.subject_id AS "subjectId", c.task_id AS "taskId",
          t.task_number AS "taskNumber", c.reason, c.comment, c.status, c.user_id AS "userId"
          FROM task_complaints c JOIN tasks t ON t.id = c.task_id WHERE ${where}
          ORDER BY c.created_at DESC LIMIT ${EXPORT_MAX_ROWS + 1}`,
      );
      return done(
        [
          { key: 'id', label: 'ID' },
          { key: 'createdAt', label: 'Дата' },
          { key: 'subjectId', label: 'Предмет' },
          { key: 'taskId', label: 'Задание' },
          { key: 'taskNumber', label: 'Номер' },
          { key: 'reason', label: 'Причина' },
          { key: 'comment', label: 'Текст' },
          { key: 'status', label: 'Статус' },
          { key: 'userId', label: 'Отправитель' },
        ],
        records,
      );
    }
    case 'quality': {
      const r = await qualityReport(db, period, await loadSettings(db));
      return done(
        [
          { key: 'id', label: 'Задание' },
          { key: 'subjectId', label: 'Предмет' },
          { key: 'taskNumber', label: 'Номер' },
          { key: 'attempts', label: 'Ответов' },
          { key: 'accuracy', label: 'Точность' },
          { key: 'openComplaints', label: 'Открытых жалоб' },
          { key: 'signals', label: 'Сигналы' },
        ],
        r.items.map((i) => ({ ...i, signals: i.signals.map((s) => s.detail) })),
      );
    }
  }
}
