import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../../config.js';
import { checkProviderAvatarUrl, cleanProviderName } from './providerProfile.js';

export function isTelegramConfigured(config: Config): boolean {
  return Boolean(config.TELEGRAM_BOT_TOKEN);
}

export class TelegramNotConfiguredError extends Error {
  constructor() {
    super('Telegram sign-in is not configured (TELEGRAM_BOT_TOKEN)');
  }
}

export type TelegramAuthFailure =
  | 'malformed' // not a query string / missing or duplicated fields
  | 'bad_signature' // hash does not match: forged, tampered, or another bot's data
  | 'expired' // auth_date older than the allowed age
  | 'from_future' // auth_date ahead of the server clock
  | 'no_user' // signed, but carries no user (e.g. a chat-only launch)
  | 'invalid_user'; // user object malformed, or a bot

/** Safe to show to the client as a short code; carries no request content. */
export class TelegramAuthError extends Error {
  constructor(readonly reason: TelegramAuthFailure) {
    super(`Telegram initData rejected: ${reason}`);
    this.name = 'TelegramAuthError';
  }
}

const telegramUserSchema = z.object({
  // Telegram ids are up to 52 significant bits, so they survive a JS number.
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  is_bot: z.boolean().optional(),
  first_name: z.string().max(256).optional(),
  last_name: z.string().max(256).optional(),
  username: z.string().max(64).optional(),
  photo_url: z.string().max(1000).optional(),
});

/** What the rest of the app may rely on after a successful verification. */
export interface VerifiedTelegramUser {
  /** The stable numeric Telegram user id, as a string. The ONLY identity key. */
  id: string;
  firstName?: string;
  lastName?: string;
  /** Allow-listed https photo URL from the signed data, if Telegram sent one. */
  photoUrl?: string;
  authDate: number;
}

const MAX_INIT_DATA_LENGTH = 8192;
const CLOCK_SKEW_SECONDS = 60;

/**
 * Verifies `Telegram.WebApp.initData` exactly as Telegram's Mini Apps
 * documentation prescribes ("Validating data received via the Mini App"):
 *
 * 1. split the query string into fields and set `hash` aside;
 * 2. data_check_string = every OTHER field as `key=value` (values
 *    URL-decoded), sorted alphabetically by key, joined with `\n`
 *    (`signature`, Telegram's third-party Ed25519 field, stays IN this string
 *    — only `hash` is excluded for the bot-token method);
 * 3. secret_key = HMAC_SHA256(key = "WebAppData", message = bot token);
 * 4. expected = HMAC_SHA256(key = secret_key, message = data_check_string),
 *    compared with `hash` in constant time;
 * 5. `auth_date` must be recent (and not in the future).
 *
 * Only after all of that is the `user` field parsed. Nothing the client
 * puts next to `initData` (`initDataUnsafe`, ids, names) is consulted.
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  options: { maxAgeSeconds: number; nowSeconds?: number },
): VerifiedTelegramUser {
  if (initData.length === 0 || initData.length > MAX_INIT_DATA_LENGTH) {
    throw new TelegramAuthError('malformed');
  }

  const fields = new Map<string, string>();
  for (const [key, value] of new URLSearchParams(initData)) {
    if (fields.has(key)) throw new TelegramAuthError('malformed'); // ambiguous input
    fields.set(key, value);
  }

  const hash = fields.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) throw new TelegramAuthError('malformed');
  fields.delete('hash');

  const dataCheckString = [...fields.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest();
  const received = Buffer.from(hash, 'hex');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new TelegramAuthError('bad_signature');
  }

  // --- the data is authentic from here on ---

  const authDateRaw = fields.get('auth_date');
  if (!authDateRaw || !/^\d{1,12}$/.test(authDateRaw)) throw new TelegramAuthError('malformed');
  const authDate = Number(authDateRaw);
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (authDate > now + CLOCK_SKEW_SECONDS) throw new TelegramAuthError('from_future');
  if (now - authDate > options.maxAgeSeconds) throw new TelegramAuthError('expired');

  const userRaw = fields.get('user');
  if (!userRaw) throw new TelegramAuthError('no_user');
  let userJson: unknown;
  try {
    userJson = JSON.parse(userRaw);
  } catch {
    throw new TelegramAuthError('invalid_user');
  }
  const parsed = telegramUserSchema.safeParse(userJson);
  if (!parsed.success || parsed.data.is_bot === true) throw new TelegramAuthError('invalid_user');

  const photo = parsed.data.photo_url
    ? checkProviderAvatarUrl(parsed.data.photo_url, 'telegram')
    : undefined;

  return {
    id: String(parsed.data.id),
    firstName: cleanProviderName(parsed.data.first_name),
    lastName: cleanProviderName(parsed.data.last_name),
    photoUrl: photo?.ok ? photo.url : undefined,
    authDate,
  };
}

// ----------------------------------------------------------------------
// Profile photo through the bot (fallback)
// ----------------------------------------------------------------------

const TELEGRAM_API = 'https://api.telegram.org';
const PHOTO_BUDGET_MS = 4000;

export interface TelegramLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

class PhotoLookupError extends Error {
  constructor(
    readonly kind: 'timeout' | 'network' | 'http' | 'no_photo' | 'invalid_response' | 'too_large',
    readonly status?: number,
  ) {
    super(`telegram photo lookup: ${kind}`);
  }
}

async function botApi(
  token: string,
  method: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<unknown> {
  // The token is part of this URL: the URL is never logged and errors are
  // reduced to a coarse kind below before anything is reported.
  const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new PhotoLookupError('http', response.status);
  const data = (await response.json()) as { ok?: boolean; result?: unknown };
  if (!data.ok) throw new PhotoLookupError('invalid_response');
  return data.result;
}

/**
 * Fetches the user's current profile photo through the bot — Telegram's
 * documented route when the Mini App's signed data carries no `photo_url`:
 * `getUserProfilePhotos` → `getFile` → download from the Bot API file
 * endpoint. Returns the raw bytes (the caller validates them as an image
 * like any other upload), or `null`.
 *
 * Telegram only returns photos for users the bot is allowed to see (they
 * must have interacted with the bot), so `null` is a normal outcome, not
 * an error: sign-in never depends on it. The whole lookup shares one time
 * budget, the download is size-capped, and the file URL (which contains the
 * bot token) is never logged — failures are reduced to a coarse kind.
 */
