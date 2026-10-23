import type { InlineButton, InlineKeyboard } from '../telegram/client.js';

/**
 * Everything the bot says to users. HTML parse mode; nothing here ever
 * contains user input, so there is nothing to escape. Captions stay under
 * Telegram's 1024-character photo-caption limit (tested).
 */

export const CALLBACK_IOS_GUIDE = 'ios_guide';

/** «Открыть Зубрилку»: an https site opens as the Mini App inside Telegram;
 * anything else (local development) is an ordinary link. */
export function openAppButton(siteUrl: string): InlineButton {
  return siteUrl.startsWith('https://')
    ? { text: 'Открыть Зубрилку', web_app: { url: siteUrl } }
    : { text: 'Открыть Зубрилку', url: siteUrl };
}

export function mainKeyboard(siteUrl: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [openAppButton(siteUrl)],
      [{ text: 'Скачать приложение на iOS', callback_data: CALLBACK_IOS_GUIDE }],
    ],
  };
}

export const welcomeCaption = [
  '<b>Привет! Я Зубрилка 🦬</b>',
  '',
  'Тренажёр для подготовки к ЕГЭ: решай задания, сразу получай проверку и понятный разбор, а я запомню твои ошибки и помогу их проработать.',
  '',
  'Всё <b>бесплатно</b> — без подписок и платных уровней.',
  '',
  'Жми «Открыть Зубрилку» и начинай 👇',
].join('\n');

export const welcomeBackText = [
  '<b>С возвращением! 🦬</b>',
  '',
  'Продолжим готовиться к ЕГЭ? Открывай Зубрилку — прогресс и ошибки ждут тебя там же.',
].join('\n');

/** Plain host for the text (no scheme, no trailing slash). */
function siteHost(siteUrl: string): string {
  try {
    return new URL(siteUrl).host;
  } catch {
    return siteUrl;
  }
}

export function iosGuideCaption(siteUrl: string): string {
  return [
    '<b>Как установить Зубрилку на iPhone или iPad</b>',
    '',
    `1. Открой ${siteHost(siteUrl)} в <b>Safari</b> на iPhone или iPad.`,
    '2. Нажми кнопку «Поделиться» (квадрат со стрелкой вверх) в панели Safari.',
    '3. В меню выбери «На экран „Домой“» (Add to Home Screen).',
    '4. Подтверди добавление кнопкой «Добавить».',
    '5. Запускай Зубрилку с появившейся иконки на домашнем экране.',
    '',
    'Отдельного приложения в App Store нет: Зубрилка — веб-приложение, и устанавливать её нужно именно через Safari. Расположение кнопок и пунктов меню может немного отличаться в разных версиях iOS.',
  ].join('\n');
}

export function iosGuideKeyboard(siteUrl: string): InlineKeyboard {
  // A plain link, not the Mini App: the point is to open the site in Safari.
  return { inline_keyboard: [[{ text: 'Открыть сайт', url: siteUrl }]] };
}

const commandList = [
  'Вот что я умею:',
  '/start — открыть Зубрилку',
  '/ios — как установить Зубрилку на iPhone и iPad',
];

export const helpText = commandList.join('\n');

export const unknownCommandText = ['Такой команды я не знаю 🤔', '', ...commandList].join('\n');

export const plainTextReply = [
  'Я бот Зубрилки и пока не умею отвечать на сообщения.',
  '',
  'Нашёл ошибку в задании? Нажми «Сообщить об ошибке» прямо в задании — так мы быстрее её исправим.',
].join('\n');
