import { parseTelegramHtml, TELEGRAM_CAPTION_MAX } from '@zybrilka/shared';
import type { InlineButton, InlineKeyboard, ReplyKeyboard } from '../telegram/client.js';

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

/** The two buttons under the input field (ReplyKeyboardMarkup): a tap sends
 * the button's text as an ordinary message, handled in handleUpdate. */
export const MENU_BUTTON = '📚 Меню';
export const SUPPORT_BUTTON = '💬 Поддержка';

export const persistentKeyboard: ReplyKeyboard = {
  keyboard: [[{ text: MENU_BUTTON }, { text: SUPPORT_BUTTON }]],
  // Shown even after the user hides the keyboard (Bot API 6.4+); older
  // clients ignore it and keep the usual keyboard icon.
  is_persistent: true,
  // One compact row instead of half the screen on phones.
  resize_keyboard: true,
};

/** «📚 Меню», «меню», «Меню » … → 'menu'; the same for «Поддержка». */
export function keyboardButtonOf(text: string): 'menu' | 'support' | null {
  const word = text
    .replace(/[^\p{L}\s]/gu, '')
    .trim()
    .toLowerCase();
  if (word === 'меню') return 'menu';
  if (word === 'поддержка') return 'support';
  return null;
}

export const mainMenuText =
  '<b>Главное меню</b> 📚\n\nОткрывай Зубрилку и решай задания — прогресс и ошибки сохраняются там же.';

export { CALLBACK_SUPPORT_CLOSE } from './support.js';
export const CALLBACK_REMINDERS_OFF = 'reminders_off';

/** Under the support acknowledgement: ends the conversation. */
export const supportCloseKeyboard: InlineKeyboard = {
  inline_keyboard: [[{ text: 'Завершить обращение', callback_data: 'support_close' }]],
};

export const supportAlreadyOpenText =
  'Обращение уже открыто — просто напиши сюда, сообщение попадёт в него.';

/** Under every daily reminder (docs/REMINDERS.md). */
export function reminderKeyboard(siteUrl: string): InlineKeyboard {
  const training = new URL('/training', siteUrl).toString();
  return {
    inline_keyboard: [
      [
        siteUrl.startsWith('https://')
          ? { text: 'Начать тренировку', web_app: { url: training } }
          : { text: 'Начать тренировку', url: training },
      ],
      [{ text: 'Отключить напоминания', callback_data: CALLBACK_REMINDERS_OFF }],
    ],
  };
}

export const remindersOffText =
  'Напоминания отключены. Включить их снова можно на сайте: Профиль → Уведомления.';
export const remindersNoAccountText =
  'Этот Telegram не привязан к аккаунту Зубрилки, поэтому напоминаний для него нет.';

/** The answer to `/start link_<token>` (the site's «Привязать Telegram»). */
/** «Да, это мой аккаунт» under the link question: `lk:<token>`. A token
 * from a `start` payload is at most 59 characters, so this stays within
 * the 64 bytes Telegram allows for callback data. */
export const CALLBACK_LINK_PREFIX = 'lk:';
export const CALLBACK_LINK_NO = 'link_no';

export function linkQuestionText(accountLabel: string): string {
  return `Привязать этот Telegram к аккаунту Зубрилки «${accountLabel}»?\n\nЕсли ссылку тебе прислал кто-то другой — нажми «Нет».`;
}

export function linkQuestionKeyboard(token: string): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: 'Да, это мой аккаунт', callback_data: `${CALLBACK_LINK_PREFIX}${token}` }],
      [{ text: 'Нет', callback_data: CALLBACK_LINK_NO }],
    ],
  };
}

export const linkClaimedText =
  'Почти готово! Вернись на сайт и подтверди привязку — в профиле («Способы входа») или в «Уведомлениях». Без этого Telegram не привяжется.';

/** Under «Почти готово»: back to the profile, where the link is confirmed.
 * Only for a real https site — Telegram refuses other URL buttons. */
export function linkClaimedKeyboard(siteUrl: string): InlineKeyboard | null {
  if (!siteUrl.startsWith('https://')) return null;
  return {
    inline_keyboard: [
      [{ text: 'Вернуться на сайт', url: `${siteUrl.replace(/\/+$/, '')}/profile` }],
    ],
  };
}
export const linkDeclinedText = 'Хорошо, ничего не привязано.';
export const linkFailedText = 'Не получилось привязать Telegram — попробуй ещё раз через минуту.';

export function linkResultText(
  status: 'already_linked' | 'taken' | 'claimed_by_other' | 'invalid' | 'expired' | 'used',
): string {
  switch (status) {
    case 'already_linked':
      return 'Этот Telegram уже привязан к твоему аккаунту ✅';
    case 'taken':
      return 'Этот Telegram уже привязан к другому аккаунту Зубрилки. Войди в тот аккаунт или отвяжи Telegram в его профиле.';
    case 'claimed_by_other':
      return 'Эту ссылку уже подтвердил другой Telegram. Открой «Привязать Telegram» на сайте ещё раз.';
    case 'expired':
      return 'Ссылка устарела. Открой на сайте «Привязать Telegram» ещё раз — ссылка действует 15 минут.';
    case 'used':
      return 'Эта ссылка уже использована. Если нужно привязать заново — открой «Привязать Telegram» на сайте ещё раз.';
    case 'invalid':
      return 'Ссылка для привязки не подошла. Открой «Привязать Telegram» на сайте ещё раз.';
  }
}

export const supportSaveFailedText =
  'Не получилось сохранить сообщение 😔 Попробуй отправить его ещё раз через минуту.';

/**
 * Splits a photo caption that Telegram would reject (over 1024 visible
 * characters) at a paragraph break: the photo keeps as much of the start as
 * fits, the rest follows as a message. Paragraphs never split inside tags.
 */
export function splitCaption(html: string): { caption: string; rest: string | null } {
  const visible = (part: string) => {
    const parsed = parseTelegramHtml(part);
    return parsed.ok ? parsed.visibleLength : part.length;
  };
  if (visible(html) <= TELEGRAM_CAPTION_MAX) return { caption: html, rest: null };
  const paragraphs = html.split('\n\n');
  let count = 1;
  while (
    count < paragraphs.length &&
    visible(paragraphs.slice(0, count + 1).join('\n\n')) <= TELEGRAM_CAPTION_MAX
  ) {
    count++;
  }
  return {
    caption: paragraphs.slice(0, count).join('\n\n'),
    rest: paragraphs.slice(count).join('\n\n') || null,
  };
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
  '/menu — главное меню',
  '/ios — как установить Зубрилку на iPhone и iPad',
  '/support — написать в поддержку',
  '/reminders_off — отключить ежедневные напоминания',
];

export const helpText = commandList.join('\n');

export const unknownCommandText = ['Такой команды я не знаю 🤔', '', ...commandList].join('\n');

export const plainTextReply = [
  'Я бот Зубрилки и сам на сообщения не отвечаю.',
  '',
  'Нужна помощь? Нажми «💬 Поддержка» внизу и напиши — ответит человек.',
  'Нашёл ошибку в задании? Нажми «Сообщить об ошибке» прямо в задании — так мы быстрее её исправим.',
].join('\n');