export async function fetchTelegramProfilePhoto(
  botToken: string,
  telegramUserId: string,
  options: { maxBytes: number; log?: TelegramLogger },
): Promise<Buffer | null> {
  const signal = AbortSignal.timeout(PHOTO_BUDGET_MS);
  try {
    const photos = (await botApi(
      botToken,
      'getUserProfilePhotos',
      { user_id: Number(telegramUserId), limit: 1 },
      signal,
    )) as {
      photos?: { file_id?: string; width?: number; height?: number; file_size?: number }[][];
    };
    const sizes = photos?.photos?.[0];
    if (!Array.isArray(sizes) || sizes.length === 0) throw new PhotoLookupError('no_photo');

    // Largest variant that still fits the upload cap.
    const best = sizes
      .filter(
        (size) =>
          typeof size.file_id === 'string' &&
          (size.file_size === undefined || size.file_size <= options.maxBytes),
      )
      .sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))[0];
    if (!best?.file_id) throw new PhotoLookupError('too_large');

    const file = (await botApi(botToken, 'getFile', { file_id: best.file_id }, signal)) as {
      file_path?: string;
    };
    const path = file?.file_path;
    if (typeof path !== 'string' || !/^[\w./-]+$/.test(path) || path.includes('..')) {
      throw new PhotoLookupError('invalid_response');
    }

    const download = await fetch(`${TELEGRAM_API}/file/bot${botToken}/${path}`, { signal });
    if (!download.ok) throw new PhotoLookupError('http', download.status);
    const declared = Number(download.headers.get('content-length') ?? 0);
    if (declared > options.maxBytes) throw new PhotoLookupError('too_large');
    const bytes = Buffer.from(await download.arrayBuffer());
    if (bytes.length > options.maxBytes) throw new PhotoLookupError('too_large');
    return bytes;
  } catch (error) {
    const kind =
      error instanceof PhotoLookupError
        ? error.kind
        : (error as { name?: string } | null)?.name === 'TimeoutError' ||
            (error as { name?: string } | null)?.name === 'AbortError'
          ? 'timeout'
          : 'network';
    // "No photo" is routine; the rest is worth one coarse line.
    if (kind !== 'no_photo') {
      options.log?.warn(
        {
          tgPhoto: kind,
          ...(error instanceof PhotoLookupError && error.status ? { status: error.status } : {}),
        },
        'Telegram profile photo lookup failed; continuing without it',
      );
    }
    return null;
  }
}
