import nodemailer from 'nodemailer';
import type { Config } from '../../config.js';

/** Thrown when SMTP isn't configured — routes map this to a 503
 * `email_not_configured` response rather than pretending a letter was
 * sent (see modules/auth/routes.ts). */
export class EmailNotConfiguredError extends Error {
  constructor() {
    super('SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASSWORD)');
  }
}

/**
 * The SMTP server refused or could not be reached. Carries only a coarse,
 * safe code for the log (nodemailer's `code`/`responseCode`) — never the
 * server's reply text, credentials or the message itself.
 */
export class EmailSendError extends Error {
  constructor(
    readonly code: string | undefined,
    readonly responseCode: number | undefined,
  ) {
    super('Email could not be sent');
  }
}

export function isEmailConfigured(config: Config): boolean {
  return Boolean(config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASSWORD);
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Test seam: replaces the SMTP transport (never set in production). */
export type EmailTransport = (config: Config, message: OutgoingEmail) => Promise<void>;
let transportOverride: EmailTransport | null = null;
export function setEmailTransportForTests(transport: EmailTransport | null): void {
  transportOverride = transport;
}

async function smtpSend(config: Config, message: OutgoingEmail): Promise<void> {
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    // 465 = implicit TLS (Yandex: smtp.yandex.ru:465); 587 = STARTTLS, required.
    secure: config.SMTP_PORT === 465,
    requireTLS: config.SMTP_PORT !== 465,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  try {
    await transport.sendMail({ from: config.SMTP_FROM, ...message });
  } catch (error) {
    const e = error as { code?: unknown; responseCode?: unknown };
    throw new EmailSendError(
      typeof e.code === 'string' ? e.code : undefined,
      typeof e.responseCode === 'number' ? e.responseCode : undefined,
    );
  }
}

/** Sends one letter. Throws `EmailNotConfiguredError` or `EmailSendError`
 * — callers must never report success unless this resolved. */
export async function sendEmail(config: Config, message: OutgoingEmail): Promise<void> {
  if (!isEmailConfigured(config)) throw new EmailNotConfiguredError();
  await (transportOverride ?? smtpSend)(config, message);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function letter(lines: { intro: string; link: string; button: string; outro: string }) {
  const link = escapeHtml(lines.link);
  return {
    text: `${lines.intro}\n\n${lines.link}\n\n${lines.outro}\n\n— Зубрилка`,
    html: `<!doctype html><html lang="ru"><body style="font-family:Arial,sans-serif;color:#1a1530;line-height:1.5">
<p>${escapeHtml(lines.intro)}</p>
<p><a href="${link}" style="display:inline-block;padding:12px 20px;border-radius:12px;background:#8a2be2;color:#fff;text-decoration:none;font-weight:bold">${escapeHtml(lines.button)}</a></p>
<p style="font-size:13px;color:#555">Если кнопка не открывается, скопируйте ссылку: <br><a href="${link}">${link}</a></p>
<p style="font-size:13px;color:#555">${escapeHtml(lines.outro)}</p>
<p>— Зубрилка</p></body></html>`,
  };
}

export function magicLinkEmail(to: string, link: string): OutgoingEmail {
  return {
    to,
    subject: 'Вход в Зубрилку',
    ...letter({
      intro: 'Чтобы войти в Зубрилку, откройте ссылку:',
      link,
      button: 'Войти',
      outro:
        'Ссылка действует 15 минут. Если вы не запрашивали вход, просто игнорируйте это письмо.',
    }),
  };
}

export function registrationEmail(to: string, link: string, hours: number): OutgoingEmail {
  return {
    to,
    subject: 'Подтвердите регистрацию в Зубрилке',
    ...letter({
      intro: 'Чтобы закончить регистрацию в Зубрилке, подтвердите адрес почты:',
      link,
      button: 'Подтвердить почту',
      outro: `Ссылка действует ${hours} ч. Если вы не регистрировались, просто игнорируйте это письмо — аккаунт не будет создан.`,
    }),
  };
}

/** Sent instead of a confirmation when the address already has an account
 * (the person registering gets the same on-screen answer either way). */
export function accountExistsEmail(to: string, resetLink: string, minutes: number): OutgoingEmail {
  return {
    to,
    subject: 'У вас уже есть аккаунт в Зубрилке',
    ...letter({
      intro:
        'Кто-то (возможно, вы) пытался зарегистрироваться в Зубрилке с этим адресом, но аккаунт с ним уже есть. Войдите как обычно — или задайте новый пароль по ссылке:',
      link: resetLink,
      button: 'Задать пароль',
      outro: `Ссылка действует ${minutes} мин. Если это были не вы, ничего делать не нужно.`,
    }),
  };
}

export function resetPasswordEmail(to: string, link: string, minutes: number): OutgoingEmail {
  return {
    to,
    subject: 'Восстановление пароля в Зубрилке',
    ...letter({
      intro: 'Чтобы задать новый пароль для Зубрилки, откройте ссылку:',
      link,
      button: 'Задать новый пароль',
      outro: `Ссылка действует ${minutes} мин и сработает один раз. Если вы не запрашивали восстановление, просто игнорируйте письмо — пароль не изменится.`,
    }),
  };
}

/** Kept for the passwordless link (service.requestMagicLink). */
export async function sendMagicLinkEmail(config: Config, email: string, link: string) {
  await sendEmail(config, magicLinkEmail(email, link));
}

/** Answer to a reset request for an address with no account — sent so the
 * request looks and takes the same either way (no account enumeration). */
export function noAccountEmail(to: string, registerLink: string): OutgoingEmail {
  return {
    to,
    subject: 'Восстановление пароля в Зубрилке',
    ...letter({
      intro:
        'Кто-то (возможно, вы) запросил восстановление пароля в Зубрилке для этого адреса, но аккаунта с ним нет. Если хотите, зарегистрируйтесь:',
      link: registerLink,
      button: 'Зарегистрироваться',
      outro: 'Если это были не вы, ничего делать не нужно.',
    }),
  };
}
