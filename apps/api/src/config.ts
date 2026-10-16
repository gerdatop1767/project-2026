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
