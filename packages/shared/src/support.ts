import { z } from 'zod';

/** Support through the Telegram bot and the admin panel (docs/SUPPORT.md). */
export const SUPPORT_MESSAGE_MAX = 4000;

export const supportThreadStatusSchema = z.enum(['open', 'closed']);
export type SupportThreadStatus = z.infer<typeof supportThreadStatusSchema>;

export const supportDeliverySchema = z.enum(['pending', 'sending', 'sent', 'failed', 'uncertain']);
export type SupportDelivery = z.infer<typeof supportDeliverySchema>;

export const supportAttachmentDtoSchema = z.object({
  kind: z.enum(['photo', 'document']),
  fileName: z.string().nullable(),
  /** Admin API URL that streams the file from Telegram (owner-only). */
  url: z.string(),
});

export const supportThreadSummarySchema = z.object({
  id: z.uuid(),
  status: supportThreadStatusSchema,
  /** Display name of the linked account, or «Пользователь Telegram». */
  name: z.string(),
  userId: z.uuid().nullable(),
  lastMessageAt: z.iso.datetime(),
  lastMessagePreview: z.string(),
  lastMessageFrom: z.enum(['user', 'admin']).nullable(),
  unread: z.boolean(),
  messageCount: z.number().int().nonnegative(),
  openedBy: z.enum(['user', 'admin']),
});
export type SupportThreadSummary = z.infer<typeof supportThreadSummarySchema>;

export const supportMessageDtoSchema = z.object({
  id: z.uuid(),
  direction: z.enum(['user', 'admin']),
  text: z.string(),
  attachments: z.array(supportAttachmentDtoSchema),
  createdAt: z.iso.datetime(),
  /** Admin replies only: where the message is on its way to Telegram. */
  delivery: supportDeliverySchema.nullable(),
  /** Admin replies that failed: a short reason code. */
  deliveryError: z.string().nullable(),
});
export type SupportMessageDto = z.infer<typeof supportMessageDtoSchema>;

export const supportThreadDetailSchema = z.object({
  thread: supportThreadSummarySchema.extend({
    createdAt: z.iso.datetime(),
    closedAt: z.iso.datetime().nullable(),
    /** Whether the bot can currently write to this chat. */
    reachable: z.boolean(),
  }),
  messages: z.array(supportMessageDtoSchema),
});
export type SupportThreadDetail = z.infer<typeof supportThreadDetailSchema>;

export const supportReplyRequestSchema = z.object({
  text: z.string().trim().min(1).max(SUPPORT_MESSAGE_MAX),
});

export const supportStatusRequestSchema = z.object({ status: supportThreadStatusSchema });

/** Why the bot cannot write to someone first. */
export const supportUnreachableReasonSchema = z.enum(['no_telegram', 'not_started', 'blocked']);
export type SupportUnreachableReason = z.infer<typeof supportUnreachableReasonSchema>;

export const supportUserSearchItemSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  reachable: z.boolean(),
  reason: supportUnreachableReasonSchema.nullable(),
  openThreadId: z.uuid().nullable(),
});
export type SupportUserSearchItem = z.infer<typeof supportUserSearchItemSchema>;

export const supportStartRequestSchema = z.object({
  userId: z.uuid(),
  text: z.string().trim().min(1).max(SUPPORT_MESSAGE_MAX),
});

/** What the bot says around support (shared by tests and the worker). */
export const supportTexts = {
  prompt:
    'Напиши сообщение для поддержки — текст, фото или файл. Мы ответим здесь, в этом чате.\n\nЧтобы вернуться в меню, нажми «📚 Меню».',
  received:
    'Сообщение получено ✅ Мы ответим здесь, как только сможем. Можешь дописать подробности — они попадут в то же обращение.',
  appended: 'Добавлено к обращению ✅',
  closedByUser: 'Обращение закрыто. Если появится новый вопрос — нажми «💬 Поддержка».',
  closedByAdmin:
    'Обращение закрыто поддержкой. Если вопрос остался — нажми «💬 Поддержка» и напиши снова.',
  replyPrefix: '💬 Ответ поддержки:',
  unsupported: 'Такое вложение не поддерживается. Пришли текст, фото или файл (документ).',
} as const;
