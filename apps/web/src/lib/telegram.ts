/**
 * Telegram support bot link, used by the Help screen's "Открыть бот"
 * CTA. No bot has been created/connected yet, so this deliberately has
 * no invented fallback URL — set `VITE_TELEGRAM_SUPPORT_URL` (see
 * apps/web/.env.example) once a real support bot exists. Until then
 * this is an empty string and the Help screen disables the CTA rather
 * than linking somewhere fake.
 */
export const TELEGRAM_SUPPORT_URL: string = import.meta.env.VITE_TELEGRAM_SUPPORT_URL ?? '';

/**
 * The real, public support bot. Used by the public landing's support
 * window, which must always offer a working link. The internal Help screen
 * keeps its own env-driven `TELEGRAM_SUPPORT_URL` above untouched.
 */
export const SUPPORT_BOT_URL = 'https://t.me/zybrilka_bot';
export const SUPPORT_BOT_HANDLE = '@zybrilka_bot';
