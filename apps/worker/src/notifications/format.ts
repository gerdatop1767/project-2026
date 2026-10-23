import {
  complaintReasonLabels,
  formatReportId,
  type ComplaintNotification,
  type OutboxPayload,
  type RegistrationNotification,
  type SiteErrorNotification,
} from '@zybrilka/shared';
import type { InlineKeyboard } from '../telegram/client.js';

/** Escapes text for Telegram's HTML parse mode. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const moscow = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
export const mskTime = (iso: string) => `${moscow.format(new Date(iso))} МСК`;

const methodText: Record<string, string> = {
  vk: 'VK ID',
  yandex: 'Яндекс ID',
  telegram: 'Telegram',
  email: 'Почта',
};

const link = (siteUrl: string, path: string) => new URL(path, siteUrl).toString();

export interface Rendered {
  text: string;
  keyboard?: InlineKeyboard;
}

function registration(d: RegistrationNotification, siteUrl: string): Rendered {
  return {
    text: [
      '🆕 <b>Новый пользователь</b>',
      `Когда: ${mskTime(d.at)}`,
      `Способ входа: ${escapeHtml(methodText[d.method] ?? d.method)}`,
      `Источник: ${d.campaign ? `кампания «${escapeHtml(d.campaign)}»` : 'не определён'}`,
      `ID: <code>${escapeHtml(d.userId)}</code>`,
    ].join('\n'),
    keyboard: {
      inline_keyboard: [
        [{ text: 'Открыть в админке', url: link(siteUrl, `/admin/users/${d.userId}`) }],
      ],
    },
  };
}

function complaint(d: ComplaintNotification, siteUrl: string): Rendered {
  const reason = complaintReasonLabels[d.reason as keyof typeof complaintReasonLabels] ?? d.reason;
  return {
    text: [
      `⚠️ <b>Жалоба ${formatReportId(d.reportNumber)}</b>`,
      `Предмет: ${escapeHtml(d.subjectName ?? 'не указан')}${d.taskNumber !== null ? ` · задание №${d.taskNumber}` : ''}`,
      `Задание: <code>${escapeHtml(d.taskId)}</code>`,
      `Категория: ${escapeHtml(reason)}`,
      ...(d.comment ? [`Текст: «${escapeHtml(d.comment)}»`] : []),
      `Когда: ${mskTime(d.at)}`,
    ].join('\n'),
    keyboard: {
      inline_keyboard: [
        [{ text: 'Открыть жалобу', url: link(siteUrl, `/admin/complaints/${d.complaintId}`) }],
      ],
    },
  };
}

function siteError(d: SiteErrorNotification, siteUrl: string): Rendered {
  return {
    text: [
      `🔥 <b>Ошибка сервера ${d.status}</b>`,
      `Запрос: <code>${escapeHtml(`${d.method} ${d.route}`)}</code>`,
      `Тип ошибки: <code>${escapeHtml(d.error)}</code>`,
      `Когда: ${mskTime(d.at)}`,
      ...(d.suppressed > 0
        ? [`Повторов с ${mskTime(d.firstAt)}: ${d.suppressed} (уведомления о них были приглушены)`]
        : []),
      'Подробности — в логах API.',
    ].join('\n'),
    keyboard: {
      inline_keyboard: [[{ text: 'Техническое состояние', url: link(siteUrl, '/admin/health') }]],
    },
  };
}

export function renderNotification(payload: OutboxPayload, siteUrl: string): Rendered {
  switch (payload.kind) {
    case 'registration':
      return registration(payload.data, siteUrl);
    case 'complaint':
      return complaint(payload.data, siteUrl);
    case 'site_error':
      return siteError(payload.data, siteUrl);
    case 'test':
      return {
        text: `✅ <b>Тестовое уведомление</b>\nУведомления Зубрилки приходят сюда. ${mskTime(payload.data.at)}`,
      };
  }
}

export function siteDownText(reason: string, since: string, reminder: boolean): string {
  return [
    reminder ? '🔴 <b>Сайт всё ещё недоступен</b>' : '🔴 <b>Сайт недоступен</b>',
    `Причина: ${escapeHtml(reason)}`,
    `С ${mskTime(since)}`,
  ].join('\n');
}

export function siteRecoveredText(since: string, now: string): string {
  const minutes = Math.max(1, Math.round((Date.parse(now) - Date.parse(since)) / 60_000));
  return ['🟢 <b>Сайт снова работает</b>', `Был недоступен около ${minutes} мин.`].join('\n');
}
