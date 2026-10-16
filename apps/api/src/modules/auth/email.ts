import nodemailer from 'nodemailer';
import type { Config } from '../../config.js';

/** Thrown by `sendMagicLinkEmail` when SMTP isn't configured — the
 * route maps this to a 503 `email_not_configured` response rather than
 * pretending a link was sent (see modules/auth/routes.ts). */
export class EmailNotConfiguredError extends Error {
  constructor() {
    super('SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASSWORD)');
  }
}

export function isEmailConfigured(config: Config): boolean {
  return Boolean(config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASSWORD);
}

/** Sends the real magic-link email via the configured SMTP server. Throws
 * `EmailNotConfiguredError` if SMTP env vars are missing — callers must
 * check `isEmailConfigured` (or catch this) rather than assume success. */
export async function sendMagicLinkEmail(
  config: Config,
  email: string,
  link: string,
): Promise<void> {
  if (!isEmailConfigured(config)) {
    throw new EmailNotConfiguredError();
  }
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
  });
  await transport.sendMail({
    from: config.SMTP_FROM,
    to: email,
    subject: 'Вход в Зубрилку',
    text: `Чтобы войти, откройте ссылку: ${link}\n\nСсылка действует 15 минут. Если вы не запрашивали вход, просто игнорируйте это письмо.`,
    html: `<p>Чтобы войти, откройте ссылку:</p><p><a href="${link}">${link}</a></p><p>Ссылка действует 15 минут. Если вы не запрашивали вход, просто игнорируйте это письмо.</p>`,
  });
}
