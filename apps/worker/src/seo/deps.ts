import type { Database } from '@zybrilka/db';
import type { Logger } from 'pino';
import type { SeoAi } from './ai.js';

/** Minimal fetch used by integrations and checks (a fake in tests). */
export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface SeoDeps {
  db: Database;
  ai: SeoAi;
  logger: Logger;
  /** Public site origin, e.g. https://zybrilka.ru */
  origin: string;
  fetch: HttpFetch;
  /** SEO_SECRETS_KEY parsed, or null. */
  secretsKey: Buffer | null;
  /** TELEGRAM_BOT_TOKEN, for posting to the project's own channel. */
  telegramBotToken: string | null;
  now: () => Date;
}

/** Real pages of the trainer the content agent may link to (all exist and are indexable). */
export const SITE_PAGES: { path: string; title: string }[] = [
  { path: '/', title: 'Зубрилка — бесплатный тренажёр ЕГЭ' },
  { path: '/training', title: 'Тренировка: умная тренировка, мои ошибки, варианты' },
  { path: '/subjects', title: 'Все предметы' },
  { path: '/subjects/math', title: 'Профильная математика: задания ЕГЭ по номерам' },
  { path: '/subjects/russian', title: 'Русский язык: задания ЕГЭ по номерам' },
  { path: '/theory', title: 'Теория к заданиям ЕГЭ' },
  { path: '/materials', title: 'Полезные материалы: таблицы, формулы, списки' },
  { path: '/strategies', title: 'Стратегии подготовки' },
  { path: '/games', title: 'Мини-игры' },
  { path: '/games/stress', title: 'Тренажёр ударений (задание 4)' },
  { path: '/faq', title: 'Частые вопросы' },
];

/** Subjects that actually have tasks on the platform (others must not be promised). */
export const PLATFORM_SUBJECTS: Record<string, string> = {
  math: 'профильная математика',
  russian: 'русский язык',
};

/** Domains whose facts about the exam are authoritative. */
export const OFFICIAL_SOURCES = [
  'fipi.ru',
  'obrnadzor.gov.ru',
  'edu.gov.ru',
  'ege.edu.ru',
  'gosuslugi.ru',
];

/** Next Moscow wall-clock time HH:MM at/after `from`, as a Date. */
export function nextMoscowTime(hhmm: string, from: Date): Date {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const msk = new Date(from.getTime() + 3 * 3600_000);
  const candidate = new Date(
    Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate(), h, m) - 3 * 3600_000,
  );
  return candidate.getTime() >= from.getTime()
    ? candidate
    : new Date(candidate.getTime() + 24 * 3600_000);
}

export function mskDate(d: Date): string {
  return new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}
