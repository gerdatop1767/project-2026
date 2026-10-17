import { z } from 'zod';

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z.url().optional(),
    APP_VERSION: z.string().default('dev'),
    // Where the web app is served — used to build the magic-link URL
    // emailed to the user and the post-login VK OAuth redirect target.
    WEB_BASE_URL: z.url().default('http://localhost:5173'),
    // Email (magic-link sign-in). All optional — when unset,
    // `requestMagicLink` fails with a clear 'email_not_configured'
    // error instead of silently pretending to send anything (see
    // modules/auth/email.ts).
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().default('Zybrilka <no-reply@zybrilka.ru>'),
    // VK ID OAuth. All optional — when unset, the VK routes answer
    // 'vk_not_configured' instead of a broken redirect (see
    // modules/auth/vk.ts). VK_CLIENT_SECRET is server-only, never sent
    // to the client.
    VK_CLIENT_ID: z.string().optional(),
    VK_CLIENT_SECRET: z.string().optional(),
    VK_REDIRECT_URI: z.url().optional(),
    // Upper bound for each server-to-server call to VK (code exchange,
    // profile lookup) so a stalled VK endpoint can't leave the OAuth
    // callback hanging. Not an env the deploy has to set.
    VK_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(5000),
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
 * `SMTP_PORT`), crashing the whole app at startup over an *optional*
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
