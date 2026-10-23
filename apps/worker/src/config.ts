import { normalizeBotToken } from '@zybrilka/shared';
import { z } from 'zod';

/** On/off switch: true/1 (any case) → on; false/0/empty/unset → off;
 * anything else is a configuration error that names the accepted values. */
const flag = z
  .string()
  .optional()
  .transform((raw, ctx) => {
    const value = (raw ?? '').trim().toLowerCase();
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0' || value === '') return false;
    ctx.addIssue({
      code: 'custom',
      message: 'expected true, false, 1 or 0 (case-insensitive), or leave it empty',
    });
    return z.NEVER;
  });

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z.url().optional(),
    // The same bot the Mini App signs in with (docs/TELEGRAM_BOT.md). Empty =
    // the worker sends nothing to Telegram at all.
    TELEGRAM_BOT_TOKEN: z.string().transform(normalizeBotToken).optional(),
    // Read updates (/start, buttons) with getUpdates. Off unless asked for:
    // a bot can have only ONE reader, so turning this on takes updates away
    // from anything else serving this bot today (e.g. a support tool). The
    // worker never deletes a webhook; with one set, polling just reports 409.
    TELEGRAM_BOT_POLLING: flag,
    // The site the bot's «Открыть Зубрилку» button opens (https → it opens
    // as the Mini App inside Telegram).
    WEB_BASE_URL: z.url().default('http://localhost:5173'),
    // Same list as the API: `users.id` values of the owner(s). Admin
    // notifications go only to their linked Telegram accounts.
    ADMIN_OWNER_USER_IDS: z
      .string()
      .optional()
      .transform((raw) =>
        (raw ?? '')
          .split(',')
          .map((id) => id.trim().toLowerCase())
          .filter((id) => id.length > 0),
      )
      .pipe(z.array(z.uuid())),
    // Probed by the worker to notice the site being down (API + database).
    API_HEALTH_URL: z.url().optional(),
    TELEGRAM_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
  })
  .refine((c) => c.NODE_ENV !== 'production' || c.DATABASE_URL, {
    message: 'DATABASE_URL is required in production',
    path: ['DATABASE_URL'],
  });

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
