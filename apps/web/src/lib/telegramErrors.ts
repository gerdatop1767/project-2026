import { ApiError } from './api.js';

/**
 * The short, non-secret code of why Telegram sign-in failed: the server's own
 * `error` code when it sent one, otherwise what the failure looked like
 * (`rate_limited`, `http_502`, `network`). Shown to the user so a failure can
 * be told apart ("not configured" vs "rejected" vs "offline") instead of one
 * generic sentence for everything.
 */
export function telegramErrorCode(error: unknown): string {
  if (error instanceof ApiError) {
    const code = (error.body as { error?: unknown } | undefined)?.error;
    if (typeof code === 'string' && /^[a-z_]{1,40}$/.test(code)) return code;
    if (error.status === 429) return 'rate_limited';
    return `http_${error.status}`;
  }
  return 'network';
}

const MESSAGES: Record<string, string> = {
  telegram_not_configured:
    'Вход через Telegram ещё не включён на сервере. Войдите через ВКонтакте или по почте.',
  telegram_data_expired:
    'Данные запуска из Telegram устарели. Закройте Зубрилку и откройте её из бота заново.',
  invalid_telegram_data:
    'Telegram не подтвердил данные запуска. Закройте Зубрилку и откройте её из бота заново; если не помогает — войдите другим способом и сообщите нам.',
  cross_site_request_blocked:
    'Браузер заблокировал запрос входа. Откройте Зубрилку из бота заново.',
  rate_limited: 'Слишком много попыток входа. Подождите несколько минут и попробуйте снова.',
  network: 'Нет связи с сервером. Проверьте интернет и откройте Зубрилку заново.',
};

/** What the login screen shows for a Telegram failure code. */
export function telegramErrorMessage(code: string): string {
  const text =
    MESSAGES[code] ??
    'Не удалось войти через Telegram. Войдите другим способом или откройте приложение заново.';
  return `${text} (код: ${code})`;
}
