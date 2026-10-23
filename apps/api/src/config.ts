import { normalizeBotToken } from '@zybrilka/shared';
import { z } from 'zod';

// Shared with the worker (which sends the bot's messages) — see
// @zybrilka/shared telegramBot.ts.
export { normalizeBotToken };

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z.url().optional(),
    APP_VERSION: z.string().default('dev'),
    // Where the web app is served — the post-login OAuth redirect target.
    WEB_BASE_URL: z.url().default('http://localhost:5173'),
    // VK ID OAuth. All optional — when unset, the VK routes answer
    // 'vk_not_configured' instead of a broken redirect (see
    // modules/auth/vk.ts). VK_CLIENT_SECRET is server-only, never sent
    // to the client.
    VK_CLIENT_ID: z.string().optional(),
    VK_CLIENT_SECRET: z.string().optional(),
    VK_REDIRECT_URI: z.url().optional(),
    // Yandex ID OAuth (docs/YANDEX_ID.md). All optional — when unset, the
    // «Войти через Яндекс» routes send the browser back with
    // `yandex=not_configured` instead of a broken redirect.
    // YANDEX_CLIENT_SECRET is server-only, never sent to the client or logged.
    YANDEX_CLIENT_ID: z.string().optional(),
    YANDEX_CLIENT_SECRET: z.string().optional(),
    YANDEX_REDIRECT_URI: z.url().optional(),
    // Telegram Mini App sign-in. The bot token is the HMAC key that proves
    // `initData` really came from Telegram — server-only, never sent to the
    // client. Unset => POST /auth/telegram answers 503 `telegram_not_configured`.
    TELEGRAM_BOT_TOKEN: z.string().transform(normalizeBotToken).optional(),
    // How old a launch's `auth_date` may be before the sign-in is refused.
    TELEGRAM_AUTH_MAX_AGE_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
    // Upper bound for each server-to-server call to VK (code exchange,
    // profile lookup) so a stalled VK endpoint can't leave the OAuth
    // callback hanging. Not an env the deploy has to set.
    VK_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(5000),
    // Same, for each call to Yandex ID (token exchange, user info).
    YANDEX_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(5000),
    // Owner-only admin panel (docs/ADMIN.md). Comma-separated ids of EXISTING
    // `users` rows that may open /api/v1/admin/*. Unset/empty = nobody is an
    // admin (the safe default). Set only on the server (env / secret store),
    // never derived from anything a client sends; a malformed id fails startup
    // instead of being silently ignored.
    ADMIN_OWNER_USER_IDS: z
      .string()
      .default('')
      .transform((raw) =>
        raw
          .split(',')
          .map((id) => id.trim().toLowerCase())
          .filter((id) => id !== ''),
      )
      .pipe(z.array(z.uuid()).max(5)),
  })
  .refine((c) => c.NODE_ENV !== 'production' || c.DATABASE_URL, {
    message: 'DATABASE_URL is required in production',
    path: ['DATABASE_URL'],
  });

export type Config = z.infer<typeof configSchema>;

/** Treats an env var set to the empty string the same as one left
 * unset entirely, so `.default(...)`/`.optional()` above behave
 * correctly regardless of how the empty value got there — Docker
 * Compose's `${VAR}` substitutes an *empty string* (not an absent
 * key) for an unset variable, and a `z.url()`/`z.coerce.number()`
 * field would otherwise reject that empty string as invalid input
 * instead of falling back to its default (e.g. `WEB_BASE_URL` or
 * `VK_REQUEST_TIMEOUT_MS`), crashing the whole app at startup over an *optional*
 * feature simply not being configured yet. */
function stripEmptyStrings(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== '') result[key] = value;
  }
  return result;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(stripEmptyStrings(env));
  if (!result.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
