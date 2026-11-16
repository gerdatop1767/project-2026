import { z } from 'zod';

/**
 * Telegram notifications about learning progress (docs/learning/
 * PERSONAL-PLANS.md § Уведомления). Texts are built only from real numbers
 * the worker computed; the kinds and the student's settings live here so the
 * site and the worker agree on them.
 */
export const progressNotificationKinds = [
  'progress_improved',
  'plan_goal_reached',
  'plan_today',
  'plan_control',
] as const;
export type ProgressNotificationKind = (typeof progressNotificationKinds)[number];

/** `important`: no daily plan reminders, only results. */
export const progressFrequencies = ['normal', 'important'] as const;
export type ProgressFrequency = (typeof progressFrequencies)[number];

export const notificationPreferencesSchema = z.object({
  /** Progress, goal and control messages. */
  progressEnabled: z.boolean(),
  /** «Сегодня по плану …» reminders. */
  planRemindersEnabled: z.boolean(),
  frequency: z.enum(progressFrequencies),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  progressEnabled: true,
  planRemindersEnabled: true,
  frequency: 'normal',
};

/** At most this many progress messages a day per account. */
export const MAX_PROGRESS_MESSAGES_PER_DAY = 2;
/** Local-time window: nothing at night. */
export const PROGRESS_SEND_WINDOW = { fromMinute: 10 * 60, toMinute: 21 * 60 } as const;
/** «Сегодня по плану» goes out from this local time, if the day is not done yet. */
export const PLAN_REMINDER_FROM_MINUTE = 16 * 60;

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} ${one}`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

const SUBJECT_GENITIVE: Readonly<Record<string, string>> = {
  math: 'математике',
  russian: 'русскому языку',
};

export function progressImprovedText(p: {
  subjectId: string;
  examNumber: number | null;
  title: string;
  from: number;
  to: number;
}): string {
  const where = p.examNumber
    ? `по ${SUBJECT_GENITIVE[p.subjectId] ?? p.subjectId} №${p.examNumber}`
    : `по теме «${p.title}»`;
  return `📈 Ты улучшил результат ${where}: было ${p.from}%, стало ${p.to}%. Отличная динамика!`;
}

export function planGoalReachedText(p: {
  kind: 'week' | 'month';
  title: string;
  tasks: number;
  accuracyDelta: number | null;
}): string {
  const goal = p.kind === 'week' ? 'недельную' : 'месячную';
  const period = p.kind === 'week' ? 'За неделю' : 'За месяц';
  const delta =
    p.accuracyDelta === null
      ? ''
      : p.accuracyDelta > 0
        ? `, точность выросла на ${p.accuracyDelta}%`
        : p.accuracyDelta < 0
          ? `, точность пока ниже исходной на ${-p.accuracyDelta}%`
          : ', точность на прежнем уровне';
  return `🎯 Ты выполнил ${goal} цель по теме «${p.title}». ${period} решено ${plural(p.tasks, 'задание', 'задания', 'заданий')}${delta}.`;
}

export function planTodayText(p: { title: string; tasks: number }): string {
  return `📚 Сегодня по твоему плану — тренировка по теме «${p.title}». Нужно решить ${plural(p.tasks, 'задание', 'задания', 'заданий')}.`;
}

export function planControlText(p: { kind: 'week' | 'month' }): string {
  return `✅ Ты закончил ${p.kind === 'week' ? 'недельный' : 'месячный'} план. Пора пройти контрольную тренировку и проверить результат.`;
}
